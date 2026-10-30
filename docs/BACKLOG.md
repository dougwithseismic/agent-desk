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

## Wave 2: desks that work on their own

Decided 30 Oct (`docs/DECISIONS.md`, "Desks work on their own"). PRDs get written when
they're claimed.

- [ ] **PRD 06** Desk tools. `desk.mjs` serves typed tools over MCP (no dependencies):
      status, inbox, read, claim, send, a batch send under a lock, record, lock and unlock.
      A claim that gets nothing is an error, a Worker timeout is retried once and then
      reported, and two sessions can't line up the same batch.
- [ ] **PRD 07** Desk types. Outreach and SEO as templates (plan, playbooks, tables, the
      tools and settings each needs, and what wakes it). `new-desk` starts from one.
      Needs 06 for the tools a type adds.
- [ ] **PRD 08** The kit as a Claude Code plugin, and one-command install. Every project
      uses the same kit version. The install goes end to end with one yes per project
      and records it; `AGENTS.md` and `new-desk` change to match. Needs 06.
- [ ] **PRD 09** The runner. A no-model process wakes a desk on mail, due tasks or its
      schedule and starts a headless Claude Code run with only the desk's tools, under
      `run:<desk>`. It keeps running across restarts on the Mac and logs every run.
      Needs 06 and 08.
- [ ] **PRD 10** The first real desk on it: a live outreach desk moves onto the kit's
      tools and runner, and off its own scripts. Needs 06-09 and that project's yes.

## Needs you

- **Ship rights.** `main` was pushed to `origin` once, on 30 Oct, with Doug's yes. Each
  push still needs his yes. GitHub's repo is public, so no client facts go in.
- **Live desks.** Moving each project's live desks onto the listener,
  and off Gmail, is project work. Each one needs your yes.
- **Cloudflare.** Deploying the kit's mail Worker for a project (D1, routing rules, DNS,
  secrets) needs your yes, per project.

## Parking lot

- Push instead of polling: the Worker holds a WebSocket per listener, and `watch` opens it
  with Node's built-in WebSocket. Same output, no 30-second delay.
- Gmail API send for alias first touches from `desk.mjs send`, so cold mail needs no
  separate script.
- Managed Agents as a second engine for the runner, for a desk that must work with the Mac
  off (worker and hosted database on a server, billed per token).
- The mail Worker keeps attachments (R2), with `desk.mjs mail attachment <id>`.
- How first emails to new contacts go out: the Gmail alias with a BCC to the desk, or a
  separate sending service.
