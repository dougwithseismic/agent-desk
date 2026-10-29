# The mail Worker

The project's mailbox for its desks, on Cloudflare. One Worker per project, shared by all
its desks. It:

- receives mail at the desks' own addresses (Email Routing), and refuses any other address;
- stores and threads every email in D1, and forwards a copy to you, so you can read along;
- tells a listening desk about new mail (`node desks/desk.mjs watch <desk>`);
- shows desks their mail (`node desks/desk.mjs mail inbox --desk <desk>`, `read`,
  `thread`, `search`, `sent`, `status`);
- sends the replies a desk has approved (Email Sending, through
  `node desks/desk.mjs send <action id>`), within daily and monthly caps, never to a
  suppressed address and never twice for the same action.

The code is here, in `desks/kit/mail/`, and is replaced when the kit is updated. The
project's settings are in `desks/mail/wrangler.jsonc`, which the kit never touches.
Nothing to install: the one library it uses is copied into `vendor/`.

Each desk that answers mail lists its addresses in a `Mail:` line in its `desk.md`. An
address belongs to one desk. Desks read only these addresses, never your own inbox.

## Set it up

Ask the person before each Cloudflare change: DNS, routing rules, Email Sending, the
database, the secret and the deploy. `kit/guide/cloudflare-mail.md` covers the Cloudflare
side in depth: what to look at first, the records, and how to check each layer.

1. **Pick the addresses.** A subdomain just for desk mail, such as `partners.example.com`,
   so its MX can point at Cloudflare without touching the domain's own mail. One persona
   or role address per desk: `clara@partners.example.com`.
2. **The settings.** Copy `desks/kit/mail/wrangler.example.jsonc` to
   `desks/mail/wrangler.jsonc` and fill in each value marked "yours": the Worker's name,
   `MAILBOXES` (every desk address), `SENDERS` (the addresses it sends as, with display
   names), `FORWARD_TO` (your inbox, verified in Email Routing first, or `[]`) and the
   three caps. Start the caps low while a new sending domain warms up.
3. **The database.** From `desks/mail/`:

   ```sh
   npx wrangler d1 create <project>-mail          # paste the database_id it prints
   npx wrangler d1 migrations apply <project>-mail --remote
   ```

4. **The token**, made and set without printing it, from `desks/mail/`:

   ```sh
   printf 'DESK_MAIL_TOKEN=%s\n' "$(openssl rand -hex 32)" >> ../.env
   grep '^DESK_MAIL_TOKEN=' ../.env | cut -d= -f2- | npx wrangler secret put MAIL_API_TOKEN
   ```

5. **Deploy**: `npx wrangler deploy`. A new version takes up to a minute to reach every
   location. Put the Worker's address in `desks/.env` as
   `DESK_MAIL_URL=https://<name>.<account-subdomain>.workers.dev`.
6. **Receiving.** Turn Email Routing on for the domain (`npx wrangler email routing enable
   example.com`) and add the subdomain's routing records (`npx wrangler email routing dns`,
   or the dashboard). Then add one rule per address that sends it to the Worker:

   ```sh
   npx wrangler email routing rules create example.com --match-type literal --match-field to \
     --match-value clara@partners.example.com --action-type worker --action-value <name>
   ```

   A new address needs both a rule and a `MAILBOXES` entry.
7. **Sending.** `npx wrangler email sending enable partners.example.com`, then add the DKIM
   and return-path records it gives (at `cf-bounce._domainkey.<sub>` and `cf-bounce.<sub>`)
   and a DMARC record with `p=reject` at `_dmarc.<sub>`. DMARC matters twice: it protects
   the desks' good name, and it stops a stranger forging mail from a desk's own address,
   which the Worker would otherwise file as the desk's own copy.
8. **Check.** `node desks/desk.mjs doctor` says whether the Worker answers. Send an email to
   a desk address from another account, then run `node desks/desk.mjs watch <desk>`: it
   prints the email's line within half a minute.

Wrangler's login needs the workers, d1, email_routing and email_sending scopes. It can't
edit DNS: use the dashboard for records. Test sends go to your own address or a suppressed
one. The account's daily sending quota is shared by every domain on the account.

