# Backlog

`[ ]` to do, `[~]` shipped up to a seam (named), `[x]` done end to end.

## Done bar

What "desks answer mail as it arrives" needs before it's finished:

- [ ] A desk with a `Mail:` line wakes its listening session within a minute of mail
      arriving at its address.
- [ ] Mail handed over by another desk wakes the right desk, once.
- [ ] Only one person listens to a desk at a time, and two desks can't claim one address.
- [ ] A project can stand up the kit's mail Worker from the kit alone (its config and one
      deploy), and the Worker stores, threads and forwards mail, and sends approved replies
      within caps, never to suppressed addresses and never twice.
- [ ] A desk sends with `desk.mjs send <id>`: exactly the stored version, result recorded.
- [ ] The playbooks say a desk owns its addresses and never reads the person's own inbox,
      and alias sends BCC the desk's address.
- [ ] Every guard has a test that fails without it, and `pnpm test` is green.

## Wave 1: desks answer mail as it arrives

- [~] (building since 2026-10-29, lead) **PRD 01** `watch`: the `Mail:` line, the mail contract, the cursor and the listener
      (`docs/prds/01-watch.md`)
- [ ] **PRD 02** Listening in the desk skill, and the mailbox rules (`docs/prds/02-listen.md`).
      Needs 01.
- [~] (building since 2026-10-29, builder agent) **PRD 03** The kit's mail Worker (`docs/prds/03-mail-worker.md`). Needs 01's contract
      only.
- [ ] **PRD 04** `desk.mjs mail` and `desk.mjs send <id>` (`docs/prds/04-mail-client.md`).
      Needs 03.
- [ ] **PRD 05** Installing the mail Worker, and the end-to-end check
      (`docs/prds/05-install.md`). Needs 02, 03, 04.

## Needs you

- **Ship rights.** May `main` be pushed to `origin` (GitHub)? Until then every round is
  merged into `main` locally only.
- **Live desks.** Moving each project's live desks onto the listener,
  and off Gmail, is project work. Each one needs your yes.
- **Cloudflare.** Deploying the kit's mail Worker for a project (D1, routing rules, DNS,
  secrets) needs your yes, per project.

## Parking lot

- Push instead of polling: the Worker holds a WebSocket per listener, and `watch` opens it
  with Node's built-in WebSocket. Same output, no 30-second delay.
- A `DESK_MAIL_PREFIX` setting, for Workers whose inbox ids aren't `mail:` (a project's own
  Worker might use `acme-mail:`).
- Gmail API send for alias first touches from `desk.mjs send`, so cold mail needs no
  separate script.
- A cloud routine for desks on a hosted database (hourly at most).
