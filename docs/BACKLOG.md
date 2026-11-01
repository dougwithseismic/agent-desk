# Backlog

`[ ]` to do, `[~]` shipped up to a seam (named), `[x]` done end to end.

## Done bar

What "desks answer mail as it arrives" needs before it's finished:

- [x] A desk with a `Mail:` line wakes its listening session within a minute of mail
      arriving at its address. (`pnpm e2e`, with the Worker under `wrangler dev`)
- [x] Mail handed over by another desk wakes the right desk, once.
- [x] Only one person listens to a desk at a time, and two desks can't claim one address.
- [~] A project can stand up the kit's mail Worker from the kit alone (its config and one
      deploy), and the Worker stores, threads and forwards mail, and sends approved replies
      within caps, never to suppressed addresses and never twice. (Stood up from the kit
      alone under `wrangler dev`; no deploy yet: needs a project's yes.)
- [x] A desk sends with `desk.mjs send <id>`: exactly the stored version, result recorded.
- [x] The playbooks say a desk owns its addresses and never reads the person's own inbox,
      and alias sends BCC the desk's address.
- [x] Every guard has a test that fails without it, and `pnpm test` is green.

## Wave 1: desks answer mail as it arrives

- [x] (merged 2026-10-29) **PRD 01** `watch`: the `Mail:` line, the mail contract, the cursor and the listener
      (`docs/prds/01-watch.md`)
- [x] (merged 2026-10-29) **PRD 02** Listening in the desk skill, and the mailbox rules (`docs/prds/02-listen.md`).
      Needs 01.
- [~] (merged 2026-10-29; not yet deployed anywhere: needs a project's yes) **PRD 03** The kit's mail Worker (`docs/prds/03-mail-worker.md`). Needs 01's contract
      only.
- [~] (merged 2026-10-29; checked with `wrangler dev`, not against a deployed Worker: needs a project's yes) **PRD 04** `desk.mjs mail` and `desk.mjs send <id>` (`docs/prds/04-mail-client.md`).
      Needs 03.
- [x] (merged 2026-10-29; `pnpm e2e` runs it against the real Worker under `wrangler dev`) **PRD 05** Installing the mail Worker, and the end-to-end check
      (`docs/prds/05-install.md`). Needs 02, 03, 04.

## Wave 3: a GM runs the business towards money

Decided 1 Nov (`docs/DECISIONS.md`, "A GM runs the business"). Goes before the rest of wave 2.

### Done bar

- [ ] In a throwaway project with a GM and two desks, the GM briefs a desk, that desk's
      listening chat wakes for the brief once, and the result comes back to the GM.
- [ ] The GM reads revenue, MRR and new customers from Stripe (test mode) through a read-only
      key and records them; a write through the same command is refused.
- [ ] The database refuses an agent approving, granting `allowed`, releasing someone else's
      hold or loosening trust, and lets it pause, revoke and take trust away.
- [ ] A failed audit takes the audited kind's trust away; an agent can't audit its own work.
- [ ] The person's daily brief comes from the GM's round, with numbered questions, and their
      answers are recorded as decisions.
- [ ] In the Claude Code app, the GM starts a desk's listening session from its scheduled task
      with no click, and the log says so. (needs you: a yes to create the first tasks)
- [ ] The starter: a stranger subscribes through Stripe Checkout (test mode), an affiliate's
      link earns its commission when the invoice is paid, and the starter ships with a GM and
      an affiliates desk reading its own data.
- [ ] Every guard has a test that fails without it, and `pnpm test` is green.

### Lanes

- **Core** (`core.sql`, `desk.mjs`, tests), in order: 11, 12, 13, then 14. One builder at a
  time, since they share the two files.
- **Types** (`kit/types/`, `kit/playbooks/`, `new-desk`): 15, 16 and 17. Drafting can start
  any time; each lands after the core rows it names.
- **Starter** (the react-saas-starter repo): 18, 19, 20. Independent of the kit until 20.

### Rows

- [x] **PRD 11** Briefs: desks hand work to each other (`docs/prds/11-briefs.md`).
- [x] **PRD 12** Agents work under their own names: they tighten, people loosen
      (`docs/prds/12-agents-tighten.md`). Needs 11.
- [x] **PRD 13** Audits: spot checks both ways (`docs/prds/13-audits.md`). Needs 12.
- [x] **PRD 14** Stripe as a source, read-only (`docs/prds/14-stripe.md`).
- [x] **PRD 15** The GM desk type, and desk types in the kit (`docs/prds/15-gm-desk.md`).
      Needs 11–14.
- [~] (kit built 2026-11-01; not yet tried live in a project) **PRD 16** The GM starts desks' sessions, and a watchdog for stalled work
      (`docs/prds/16-sessions.md`). Needs 15. The watchdog view can land before the rest.
      (needs you: a yes to create scheduled tasks in a project, and the mode they run in)
- [~] (kit built 2026-11-01; not yet run against a real affiliate program, which waits on 19) **PRD 17** The affiliates desk type: recruit, onboard and pay affiliates
      (`docs/prds/17-affiliates-desk.md`). Needs 15.
- [~] (pushed to the starter's main 2026-11-01; not yet run against Stripe test keys) **PRD 18** Starter: Stripe billing per organisation (`docs/prds/18-starter-billing.md`).
- [~] (building since 2026-11-01, autopilot builder, starter branch autopilot/19-affiliates) **PRD 19** Starter: the affiliate program (`docs/prds/19-starter-affiliates.md`).
      Needs 18.
- [ ] **PRD 20** Starter: ships with the kit, a GM and an affiliates desk
      (`docs/prds/20-starter-desks.md`). Needs 15, 17, 19.

## Wave 2: desks that work in their own chat

Decided 30 Oct (`docs/DECISIONS.md`, "Desks work in their own chat"). PRDs get written when
they're claimed.

- [x] (merged 2026-10-30) **PRD 06** The desk's chat hears everything
      (`docs/prds/06-chat-hears-everything.md`). `watch` wakes the chat for tasks that
      come due and for the desk's `Round:` schedule as well as for mail, with one line
      saying why. No idle wakes, a closed chat catches up once, and `status` says who is
      listening.
- [ ] **PRD 07** Desk tools. `desk.mjs` serves typed tools over MCP (no dependencies):
      status, inbox, read, claim, send, a batch send under a lock, record, lock and unlock.
      A claim that gets nothing is an error, a Worker timeout is retried once and then
      reported, and two sessions can't line up the same batch.
- [ ] **PRD 08** Desk types. Outreach and SEO as templates (plan, playbooks, tables, the
      tools and settings each needs, and what wakes it). `new-desk` starts from one.
      Needs 06, and 07 for the tools a type adds.
- [ ] **PRD 09** The kit as a Claude Code plugin, and one-command install. Every project
      uses the same kit version. The install goes end to end with one yes per project
      and records it; `AGENTS.md` and `new-desk` change to match. Needs 07.
- [ ] **PRD 10** The first real desk on it: a live outreach desk moves onto the kit's
      tools and a listening chat, and off its own scripts. Needs 06-09 and that
      project's yes.

## Needs you

- **Ship rights.** `main` was pushed to `origin` on 30 Oct and 1 Nov (with the starter), each
  time with Doug's yes. Each push still needs his yes. GitHub's repo is public, so no client facts go in.
- **Live desks.** Moving each project's live desks onto the listener,
  and off Gmail, is project work. Each one needs your yes.
- **Cloudflare.** Deploying the kit's mail Worker for a project (D1, routing rules, DNS,
  secrets) needs your yes, per project.
- **The first GM.** Which business gets a GM first, and its money target. Adding a desk to a
  project needs your yes (`AGENTS.md`). Unblocks trying 15 on a live business.
- **Stripe keys.** A restricted read-only key per business, made in the Stripe Dashboard
  (`kit/playbooks/revenue.md` once 14 lands: which permissions to tick). Unblocks the GM
  reading real revenue; test mode needs nothing from you.
- **Scheduled tasks.** A yes to create one on-demand task per desk in a project, and whether
  they run in auto or bypass mode. Unblocks 16.
- **Affiliate terms.** Commission rate, cookie length, payout minimum and how you pay, per
  product. Desks can recruit interest before this, but promise no numbers until it's set.

## Parking lot

- Push instead of polling: the Worker holds a WebSocket per listener, and `watch` opens it
  with Node's built-in WebSocket. Same output, no 30-second delay.
- Gmail API send for alias first touches from `desk.mjs send`, so cold mail needs no
  separate script.
- Always on (1 Nov): desk rounds run from the cloud (Claude Code cloud sessions or routines)
  against the hosted database, so desks work with the Mac asleep; the Mac stays the place for
  work that needs its files. State is already in the database and mail in the Worker.
- Managed Agents, for a desk that must work with the Mac off (worker and hosted database
  on a server, billed per token).
- A headless runner (`claude -p` started by a no-model watcher), for a desk no chat is
  listening to. Planned on 30 Oct and dropped the same morning in favour of the chat.
- The mail Worker keeps attachments (R2), with `desk.mjs mail attachment <id>`.
- How first emails to new contacts go out: the Gmail alias with a BCC to the desk, or a
  separate sending service.
- Affiliate payouts through Stripe Connect, once paying by hand gets heavy.
- The GM emails its daily brief to the person, for reading away from the Mac.
- One view across businesses, for a person with several GMs.
