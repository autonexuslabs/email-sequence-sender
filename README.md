# email-sequence-sender

**Multi-step email sequences that stop the moment someone replies, and never email a person who said stop.** A small, auditable alternative to a SaaS sequencer, for teams sending from their own domain: reply classification, a permanent suppression list, CAN-SPAM checks on every message, send windows in each recipient's own time zone, and a dry-run mode that writes real `.eml` files so you can read what would go out before anything does.

> Part of the [AutoNexus Labs](https://autonexuslabs.com) automation portfolio. All contacts in this repo are fictional (`.example` domains).

## The problem

The expensive mistakes in outbound email are not about copy. They are the follow-up sent to someone who replied yesterday, the "stop" that was missed, the bounce that kept being mailed until the domain's reputation dropped, the email that arrived at 6 a.m. because the server was in another time zone, and the `Hi {{firstName}}` that went to 300 people.

## What it does

A week of a three-step campaign on a fake clock (`npm run demo`):

```text
Mon 2026-10-05, 09:00 Chicago · deliver
  sent     e0  maria@northwind-heating.example
  sent     e0  dev@cedarvalleyhvac.example
  sent     e0  owner@summitair.example
  sent     e0  office@oakline.example
  sent     e0  jo@ironwoodair.example
  skipped      info@pacificcomfort.example        outside the send window
  skipped      hello@noname-hvac.example          blocked: unfilled template variable

Wed 2026-10-07 · inbox
  interested     dev@cedarvalleyhvac.example
  optout         owner@summitair.example
  auto_reply     office@oakline.example
  bounce         jo@ironwoodair.example

Thu 2026-10-08, 11:00 Chicago · deliver
  sent     e1  maria@northwind-heating.example
  sent     e1  office@oakline.example
  sent     e0  info@pacificcomfort.example
  skipped      dev@cedarvalleyhvac.example        stopped: interested
  skipped      owner@summitair.example            suppressed
  skipped      jo@ironwoodair.example             suppressed
  skipped      hello@noname-hvac.example          blocked: unfilled template variable
```

Read it line by line:

- The Los Angeles lead is skipped at 7 a.m. **their** time on Monday, and gets the first email on Thursday at 9 a.m. their time.
- The lead with no first name is **blocked, not sent** with a raw `{{firstName}}`, on every run until the data is fixed.
- The interested reply stops the sequence, so a person takes over.
- "STOP" and the hard bounce go on the permanent suppression list.
- The out-of-office reply does **not** stop the sequence. That person never actually read the email.

Every message is a real RFC 2822 file in `outbox/`:

```text
From: Alex at Demo Co <alex@democo.example>
To: maria@northwind-heating.example
Subject: Missed calls at Northwind Heating
Date: Mon, 05 Oct 2026 09:00:00 -0500
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: base64
List-Unsubscribe: <mailto:unsubscribe@democo.example?subject=unsubscribe>
```

## How it works

```mermaid
flowchart LR
  subgraph every 5 min
    I[inbox] --> C{classify reply}
    C -- optout / bounce / complaint --> S[(suppression list)]
    C -- interested / not interested / other --> X[stop sequence]
    C -- out of office --> K[keep going]
  end
  subgraph every 20 min, business hours
    D[deliver] --> R[re-read suppression]
    R --> N{next step due?<br/>recipient's clock}
    N -- yes --> P{compliance check}
    P -- pass --> T[send, jitter, log]
    P -- fail --> B[blocked with reason]
  end
```

**Reply classification is order-sensitive on purpose.** `"No thanks"` contains `thanks`; `"I'll stop by the office"` contains `stop`. Checked in the wrong order, a rejection becomes a yes and an interested lead is suppressed forever. The checks run bounce → auto-reply → complaint → opt-out → not interested → interested → other, and quoted history below `On ... wrote:` is ignored. Where two readings are possible, the module picks the one that is cheaper to be wrong about. A misread positive costs one lead. A misread complaint costs the domain.

**Compliance runs on every rendered message.** Messages are blocked when they have an empty subject, an unfilled `{{variable}}`, no opt-out instruction, no postal address (CAN-SPAM), or obvious spam-trigger phrasing. `List-Unsubscribe` and one-click `List-Unsubscribe-Post` headers are set, which Gmail and Yahoo now require from bulk senders.

**Bounded runs.** Each invocation does one small slice (`--max 5`) and exits. The scheduler provides the rhythm. A crash loses nothing, reruns are safe, and on Cloud Run you pay for seconds of compute, not an hour of a process sleeping between sends.

**Suppression is re-read right before every delivery run**, never trusted from an earlier stage.

## Quick start

```bash
git clone https://github.com/autonexuslabs/email-sequence-sender
cd email-sequence-sender
npm install
npm test
npm run demo
```

Your own campaign:

```bash
node bin/sender.js import  --leads leads.json
node bin/sender.js deliver --campaign campaign.json --max 5   # dry: writes outbox/*.eml
SEND_MODE=smtp node --env-file=.env bin/sender.js deliver --campaign campaign.json --max 5
node bin/sender.js inbox   --inbox replies.json
node bin/sender.js report
```

`examples/campaign.json` shows the format: steps with `afterBusinessDays`, templates with `{{variables}}`, the footer, and the send window. SMTP works with Google Workspace, Microsoft 365, Amazon SES, Mailgun, Postmark and others. Replies can come from any source that produces `{ from, subject, body, headers }`. [gmail-reply-tracker](https://github.com/autonexuslabs/gmail-reply-tracker) reads them from Gmail.

Deploying on Cloud Run Jobs + Cloud Scheduler: see [`deploy/README.md`](deploy/README.md).

## Project layout

```text
src/classify.js     reply → bounce / auto_reply / complaint / optout / not_interested / interested / other
src/schedule.js     business days, recipient time zone, next due step
src/message.js      templates, compliance check, RFC 2822 builder
src/run.js          inbox, deliver and report stages
src/store.js        JSON store with atomic writes (swap for Firestore/Redis)
src/transports.js   dry (.eml outbox) and SMTP
bin/sender.js       CLI, one stage per run
deploy/             Dockerfile and Cloud Run Jobs + Scheduler guide
test/               node:test unit tests
```

## Built by

[AutoNexus Labs](https://autonexuslabs.com): AI automation, lead pipelines and data tooling for small businesses.
Want outreach that is safe to leave running? Email **contact@autonexuslabs.com**.

## License

MIT
