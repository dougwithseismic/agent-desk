# PRD 03: The kit's mail Worker

## Goal

Every project gets the same mailbox for its desks: a Cloudflare Worker that receives mail at
the desks' addresses, stores and threads it, forwards a copy to the person, and sends the
replies a desk has approved. It speaks the mail contract in `docs/prds/01-watch.md`, so
`watch` works with it as soon as it's deployed. Generalised from the mail
Worker a client project already runs (read-only), which has answered a partner desk's mail
since 14 Oct 2026.

## Locked decisions

- **Where**: kit-owned code in `template/desks/kit/mail/` (installed as `desks/kit/mail/`,
  replaced on every kit update). The project's own settings live in `desks/mail/wrangler.jsonc`,
  made from `kit/mail/wrangler.example.jsonc`, whose `main` is `../kit/mail/src/index.js` and
  whose `migrations_dir` is `../kit/mail/migrations`.
- **Plain JavaScript** ES modules, no TypeScript build and no framework (no hono). A small
  router in `src/api.js`.
- **`postal-mime` is vendored** in `kit/mail/vendor/postal-mime/` from the npm package's
  published source, with its MIT licence and the version in `vendor/README.md`. Nothing
  else is a runtime dependency, so a project deploys with `wrangler` only.
- **Storage**: D1, one database per project. Migration `0001_mail.sql`: `messages` (in and
  out), `suppressions`. A `seq` column, unique, set inside the insert statement as
  `(SELECT coalesce(max(seq), 0) + 1 FROM messages)`, orders the changes feed. Timestamps
  can't, because two receives can commit out of order.
- **Settings** are JSON vars:
  - `MAILBOXES`: every address the Worker receives for (array);
  - `SENDERS`: `{ "address": "Display name" }`, the addresses it may send as;
  - `FORWARD_TO`: array of verified destinations for the person's copy;
  - `FIRST_TOUCH_DAILY_LIMIT`, `DAILY_SEND_LIMIT`, `MONTHLY_SEND_LIMIT`: numbers.
  The secret `MAIL_API_TOKEN` authenticates every `/v1` route. `GET /health` is open.
- **It never changes the text it's given.** No signature is added: the desk puts it in the
  body, so the approved text is the text that goes.
- **Every send has a `key`** (the desk's action key). A second send with a key already sent
  or sending is refused with 409 `DUPLICATE` and the first message's id, so a retry after a
  timeout can't send twice.
- **Caps count every send through the Worker** (a project's desks share a sending domain).
  A first touch is a new email, not a reply, to an address that has never written to any of
  the Worker's mailboxes.
- **Own copies**: inbound mail whose From is one of `SENDERS` (an alias send BCC'd to the
  desk) is stored with `own = 1` and left out of `/v1/changes`. The desk finds it by
  Message-ID to verify the alias send.
- **Inbound**: parse with postal-mime; pick the mailbox from the envelope recipient; refuse
  (`setReject`) mail for an address not in `MAILBOXES`; keep the headers worth judging by
  (auto-submitted, list-id, precedence, authentication-results, and the like); mark
  automatic mail (`auto = 1`); thread by In-Reply-To/References, then by our latest send to
  that sender with the same subject; cut very long text and HTML (D1 rows are capped at
  2 MB). Store first, then forward a copy to each `FORWARD_TO`. A storage failure throws, so
  Email Routing retries or reports it; a forward failure is logged only.
- **Outbound** goes through the `send_email` binding (`EMAIL`), as the Worker it comes from does. Replies get
  In-Reply-To and References from the stored parent and "Re: " on the subject once. Email
  Sending's refusal is stored as `failed` and answered with 502. A recipient refused as
  suppressed goes on the suppression list.

## API

Bearer `MAIL_API_TOKEN` on every `/v1` route, compared in constant time.

| Route | |
| --- | --- |
| `GET /health` | `{ ok: true }`, no token |
| `GET /v1/changes` | The contract in PRD 01 |
| `GET /v1/messages?mailbox=&direction=&auto=&own=&thread=&q=&key=&limit=` | Newest first |
| `GET /v1/messages/:id` | One email, with `fresh`: the text without quoted history |
| `GET /v1/threads/:id` | A conversation, oldest first |
| `POST /v1/send` | `{ key, from, to[], cc?[], bcc?[], subject?, text, html?, reply_to?, approved }` |
| `GET /v1/status` | Sends today and this month against each cap; inbox counts |
| `GET /v1/suppressions`, `POST /v1/suppressions`, `DELETE /v1/suppressions/:address` | Never-contact list |

`POST /v1/send` answers 200 `{ id, message_id, status: "sent" }`, or refuses: 400 for bad
input or a sender not in `SENDERS`; 409 `NEEDS_APPROVAL` without `approved: true`, 409
`SUPPRESSED`, 409 `DUPLICATE`; 429 `CAP` naming which cap; 502 when Email Sending refuses.
A refused send isn't stored, apart from a 502, which is stored as `failed`. `reply_to` is a
stored message's id: the reply goes to its sender (or, for our own sent message, its
recipients) and threads with it.

## Acceptance criteria

- WHEN mail arrives for an address in `MAILBOXES`, the Worker SHALL store it once with a new
  `seq`, thread it, forward a copy to each `FORWARD_TO`, and it SHALL appear in
  `/v1/changes` for that mailbox.
- WHEN mail arrives for any other address, the Worker SHALL reject it and store nothing.
- WHEN storing fails, the email handler SHALL throw.
- WHEN a forward fails, the Worker SHALL still keep the stored email.
- WHEN an alias send BCCs the desk, the Worker SHALL store it with `own = 1`, and it SHALL NOT
  appear in `/v1/changes`.
- `/v1/changes` SHALL return only inbound mail for the mailboxes asked, oldest first, after the
  cursor; `after=latest` SHALL return the current position and no messages.
- WHEN a `/v1` request has no token or the wrong one, the Worker SHALL answer 401.
- WHEN `POST /v1/send` lacks `approved: true`, or names a sender not in `SENDERS`, or a
  suppressed recipient (to, cc or bcc, matched in any case), or a key already used, or would
  pass a cap, the Worker SHALL refuse it as above and send nothing.
- WHEN Email Sending accepts it, the Worker SHALL store it as `sent` with the Message-ID it
  returned; WHEN it refuses, as `failed` with the error, answering 502.
- A reply SHALL carry In-Reply-To and References and thread with its parent.
- The Worker SHALL send exactly the text it was given.

## Tasks

1. Vendor postal-mime (`npm pack postal-mime@latest` in the scratchpad; copy its `src/` and
   `LICENSE`). Record the version.
2. `migrations/0001_mail.sql`.
3. `src/index.js` (`fetch`, `email`), `src/inbound.js`, `src/outbound.js`, `src/store.js`,
   `src/api.js`, `src/mail.js` (address, automatic-mail, Message-ID and threading helpers;
   `fresh` text).
4. `wrangler.example.jsonc` with every setting explained in comments.
5. `test/mail.test.mjs` (node:test, no dependencies): a D1 stand-in over `node:sqlite` that
   applies the real migration; a fake `send_email` binding; fake inbound messages from raw
   RFC 5322 strings. One test per criterion, and one per refusal.
6. `package.json` test script runs both test files.

The kit's `README.md` for the Worker (`kit/mail/README.md`) is written by the lead, not
in this PRD.

## Implementation Notes

(Filled in after shipping.)
