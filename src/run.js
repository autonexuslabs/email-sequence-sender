// run.js — the stages. One invocation does a small, bounded slice of work and
// exits; the scheduler provides the rhythm, not a sleep loop inside the job.
//
// That shape is deliberate. A job that paces itself for an hour bills an hour
// of compute for a minute of work, and a crash halfway through leaves no trace
// of where it got to. Short runs are cheap, restartable, and each one
// re-derives the truth from the store.
//
//   inbox    read replies, classify, stop sequences, suppress opt-outs
//   deliver  send what is due, at most --max messages, with jitter
//   report   counts, for a daily digest

import { classifyReply, STOPS_SEQUENCE, SUPPRESS_FOREVER, REPLY } from './classify.js'
import { nextStep } from './schedule.js'
import { render, complianceProblems, buildMessage } from './message.js'
import { suppressedSet, suppress } from './store.js'

const today = (now) => now.toISOString().slice(0, 10)

/**
 * @param {object} db
 * @param {object[]} messages  inbound: { from, subject, body, headers }
 */
export function inboxStage(db, messages, now = new Date()) {
  const byEmail = new Map(db.leads.map((l) => [l.email.toLowerCase(), l]))
  const results = []
  for (const msg of messages) {
    const verdict = classifyReply(msg)
    // A bounce comes from the mailer daemon; the lead is named in the body.
    const addr = verdict === REPLY.BOUNCE
      ? [...byEmail.keys()].find((e) => String(msg.body || '').toLowerCase().includes(e))
      : String(msg.from).toLowerCase().match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0]
    const lead = addr && byEmail.get(addr)
    if (!lead) continue
    if (STOPS_SEQUENCE.has(verdict) && !lead.stopped) lead.stopped = verdict
    if (SUPPRESS_FOREVER.has(verdict)) suppress(db, lead.email, verdict, today(now))
    results.push({ email: lead.email, verdict })
  }
  return results
}

/**
 * @param {object} db
 * @param {object} campaign  { from, footer, window, steps: [{ id, afterBusinessDays, subject, text }], unsubscribeMailto }
 * @param {object} transport { name, send }
 * @param {{ max?: number, now?: Date, jitterMs?: [number, number] }} opts
 */
export async function deliverStage(db, campaign, transport, { max = 10, now = new Date(), jitterMs = [0, 0] } = {}) {
  // Suppression is re-read every run, right before sending. Emailing someone
  // who replied "stop" yesterday is the worst thing this pipeline can do.
  const suppressed = suppressedSet(db)
  const sent = []
  const skipped = []

  for (const lead of db.leads) {
    if (sent.length >= max) break
    const { step, reason } = nextStep(lead, campaign.steps, campaign.window, suppressed, now)
    if (!step) { skipped.push({ email: lead.email, reason }); continue }

    const subject = render(step.subject, lead)
    const text = render(step.text, lead)
    const problems = complianceProblems({ subject, text, footer: campaign.footer })
    if (problems.length) { skipped.push({ email: lead.email, reason: `blocked: ${problems.join(', ')}` }); continue }

    const raw = buildMessage({
      from: campaign.from, to: lead.email, subject, text, footer: campaign.footer,
      unsubscribeMailto: campaign.unsubscribeMailto, now, timezone: lead.timezone || campaign.window.timezone,
    })
    const res = await transport.send({ raw, to: lead.email, from: campaign.from, stepId: step.id })
    if (!res.ok) { skipped.push({ email: lead.email, reason: 'transport refused' }); continue }

    lead.sent = { ...(lead.sent || {}), [step.id]: today(now) }
    db.log.push({ date: today(now), email: lead.email, step: step.id, transport: transport.name })
    sent.push({ email: lead.email, step: step.id })

    const [lo, hi] = jitterMs
    if (hi > 0) await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)))
  }
  return { sent, skipped }
}

export function reportStage(db, now = new Date()) {
  const d = today(now)
  const stopped = db.leads.filter((l) => l.stopped)
  return {
    sentToday: db.log.filter((x) => x.date === d).length,
    sentTotal: db.log.length,
    active: db.leads.filter((l) => !l.stopped && !suppressedSet(db).has(l.email.toLowerCase())).length,
    replies: Object.fromEntries(Object.values(REPLY).map((v) => [v, stopped.filter((l) => l.stopped === v).length]).filter(([, n]) => n)),
    suppressed: db.suppressed.length,
  }
}
