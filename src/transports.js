// transports.js — where a built message goes, by phase.
//
//   dry    nothing leaves; each message is written to outbox/ as a .eml file
//          you can open in any mail client to see exactly what would be sent
//   smtp   real delivery through any SMTP server (Google Workspace, Microsoft
//          365, Amazon SES, Mailgun, Postmark...)
//
// Start every new campaign in dry. Read the .eml files. Then switch.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function dryTransport(dir = 'outbox') {
  mkdirSync(dir, { recursive: true })
  return {
    name: 'dry',
    async send({ raw, to, stepId }) {
      const file = join(dir, `${stepId}-${to.replace(/[^a-z0-9@.-]/gi, '_')}.eml`)
      writeFileSync(file, raw)
      return { ok: true, id: file }
    },
  }
}

export async function smtpTransport(env = process.env) {
  const { default: nodemailer } = await import('nodemailer')
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })
  return {
    name: 'smtp',
    async send({ raw, to, from }) {
      const info = await t.sendMail({ envelope: { from: env.SMTP_USER || from, to }, raw })
      return { ok: info.accepted?.length > 0, id: info.messageId }
    },
  }
}
