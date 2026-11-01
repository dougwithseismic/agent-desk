# Decisions

Settled choices for the desk kit. Add new calls with their date. `AGENTS.md` has the
standing rules for changing the kit; this file has what was decided on top of them.

## How autopilot runs here

- **Status**: Running. Wave 3 since 1 Nov (Doug: "Please go into autopilot and design this").
- **Ship rights**: none recorded. Each round is built in its own worktree, then merged into
  `main` locally. Nothing is pushed to `origin` until Doug says so (his global rule, and
  `AGENTS.md`).
- **Second repo**: wave 3's starter rows (PRDs 18–20) are built in
  the public `react-saas-starter` repo, under the same rules: local merges, no push
  without his yes. Its PRDs move into that repo when its lane starts.
- **Base branch**: `main`. Claims are commits on local `main` (`docs: claim PRD <nn>`).
- **Deploy targets**: none. The kit isn't deployed anywhere. A project's mail Worker is
  deployed by that project, and only with Doug's yes.
- **The real surface**: `pnpm test` green, the kit installed into a throwaway project with
  `node bin/kit.mjs <dir>`, and the mail Worker run on this machine with `wrangler dev`
  for the end-to-end check (mail in, `watch` wakes, a reply goes out).
- **Test account**: none.
- **Third-party services changed unattended**: none. No Cloudflare changes and no client
  project changes without asking. Stripe: test mode only, and only in a throwaway project or
  the starter. No scheduled tasks are created without Doug's yes.
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

## A GM runs the business (2026-11-01)

Doug, 1 Nov: the desks work, in that a task gets done and a desk can reach out, but nothing
minds the commercial side, so a person still prompts every step. He asked for an agent that runs
the business and delegates to the desks: it oversees the other agents, works towards commercial
goals, makes decisions, and has trust and spot-check mechanisms. Later the same day: the kit
should have the tools, skills and resources to make revenue with Stripe; a business can launch
new initiatives such as an affiliate program, with desks emailing potential affiliates in the
meantime; and one central skill should delegate and start Claude Code sessions without a yes box
for each one. He wants the same in the React SaaS starter.

- **The GM is a desk.** One per business, in the same database as the desks it runs, so it
  reads their boards, measures, trust and log directly. Its headline is money (revenue or MRR,
  read from Stripe) against a target the person sets. The kit calls it `gm`; a business can
  give it a name, as it does its other desks.
- **Delegating is a channel.** The GM briefs a desk with an action on channel `desk`, target
  `desk:<name>`. Sending it creates a task on that desk, which wakes the desk's listening chat.
  Briefs earn trust the way emails do: shown at first, then alone with every fifth in full. A
  brief never approves anything: the receiving desk's own sends still need their own trust.
- **The GM briefs, it doesn't do** (Doug, 1 Nov, after reading a published design for
  always-on agents whose router hands out work and never does it, and whose tests found a
  model told to delegate still did the work itself some of the time). A GM desk's own actions
  are briefs and initiatives; anything that goes out into the world goes through the desk that
  owns it. The database refuses any other action on a GM desk (PRD 15), because a prompt isn't
  enough.
- **A watchdog** (same day). Something has to notice stalled work without a person looking: a
  desk with work and nobody listening, a brief past its due, an action stuck sending or
  uncertain, audits left undone, a headline nobody measured. One view lists them; the GM's
  round reads it first and `status` shows it (PRD 16). Running desks from the cloud so they
  work with the Mac asleep is parked, not dropped.
- **Agents tighten, people loosen.** An agent working under its own name may pause work (a
  hold), revoke what's allowed and take trust away. It can't approve, grant `allowed`, release a
  hold someone else placed, or loosen trust settings. The database refuses those writes. Like
  every guard here, this stops mistakes, not an agent that writes a person's name on purpose.
- **Spot checks go both ways.** The person sees every fifth GM decision of a trusted kind in
  full. The GM audits a sample of what each desk sent on its own, and a failed audit takes that
  kind's trust away. Nobody audits their own work.
- **The person's part is one brief a day.** Money against the target, a line per desk, what
  went out alone, what's stuck, and numbered yes/no questions. Their answers are recorded as
  decisions, in their words.
- **Money stays with a person.** Prices, refunds, payouts, live-mode keys, contracts, spending
  and anything published in the person's name are always-human kinds. Stripe is read through a
  restricted read-only key; a Stripe write is an action a person makes.
- **Starting sessions.** In the Claude Code app a session can't start another on its own:
  `start_session` shows a card unless the person asked in words, and it's refused on turns that
  another session or an automated event started. A scheduled task saved in auto or bypass mode
  does run on its own, and `run_scheduled_task` starts one now, as a new visible session. So
  each desk gets an on-demand task that listens as that desk, created once with the person's
  yes, and the GM runs it when the desk has work and nobody is listening. The GM's own day
  starts from a scheduled task too. Desks still work in visible chats in the app, as decided on
  30 Oct; elsewhere (Codex) the GM asks the person to open the chat.
- **Bypass mode moves the guard into the database.** With no tool prompts, the triggers and the
  restricted keys are what stop a mistake, so everything that leaves the machine goes through
  an action: email, site changes, Stripe, payouts.
- **Order.** Wave 3 goes before the rest of wave 2 (PRDs 07–10), because the desks need to move
  the business, not just run.
- **The starter** gets Stripe billing, an affiliate program built on it, and the kit with a GM
  and an affiliates desk reading the app's own data.

## How listening works

- `desk.md` names a desk's addresses in a header line: `Mail: clara@partners.example.com,
  partners@example.com`. One address belongs to one desk.
- `node desks/desk.mjs watch <desk>` asks the project's mail Worker for new mail at those
  addresses (`DESK_MAIL_URL`, `DESK_MAIL_TOKEN` in `desks/.env`). When there's some, it
  saves where it got to in the database, prints one line per email and exits. The exit
  wakes the session.
- Since PRD 06 (30 Oct) it also wakes the chat for the agent's tasks and checks as they
  come due (once each while they stay due), and for the desk's schedule, a `Round:` line
  in `desk.md` such as `Round: weekdays 09:00`, in the listening machine's local time.
  Several missed slots make one wake that says how many. A desk without `Mail:` listens
  for these without mail settings. What has woken the chat is kept in the `listeners`
  table, so a restart never repeats a wake and a chat that was closed catches up once.
- It waits as long as it takes: no quiet-spell exit, so no idle wakes. `--max` still ends
  a quiet wait, for a runner that needs it. (Until 30 Oct it exited after 25 quiet minutes.)
- It makes no model calls while waiting. The token never reaches the chat.
- The first run starts from now, for mail, tasks and rounds. The backlog is the round's
  job, which `listen` does first.
- Mail recorded in `inbox` for another desk, from an address that desk doesn't own, is a
  handover. It wakes that desk once.
- Only one person listens to a desk at a time: `watch` holds the lock `listen:<desk>`.
  `status` shows who, and when their listener last looked. A running `watch` stops at its
  next look if the lock changes hands or a newer `watch` for the desk starts, so one desk
  never wakes two chats.
- A wake line carries the id, the address and the sender only, never the subject or body.
  The session reads the email itself, as data.
- A woken desk answers and records what came in, or does the task or check it was woken
  for. It starts no new outreach; rounds do that, and a round line runs one.

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
