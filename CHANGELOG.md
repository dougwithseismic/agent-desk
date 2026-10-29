# Changelog

What changed in the desk kit, newest first. Update a project with `node bin/kit.mjs <project>`.

## 2026-10-29

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
