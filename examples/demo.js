// A week of a 3-step campaign in one second, on a fake clock, dry transport.
//
//   Mon 09:00 Chicago   deliver  first touch goes out
//   Wed                 inbox    four replies arrive and are classified
//   Thu 11:00 Chicago   deliver  follow-ups only to the leads still eligible
//
// Every message is written to outbox/ as a real .eml file.
//
//   npm run demo

import { readFileSync, rmSync } from 'node:fs'
import { deliverStage, inboxStage, reportStage } from '../src/run.js'
import { dryTransport } from '../src/transports.js'

const json = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const campaign = json('./campaign.json')
const db = { leads: json('./leads.json'), suppressed: [], log: [] }
rmSync('outbox', { recursive: true, force: true })
const transport = dryTransport('outbox')

function show(title, { sent, skipped }) {
  console.log(`\n${title}`)
  for (const s of sent) console.log(`  sent     ${s.step}  ${s.email}`)
  for (const s of skipped) console.log(`  skipped      ${s.email.padEnd(34)} ${s.reason}`)
}

show('Mon 2026-10-05, 09:00 Chicago · deliver', await deliverStage(db, campaign, transport, { now: new Date('2026-10-05T14:00:00Z') }))

console.log('\nWed 2026-10-07 · inbox')
for (const r of inboxStage(db, json('./inbox.json'), new Date('2026-10-07T15:00:00Z'))) {
  console.log(`  ${r.verdict.padEnd(14)} ${r.email}`)
}

show('Thu 2026-10-08, 11:00 Chicago · deliver', await deliverStage(db, campaign, transport, { now: new Date('2026-10-08T16:00:00Z') }))

console.log('\nreport', reportStage(db, new Date('2026-10-08T16:00:00Z')))
console.log('\nopen outbox/*.eml in any mail client to see exactly what was "sent"\n')