**Sending from your own account.** A first touch can go from a Google Workspace "Send mail
as" alias for the desk's address. Put the desk's address in BCC: the Worker keeps that copy
as the desk's own (not new mail), so the thread and the reply stay the desk's. The alias's
From must be one of `SENDERS`.

**Running it locally.** `npx wrangler dev` from `desks/mail/` runs it on this machine with
a local database, and simulates sends without sending anything. Put
`MAIL_API_TOKEN=<32+ characters>` in `desks/mail/.dev.vars`. Keep `.dev.vars` and
`.wrangler/` out of git.

## The API

Every `/v1` route takes `Authorization: Bearer <MAIL_API_TOKEN>`. `GET /health` is open.
Errors are `{ "error": "<what to do>", "code": "<CODE>", ... }`.

| Route | What it does |
| --- | --- |
| `GET /v1/changes?mailbox=<a>[&mailbox=<b>]&after=<cursor\|latest>[&limit=1-100]` | New inbound mail for those addresses, oldest first (the contract below) |
| `GET /v1/messages?mailbox=&direction=in\|out&auto=&own=&thread=&key=&q=&limit=` | Mail, newest first, with a snippet of each |
| `GET /v1/messages/<id>` | One email whole: `text`, `fresh` (the text without the quoted thread), `html`, headers |
| `GET /v1/threads/<thread>` | A conversation, oldest first; the id of an email in it works too |
| `POST /v1/send` | Sends one approved email (below) |
| `GET /v1/status` | Mailboxes, senders, caps used today and this month, inbox counts |
| `GET /v1/suppressions`, `POST /v1/suppressions`, `DELETE /v1/suppressions/<address>` | The never-contact list: `{ "address", "reason" }` |

`POST /v1/send` takes `{ key, from, to[], cc?[], bcc?[], subject?, text, html?, reply_to?,
approved: true }`. `key` is the action's key (`reply:mail:5d1e`): a key that's sending or
sent is never sent again. `reply_to` is a stored message id: the reply is threaded and,
without `to`, goes to its sender. Unknown fields are refused, so a misspelt one can't send something else.
With `check: true` it runs every refusal below and answers `{ ok, check, first_touch,
subject }`, storing and sending nothing: `desk.mjs send` asks that before it claims the
action, and stops if the subject isn't the action's title.
Refusals store nothing:

| Status, code | Why |
| --- | --- |
| 400 `BAD_INPUT`, `SENDER` | Something's missing or wrong, or `from` isn't one of `SENDERS` |
| 409 `NEEDS_APPROVAL` | `approved` isn't `true` |
| 409 `SUPPRESSED` | A recipient is on the list (`addresses`) |
| 409 `DUPLICATE` | That key was already sent or is sending (`id`, `status`) |
| 409 `STALE` | A reply to an email the sender has written again since (`id`, `mailbox` of the newer one) |
| 429 `CAP` | A cap is reached (`cap`, `used`, `limit`) |
| 502 `SEND_FAILED` | Email Sending refused it; stored as failed (`id`, `provider_code`) |

## The contract, for a project with its own Worker

A project that already runs a mail Worker can keep it and add the one route `watch` needs:

`GET /v1/changes?mailbox=<address>[&mailbox=<address>…]&after=<cursor|latest>[&limit=<1–100>]`,
with `Authorization: Bearer <token>`, answering:

```json
{
  "cursor": "41",
  "messages": [
    { "id": "0b7c…", "mailbox": "clara@partners.example.com", "thread": "5d1e…",
      "from": "jo@acme.com", "received_at": "2026-10-29T10:00:00.000Z", "auto": false }
  ]
}
```

- Inbound mail to those addresses only, oldest first, after the cursor. Leave out the
  desks' own copies of their sends.
- `cursor` is opaque to the desk: the position after the last message returned, or
  `after` unchanged when there are none. `after=latest` returns no messages and the
  current position. Order by something that follows commit order, not by time.
- `limit` defaults to 50; a full page means there may be more.
- 400 for a missing `mailbox` or a bad `after`, 401 for a wrong token.
- A desk records the message in its `inbox` as `mail:<mailbox>:<id>`.

`watch` needs only that route. `desk.mjs mail` and `desk.mjs send` use the rest of the API
above, including `check: true`, so they need the kit's Worker.
