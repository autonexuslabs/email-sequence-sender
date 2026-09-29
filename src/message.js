// message.js — render a template, check it, and build the RFC 2822 message.

/** {{firstName}} → lead.firstName. Unknown variables are left in place so the compliance check catches them. */
export function render(template, lead) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (lead[k] != null && lead[k] !== '' ? String(lead[k]) : m))
}

/**
 * Everything that must be true before a message may leave. Returns the list
 * of problems; an empty list means send. CAN-SPAM needs a working opt-out and
 * a physical postal address in every commercial email.
 */
export function complianceProblems({ subject, text, footer }) {
  const problems = []
  if (!subject || !subject.trim()) problems.push('empty subject')
  if (/\{\{\s*\w+\s*\}\}/.test(subject + text)) problems.push('unfilled template variable')
  if (!footer || !/unsubscribe|reply "?stop"?/i.test(footer)) problems.push('no opt-out instruction')
  // A street number, words, then a US ZIP: "1200 Example Ave, Springfield, MO 65801".
  if (!footer || !/\b\d+\s+[A-Za-z].*\b\d{5}(-\d{4})?\b/.test(footer)) problems.push('no postal address')
  if (/!!|\$\$\$|100% free|act now|risk[- ]free/i.test(subject + text)) problems.push('spam-trigger phrasing')
  return problems
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`)

/** RFC 2822 date in the recipient's offset. */
export function rfc2822(now, tz) {
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName').value
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/) || [null, '+', '00', '00']
  const minutes = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
  const local = new Date(now.getTime() + minutes * 60_000)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n) => String(n).padStart(2, '0')
  return `${days[local.getUTCDay()]}, ${pad(local.getUTCDate())} ${months[local.getUTCMonth()]} ${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())} ${m[1]}${m[2]}${m[3]}`
}

/**
 * @returns {string} a complete message, ready for SMTP or the Gmail API
 */
export function buildMessage({ from, to, subject, text, footer, unsubscribeUrl, unsubscribeMailto, now = new Date(), timezone = 'UTC', messageId }) {
  const unsub = [unsubscribeMailto && `<mailto:${unsubscribeMailto}?subject=unsubscribe>`, unsubscribeUrl && `<${unsubscribeUrl}>`].filter(Boolean).join(', ')
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfc2822(now, timezone)}`,
    messageId && `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    unsub && `List-Unsubscribe: ${unsub}`,
    unsubscribeUrl && 'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  ].filter(Boolean)
  const body = `${text.trim()}\n\n--\n${footer.trim()}\n`
  return `${headers.join('\r\n')}\r\n\r\n${b64(body).replace(/.{76}/g, '$&\r\n')}\r\n`
}
