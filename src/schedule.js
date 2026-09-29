// schedule.js — which step is due for which lead, in the RECIPIENT's clock.
//
// A 9 a.m. email is 9 a.m. where the reader is, not where the server is, and
// not UTC. Time zones are resolved by name, so daylight saving never silently
// shifts the window by an hour.

/** Date and hour in a named time zone. */
export function localNow(tz, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(now).map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday }
}

const WEEKEND = new Set(['Sat', 'Sun'])

/** Add N business days (Mon-Fri) to a YYYY-MM-DD date. */
export function addBusinessDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}

/**
 * The next step for one lead, or why there is none.
 *
 * @param {object} lead      { email, timezone?, sent: { [stepId]: 'YYYY-MM-DD' }, stopped?: string }
 * @param {object[]} steps   [{ id, afterBusinessDays }]
 * @param {object} window    { startHour, endHour, timezone }
 * @param {Set<string>} suppressed
 * @returns {{ step: object|null, reason: string }}
 */
export function nextStep(lead, steps, window, suppressed, now = new Date()) {
  if (suppressed.has(lead.email.toLowerCase())) return { step: null, reason: 'suppressed' }
  if (lead.stopped) return { step: null, reason: `stopped: ${lead.stopped}` }

  const local = localNow(lead.timezone || window.timezone, now)
  if (WEEKEND.has(local.weekday)) return { step: null, reason: 'weekend where the lead is' }
  if (local.hour < window.startHour || local.hour >= window.endHour) return { step: null, reason: 'outside the send window' }

  const sent = lead.sent || {}
  const i = steps.findIndex((s) => !sent[s.id])
  if (i === -1) return { step: null, reason: 'sequence finished' }
  if (i === 0) return { step: steps[0], reason: 'first touch' }

  const prev = sent[steps[i - 1].id]
  const due = addBusinessDays(prev, steps[i].afterBusinessDays)
  return local.date >= due ? { step: steps[i], reason: `due since ${due}` } : { step: null, reason: `next due ${due}` }
}
