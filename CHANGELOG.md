# Changelog

What changed in the desk kit, newest first. Update a project with `node bin/kit.mjs <project>`.

## 2026-10-30

### "/desk <name> listen" is understood straight away · Fixed
- The desk skill's description now says what listening is and lists "/desk <name> listen",
  "listen to the <name> desk" and "stop listening", and typing `/desk` hints at
  `[<desk>] [listen]`. Before, only the skill's body mentioned listening.

### A listening desk's chat hears its tasks and its schedule, not only mail (PRD 06) · New
- While a chat listens to a desk ("/desk <name> listen"), it's woken when one of the
  agent's tasks or checks comes due, and at the times in the desk's new `Round:` line
  (`Round: weekdays 09:00`), where it runs a round.
- It no longer wakes every 25 minutes just to start listening again: it waits as long as
  it takes.
- A chat that was closed catches up once when it listens again: one line per task, and one
  round that says how many were missed.
- Desks without a `Mail:` line can listen too, for tasks and rounds.
- `status` says who is listening to each desk, and when their listener last looked.
- Try it: add `Round:` to a desk's `desk.md` (`desks/kit/guide/anatomy.md`), then
  "/desk <name> listen".

### A claim that gets nothing now stops a send chained after it · Fixed
- `node desks/desk.mjs sql --expect-rows "UPDATE ... RETURNING id" && <send>` exits 1 when
  the claim gets no row back, so the send never runs. Before, "(no rows)" still exited 0,
  and `&&` only stopped on an outright refusal.
- `actions.md` shows the chain.

### A desk that already files its mail one way can listen without changing it · Improved
- A project with its own mail Worker, whose desks record mail as `acme-mail:<mailbox>:<id>`,
  sets `DESK_MAIL_PREFIX=acme-mail` and `watch`, `mail` and `send` use the same word, so
  mail that arrives while a desk listens matches the rows it already has.
- When the listener wakes such a desk, it reads and sends with the mail tool its own
  playbooks name, so the project's Worker only needs the one route the listener uses.
- Try it: "The contract, for a project with its own Worker" in `desks/kit/mail/README.md`.

## 2026-10-29

### Setting up desk mail is safer, and you can try it all on your machine (PRD 05) · Improved
- The mail Worker's local token and state stay out of git: the kit and `init` add them to
  `desks/.gitignore`, and `doctor` warns if the token file isn't ignored.
- Updating the kit never copies or deletes what wrangler and npm leave in its folders, and
  installing it no longer stops over unrelated uncommitted work in your project.
- The setup uses `npx wrangler@latest`, because an older wrangler can't run the Worker,
  and shows how to run it locally and deliver a test email to a desk.
- The kit's own `pnpm e2e` runs the whole loop against the real Worker on this machine:
  an email arrives, the desk wakes, the approved reply goes once, and a reply that's out of
  date is refused.
- Try it: "Running it locally" in `desks/kit/mail/README.md`.

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
