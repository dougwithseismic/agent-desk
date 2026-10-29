# PRD 01: `watch`, the desk's mail listener

## Goal

A desk session in the Claude Code app gets woken when mail arrives at the desk's own
addresses. `node desks/desk.mjs watch <desk>` waits for new mail with no model calls, then
prints one line per email and exits; the exit wakes the session. This PRD also fixes the
contract every mail Worker speaks (PRD 03 builds the kit's own; a project's existing Worker
can add the one route).

## Locked decisions

- Addresses come from a `Mail:` header line in `desks/<name>/desk.md`, before the first
  `##`, comma or space separated, matched in lowercase.
- One address belongs to one desk. `doctor` reports a clash, and `watch` refuses to start on one.
- Settings: `DESK_MAIL_URL` (the Worker's base URL) and `DESK_MAIL_TOKEN` (its bearer token),
  from the environment or `desks/.env`, read like the other `DESK_*` settings.
- Where a desk's listener got to is a row in the core table `mail_cursors`, so a restart
  never replays mail and never misses any.
- The first run starts from now (`after=latest`). Backlog is the round's job.
- Handovers: an `inbox` row for this desk, still unhandled, whose `mailbox` isn't one of this
  desk's addresses, was recorded by another desk for this one. It's announced once
  (`mail_cursors.handoff_seen` keeps the last `inbox` rowid announced).
- Only one person listens to a desk: `watch` holds the lock `listen:<desk>`. If someone else
  has it, `watch` stops and says how to take it over.
- A wake line has the inbox id, the address it came to, the sender's address and whether it's
  automatic. Never the subject or body: the session reads the email itself, as data.
- Events go to stdout, everything else to stderr, so it also works as a Monitor stream.
- No dependencies: `fetch`, `node:sqlite` through the existing `open()`/`execute()`.

## The mail contract (v1)

Every `/v1` route takes `Authorization: Bearer <DESK_MAIL_TOKEN>`.

`GET /v1/changes?mailbox=<address>[&mailbox=<address>…]&after=<cursor|latest>[&limit=<1–100>]`

```json
{
  "cursor": "41",
  "messages": [
    {
      "id": "0b7c…",
      "mailbox": "clara@partners.example.com",
      "thread": "5d1e…",
      "from": "jo@acme.com",
      "received_at": "2026-10-29T10:00:00.000Z",
      "auto": false
    }
  ]
}
```

- Inbound mail to those mailboxes only, oldest first, after the cursor. The desk's copies of
  its own sends (alias BCCs) aren't included.
- `cursor` is opaque to the desk. It's the position after the last message returned, or
  `after` unchanged when none. `after=latest` returns no messages and the current position.
- `limit` defaults to 50. A full page means there may be more: `watch` asks again before
  sleeping.
- 400 for a missing `mailbox` or a bad `after`, 401 for a wrong token.
- The desk's inbox id for a message is `mail:<mailbox>:<id>`.

## Acceptance criteria

- WHEN mail arrives at a desk's address while `watch <desk>` runs, the system SHALL print one
  line per email to stdout, save the new cursor, and exit 0 within one poll interval.
- WHEN `watch` runs again, the system SHALL NOT print mail it already printed.
- WHEN `watch` runs for the first time for a desk, the system SHALL start from the Worker's
  current position and print nothing older.
- WHEN another desk records an unhandled `inbox` row for this desk from an address this desk
  doesn't own, the system SHALL print it once, in the same run as any new mail.
- WHEN nothing arrives within `--max` (default 25m), the system SHALL print one "no new mail"
  line and exit 0.
- WHEN the Worker answers 401 or 400, the system SHALL exit 1 at once with a message that says
  what to fix, without printing the token.
- WHEN the Worker can't be reached or answers 5xx three polls in a row, the system SHALL exit 1
  and say so. A single failure SHALL only be retried.
- WHEN another person holds `listen:<desk>`, the system SHALL refuse to start and name them,
  and `take listen:<desk>` SHALL hand it over.
- WHEN two desks list the same address, `doctor` SHALL report it and `watch` SHALL refuse.
- WHEN the desk has no `Mail:` line, or `DESK_MAIL_URL`/`DESK_MAIL_TOKEN` aren't set, `watch`
  SHALL say exactly what to add and where.
- `watch` SHALL ask the Worker only for the desk's own addresses.

## Tasks

1. `desksOnDisk()` reads `Mail:`; a helper finds clashes.
2. `core.sql`: `CREATE TABLE IF NOT EXISTS mail_cursors` (desk, cursor, handoff_seen,
   checked_at, by). New table, so no migration.
3. `watch` in `desk.mjs`: flags `--every <seconds>` (default 30) and `--max <duration>`
   (default 25m); the lock; the poll loop; handovers; failures; output.
4. `doctor`: address clashes; mail settings when any desk has a `Mail:` line.
5. Help text, `.env.example`, `README.md` (desks), `kit/guide/anatomy.md` header lines.
6. Tests against a fake Worker served from the test (node:http), covering every criterion.

## Implementation Notes

(Filled in after shipping.)
