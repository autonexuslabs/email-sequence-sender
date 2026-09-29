// classify.js — what an inbound reply means, and whether we may write again.
//
// Order is the whole design. Checked in the wrong sequence, "no thanks"
// matches `thanks` and a rejection becomes a yes; "I'll stop by the office"
// matches `stop` and an interested lead is suppressed forever. The order in
// classifyReply is fixed, and every reordering is a bug.
//
// Where two readings are possible, pick the one that is cheaper to be wrong
// about. A misread positive costs one lead. A misread complaint costs the
// sending domain.

export const REPLY = {
  BOUNCE: 'bounce',
  AUTO: 'auto_reply',
  COMPLAINT: 'complaint',
  OPTOUT: 'optout',
  NOT_INTERESTED: 'not_interested',
  INTERESTED: 'interested',
  OTHER: 'other_reply',
}

/** Every verdict except an out-of-office stops the sequence for that lead. */
export const STOPS_SEQUENCE = new Set([REPLY.BOUNCE, REPLY.COMPLAINT, REPLY.OPTOUT, REPLY.NOT_INTERESTED, REPLY.INTERESTED, REPLY.OTHER])

/** These also go on the permanent do-not-mail list. */
export const SUPPRESS_FOREVER = new Set([REPLY.BOUNCE, REPLY.COMPLAINT, REPLY.OPTOUT])

const BOUNCE_FROM = /^(mailer-daemon|postmaster)@/i
const BOUNCE_SUBJECT = /(undeliverable|delivery status notification|returned mail|delivery (has )?failed|address not found)/i
const AUTO_SUBJECT = /(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|on vacation|away from)/i

// "stop" only as a command, never inside "stop by", "non-stop", "stop in".
const OPTOUT = /(^|\n)\s*(stop|unsubscribe|remove)\s*[.!]?\s*($|\n)|\b(unsubscribe me|remove me|take me off|opt(-| )?out|do not (email|contact)|don'?t (email|contact) me|stop (emailing|sending|contacting))\b/i
const COMPLAINT = /\b(spam|report(ing)? (you|this)|harass|lawyer|attorney|cease and desist|illegal)\b/i
const NOT_INTERESTED = /\b(not interested|no thanks|no thank you|we'?re (all )?set|not (a )?(good )?fit|pass on this|already have)\b/i
const INTERESTED = /\b(interested|tell me more|sounds good|let'?s (talk|chat)|call me|give me a call|send (me )?(more|details|info)|how much|pricing|what does it cost|stop by)\b/i

/**
 * @param {{ from: string, subject?: string, body?: string, headers?: object }} msg
 * @returns {string} one of REPLY
 */
export function classifyReply(msg) {
  const from = String(msg.from || '')
  const subject = String(msg.subject || '')
  const body = String(msg.body || '').split(/\n\s*(on .+ wrote:|-----original message-----|from: )/i)[0]
  const headers = msg.headers || {}

  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) return REPLY.BOUNCE
  if (headers['auto-submitted'] && headers['auto-submitted'] !== 'no') return REPLY.AUTO
  if (AUTO_SUBJECT.test(subject)) return REPLY.AUTO
  if (COMPLAINT.test(body)) return REPLY.COMPLAINT
  if (OPTOUT.test(body) || OPTOUT.test(subject)) return REPLY.OPTOUT
  if (NOT_INTERESTED.test(body)) return REPLY.NOT_INTERESTED
  if (INTERESTED.test(body)) return REPLY.INTERESTED
  return REPLY.OTHER
}
