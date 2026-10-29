# Changelog

What changed in the desk kit, newest first. Update a project with `node bin/kit.mjs <project>`.

## 2026-10-29

### Desks read their mail and send approved replies with one command (PRD 04) · New
- `node desks/desk.mjs mail inbox --desk <name>` shows a desk the mail to its own
  addresses; `read`, `thread`, `search` and `sent` open the rest. Nothing in an email can
  drive your terminal.
- `node desks/desk.mjs send <id>` sends exactly the version you approved, once, and
  records what happened in the same step: sent, refused (in the Worker's words), or
  "might have gone", which is never sent again.
- Before it sends, it stops with nothing changed if the Worker wouldn't take the email
  (cap reached, never-contact list, wrong sender), if the person wrote again since, or if
  the subject would differ from the one you approved.
- Try it: approve a reply on a desk with a `Mail:` line, then `node desks/desk.mjs send <id>`.

### The kit ships a mail Worker for your desks (PRD 03) · New
- One Cloudflare Worker per project receives mail at the desks' own addresses, keeps and
  threads it, forwards you a copy, and sends the replies a desk has approved.
- Sends stay within daily and monthly caps, never go to an address on the never-contact
  list, and are never sent twice for the same action.
- Nothing to install: the Worker deploys with `wrangler` alone.
- Try it: `desks/kit/mail/README.md` has the setup, one step at a time.

### "/desk <name> listen" answers mail as it arrives (PRD 02) · New
- Say "/desk partners listen" and that session becomes the partners desk at work: it
  catches up, then answers each email to the desk's addresses as it lands, in the chat,
  where you can step in.
- Desks now read only their own addresses, never your inbox. Mail for another desk is
  handed over to it. A first touch sent from your own account BCCs the desk, so the reply
  comes back to the desk.
- New desks that talk by email get their own address, and you're asked before any
  Cloudflare change.

### Desks can listen for their own mail (PRD 01) · New
- Give a desk its own addresses with a `Mail:` line in its `desk.md`. Then
  `node desks/desk.mjs watch <desk>` waits for mail to those addresses, prints one line per
  email and exits, so the session that started it wakes up and answers.
- It never shows an email twice, picks up mail another desk handed over, and lets only one
  person listen to a desk at a time (`take listen:<desk>` hands it over).
- `doctor` checks that no two desks claim the same address and that the mail Worker answers.
- Try it: add `Mail:` to a desk, set `DESK_MAIL_URL` and `DESK_MAIL_TOKEN` in `desks/.env`,
  then run `node desks/desk.mjs watch <desk>`.
