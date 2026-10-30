# Decisions

Settled choices for the desk kit. Add new calls with their date. `AGENTS.md` has the
standing rules for changing the kit; this file has what was decided on top of them.

## How autopilot runs here

- **Status**: Running.
- **Ship rights**: none recorded. Each round is built in its own worktree, then merged into
  `main` locally. Nothing is pushed to `origin` until Doug says so (his global rule, and
  `AGENTS.md`).
- **Base branch**: `main`. Claims are commits on local `main` (`docs: claim PRD <nn>`).
- **Deploy targets**: none. The kit isn't deployed anywhere. A project's mail Worker is
  deployed by that project, and only with Doug's yes.
- **The real surface**: `pnpm test` green, the kit installed into a throwaway project with
  `node bin/kit.mjs <dir>`, and the mail Worker run on this machine with `wrangler dev`
  for the end-to-end check (mail in, `watch` wakes, a reply goes out).
- **Test account**: none.
- **Third-party services changed unattended**: none. No Cloudflare changes and no client
  project changes without asking.
- **Loop**: the build is bounded and has no deploy waits, so rounds are chained in the
  session rather than through `/loop`.
- **Market scan and launch bar**: not used. This is an internal kit, not a product for sale.
  The done bar in `docs/BACKLOG.md` takes the launch bar's place.

## Desks answer mail as it arrives (2026-10-29)

- A desk answers email as it comes in, in its own session in the Claude Code app. Doug: "i
  just want the desk in the claude code app to respond to emails as they come in". No
  Telegram, and no cloud routines.
- Most desks keep the local database. Doug: "Probably a local db for most of them honestly."
  So the listener runs on the machine, beside the session.
- One desk is one agent working, in one session. Doug: "think 1 desk is 1 agent working".
  `/desk <name> listen` is the way in, not a per-desk command (see the memory on aliases).
- Confirmed on 30 Oct, after a morning planning headless runs: events land in the desk's
  chat in the app. See "Desks work in their own chat" below.
- A desk reads only the addresses it owns, and never the person's own inbox. The live desks
  read Doug's Gmail, where desk aliases forward, and he agreed that's wrong ("which is weird
  right?").
- A client project that already works this way is the model: its desk sends from its own
  address on a partners subdomain, and every reply comes back. A desk has its own address on
  a subdomain whose MX is Cloudflare, so every reply lands in the project's mail Worker,
  however the email went out. The forward to Doug is a copy for him only.
- The kit ships the mail Worker (Doug: "Kit ships it"). There's one per project, shared by
  the project's desks, the same line the database draws.

## Desks work in their own chat (2026-10-30)

Doug: "the agent desk should be something we can command, 'Hey, go install this', and have
it execute automatically", extensible because "we may also have an SEO desk", on "the best
possible infrastructure".

- **Engine: the desk's own chat in the Claude Code app.** Doug first picked headless runs
  on his Mac, then changed his mind the same morning: "our Claude Code desktop chat should
  be receiving these", and "today a chat listens - thats probably the right one honestly".
  `watch` wakes the desk's chat when there's something to do. There's no headless runner.
  A desk stops while the app is closed or the Mac sleeps. Its mail waits in the Worker, and
  the chat catches up when it listens again. Managed Agents stays in the parking lot for a
  desk that must work with the Mac off.
- **One desk is one agent, in one chat** that holds `listen:<desk>`. The database is the
  desk's memory, so nothing that matters is lost when the chat compacts.
- **Approvals don't change.** An action that needs a person waits in the database, and the
  person clears it with `/desk`, in the desk's chat or any other.
- **The desk's tools are typed.** `desk.mjs` serves its commands as tools as well as on the
  command line, so a desk's chat can be allowed its tools by name rather than by shell
  pattern.
- **Install is one command, with one yes per project.** Once Doug approves a desk for a
  project, the install sets up its mail (Cloudflare) and its database (Railway) without
  asking at each step, and records his yes with the date. Anything that costs money still
  asks.
- **Desk types.** The kit ships desk types, each a template of plan, playbooks, tables,
  tools and triggers. Outreach and SEO come first.

## How listening works

- `desk.md` names a desk's addresses in a header line: `Mail: clara@partners.example.com,
  partners@example.com`. One address belongs to one desk.
- `node desks/desk.mjs watch <desk>` asks the project's mail Worker for new mail at those
  addresses (`DESK_MAIL_URL`, `DESK_MAIL_TOKEN` in `desks/.env`). When there's some, it
  saves where it got to in the database, prints one line per email and exits. The exit
  wakes the session. It also exits after a quiet spell (25 minutes by default) so it works
  under any background runner.
- It makes no model calls while waiting. The token never reaches the chat.
- The first run starts from now. The backlog is the round's job, which `listen` does first.
- Mail recorded in `inbox` for another desk, from an address that desk doesn't own, is a
  handover. It wakes that desk once.
- Only one person listens to a desk at a time: `watch` holds the lock `listen:<desk>`.
- A wake line carries the id, the address and the sender only, never the subject or body.
  The session reads the email itself, as data.
- A woken desk answers and records what came in. It starts no new outreach; rounds do that.

## The mail Worker

- Generalised from a client project's mail Worker (read-only source, never edited from here).
  It's the mailbox and the transport only: holds, trust and approvals stay in the desk
  database.
- Plain JavaScript modules, no framework. `postal-mime` is vendored into the kit, so a
  project needs no install step, only `wrangler`.
- D1 for storage. Settings are JSON vars in the project's `desks/mail/wrangler.jsonc`.
  The code is kit-owned, in `desks/kit/mail/`.
- It never changes the text it's given: the approved text is the text that goes, signature
  included.
- Every send carries a key, and the Worker refuses a second send with the same key, so a
  retry after a timeout can't send twice.
- Caps count every send through the Worker, since a project's desks share a sending domain.
- Cloudflare Email Sending is for transactional mail only. Cold first touches go through a
  Google Workspace "Send mail as" alias, BCC'ing the desk's own address so the Worker keeps
  the sent copy, and the desk never has to read Gmail.
