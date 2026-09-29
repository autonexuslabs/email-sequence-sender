import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyReply, REPLY } from '../src/classify.js'
import { nextStep, addBusinessDays, localNow } from '../src/schedule.js'
import { render, complianceProblems, buildMessage, rfc2822 } from '../src/message.js'
import { deliverStage, inboxStage } from '../src/run.js'

const c = (body, extra = {}) => classifyReply({ from: 'a@b.example', subject: 'Re: hi', body, ...extra })

test('reply classification: order-sensitive cases', () => {
  assert.equal(c("I'll stop by the office next week"), REPLY.INTERESTED)
  assert.equal(c('No thanks, we are all set.'), REPLY.NOT_INTERESTED)
  assert.equal(c('Not interested'), REPLY.NOT_INTERESTED)
  assert.equal(c('STOP'), REPLY.OPTOUT)
  assert.equal(c('Please remove me from your list'), REPLY.OPTOUT)
  assert.equal(c('This is spam, reporting you'), REPLY.COMPLAINT)
  assert.equal(c('Sure, how much is it?'), REPLY.INTERESTED)
  assert.equal(c('Who is this?'), REPLY.OTHER)
})

test('quoted history is ignored', () => {
  assert.equal(c('Who gave you my address?\n\nOn Mon, Alex wrote:\n> reply stop to opt out'), REPLY.OTHER)
})

test('bounces and auto-replies', () => {
  assert.equal(classifyReply({ from: 'MAILER-DAEMON@x.example', subject: 'failure', body: '' }), REPLY.BOUNCE)
  assert.equal(classifyReply({ from: 'a@b.example', subject: 'Automatic reply: hi', body: 'away' }), REPLY.AUTO)
  assert.equal(classifyReply({ from: 'a@b.example', subject: 'hi', body: 'x', headers: { 'auto-submitted': 'auto-replied' } }), REPLY.AUTO)
})

test('business days skip weekends', () => {
  assert.equal(addBusinessDays('2026-10-02', 1), '2026-10-05') // Fri → Mon
  assert.equal(addBusinessDays('2026-10-05', 3), '2026-10-08') // Mon → Thu
})

test('send window is the recipient time zone, with DST', () => {
  assert.equal(localNow('America/Chicago', new Date('2026-07-01T14:00:00Z')).hour, 9) // CDT
  assert.equal(localNow('America/Chicago', new Date('2026-12-01T14:00:00Z')).hour, 8) // CST
})

test('nextStep reasons', () => {
  const steps = [{ id: 'e0' }, { id: 'e1', afterBusinessDays: 3 }]
  const window = { timezone: 'America/Chicago', startHour: 8, endHour: 16 }
  const mon = new Date('2026-10-05T14:00:00Z')
  const lead = (extra) => ({ email: 'x@y.example', ...extra })
  assert.equal(nextStep(lead(), steps, window, new Set(), mon).step.id, 'e0')
  assert.equal(nextStep(lead(), steps, window, new Set(['x@y.example']), mon).reason, 'suppressed')
  assert.equal(nextStep(lead({ sent: { e0: '2026-10-05' } }), steps, window, new Set(), mon).reason, 'next due 2026-10-08')
  assert.equal(nextStep(lead(), steps, window, new Set(), new Date('2026-10-04T14:00:00Z')).reason, 'weekend where the lead is')
  assert.equal(nextStep(lead({ timezone: 'America/Los_Angeles' }), steps, window, new Set(), mon).reason, 'outside the send window')
})

test('compliance blocks missing opt-out, address and unfilled variables', () => {
  const footer = 'Demo Co, 1200 Example Ave, Springfield, MO 65801. Reply "stop" to opt out.'
  assert.deepEqual(complianceProblems({ subject: 'Hi', text: 'Hello', footer }), [])
  assert.deepEqual(complianceProblems({ subject: 'Hi {{firstName}}', text: 'x', footer }), ['unfilled template variable'])
  assert.ok(complianceProblems({ subject: 'Hi', text: 'x', footer: 'Demo Co' }).includes('no postal address'))
  assert.ok(complianceProblems({ subject: 'Hi', text: 'x', footer: '1200 Example Ave, MO 65801' }).includes('no opt-out instruction'))
  assert.equal(render('Hi {{firstName}}', {}), 'Hi {{firstName}}')
})

test('message has one-click unsubscribe headers and the recipient offset', () => {
  const raw = buildMessage({
    from: 'a@b.example', to: 'c@d.example', subject: 'Héllo', text: 'x', footer: 'f',
    unsubscribeUrl: 'https://b.example/u/1', unsubscribeMailto: 'u@b.example',
    now: new Date('2026-10-05T14:00:00Z'), timezone: 'America/Chicago',
  })
  assert.match(raw, /List-Unsubscribe: <mailto:u@b\.example\?subject=unsubscribe>, <https:\/\/b\.example\/u\/1>/)
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/)
  assert.match(raw, /Subject: =\?UTF-8\?B\?/)
  assert.equal(rfc2822(new Date('2026-10-05T14:00:00Z'), 'America/Chicago'), 'Mon, 05 Oct 2026 09:00:00 -0500')
})

test('an opt-out stops the next delivery run', async () => {
  const campaign = {
    from: 'a@b.example', footer: 'Co, 1 Example Ave, MO 65801. Reply stop to opt out.',
    window: { timezone: 'America/Chicago', startHour: 8, endHour: 16 },
    steps: [{ id: 'e0', subject: 'Hi', text: 'x' }, { id: 'e1', afterBusinessDays: 1, subject: 'Hi', text: 'y' }],
  }
  const db = { leads: [{ email: 'lead@x.example' }], suppressed: [], log: [] }
  const sent = []
  const transport = { name: 'mem', send: async (m) => (sent.push(m), { ok: true }) }
  await deliverStage(db, campaign, transport, { now: new Date('2026-10-05T14:00:00Z') })
  inboxStage(db, [{ from: 'lead@x.example', subject: 'Re: Hi', body: 'unsubscribe me' }])
  const r = await deliverStage(db, campaign, transport, { now: new Date('2026-10-06T14:00:00Z') })
  assert.equal(sent.length, 1)
  assert.equal(r.skipped[0].reason, 'suppressed')
})
