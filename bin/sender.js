#!/usr/bin/env node
// One bounded run of one stage. Schedule it; do not loop it.
//
//   node bin/sender.js import  --leads leads.json
//   node bin/sender.js inbox   --inbox replies.json
//   node bin/sender.js deliver --max 5
//   node bin/sender.js report
//
// SEND_MODE=dry (default) writes .eml files to outbox/. SEND_MODE=smtp sends
// through SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.

import { readFileSync } from 'node:fs'
import { load, save } from '../src/store.js'
import { inboxStage, deliverStage, reportStage } from '../src/run.js'
import { dryTransport, smtpTransport } from '../src/transports.js'

const [stage, ...args] = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const json = (f) => JSON.parse(readFileSync(f, 'utf8'))

const dbFile = opt('db', process.env.DB_FILE || 'data/db.json')
const db = load(dbFile)

if (stage === 'import') {
  const known = new Set(db.leads.map((l) => l.email.toLowerCase()))
  const fresh = json(opt('leads', 'leads.json')).filter((l) => !known.has(l.email.toLowerCase()))
  db.leads.push(...fresh)
  console.log(`imported ${fresh.length} new leads (${db.leads.length} total)`)
} else if (stage === 'inbox') {
  for (const r of inboxStage(db, json(opt('inbox', 'replies.json')))) console.log(`${r.verdict.padEnd(14)} ${r.email}`)
} else if (stage === 'deliver') {
  const campaign = json(opt('campaign', 'campaign.json'))
  const transport = process.env.SEND_MODE === 'smtp' ? await smtpTransport() : dryTransport()
  const { sent, skipped } = await deliverStage(db, campaign, transport, { max: Number(opt('max', 5)), jitterMs: [4000, 14000] })
  for (const s of sent) console.log(`sent     ${s.step}  ${s.email}`)
  for (const s of skipped) console.log(`skipped  ${s.email}  ${s.reason}`)
} else if (stage === 'report') {
  console.log(reportStage(db))
} else {
  console.error('usage: node bin/sender.js <import|inbox|deliver|report> [options]')
  process.exit(1)
}

save(dbFile, db)
