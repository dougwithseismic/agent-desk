# PRD 05: Installing the mail Worker, and the end-to-end check

## Goal

A project goes from "no mail" to "desks answer mail as it arrives" by following the kit:
install the kit, fill in `desks/mail/wrangler.jsonc`, deploy once, set two lines in
`desks/.env`, and say `/desk <name> listen`.

## Locked decisions

- `bin/kit.mjs` ships `desks/kit/mail/` with the rest of `kit/`, and ignores `node_modules`
  and `.wrangler` anywhere under the kit's folders.
- `kit/mail/README.md` is the setup recipe: Cloudflare routing per address, Email Sending on
  the subdomain, D1, the secret, deploy, `desks/.env`. It points at `kit/guide/cloudflare-mail.md`
  for the Cloudflare side, and states the contract for projects that keep their own Worker.
- `new-desk` offers the Worker when a desk talks by email and the project has none, and asks
  before any Cloudflare change.
- The end-to-end check runs the Worker with `wrangler dev` on this machine: mail goes in
  through the local email handler, `watch` wakes, `send` replies, the Worker's Sent record
  shows it. No Cloudflare account is touched.

## Implementation Notes

Merged into `main` locally on 2026-10-29. Nothing is deployed: the check runs the Worker
under `wrangler dev`.

- **Installer.**
  - `bin/kit.mjs` skips `node_modules`, `.wrangler` and `.dev.vars` by name, anywhere
    under the kit's folders, both when copying and when deciding what to remove.
  - `desks/.gitignore` gets the same three names, with `data` and `.env`. It's written by
    `ensureGitignore` in `desk.mjs`, which `init` and the installer both call, so there's
    one list.
  - `doctor` checks that `desks/mail/.dev.vars` (the local token) is ignored.
  - A first install into a git project no longer refuses over unrelated uncommitted work.
    It used to filter to the kit paths that existed, so with none there yet,
    `git status --` listed the whole repo. It now passes them all, and git prints nothing
    for paths that don't exist.
- **Wrangler version.** Wrangler 4.82 can't run the Worker's `compatibility_date`
  (2026-10-01). The README, the example settings and the Cloudflare guide now say
  `npx wrangler@latest`. The guide still tells discovery to use a project's pinned
  wrangler, and says the Worker itself needs a newer one.
- **Local recipe.** `kit/mail/README.md` "Running it locally": `.dev.vars`,
  `d1 migrations apply --local`, `dev`, and a `curl` to `/cdn-cgi/handler/email` that
  delivers a raw email to a desk.
- **`pnpm e2e`** (`test/e2e-mail.mjs`) installs the kit into a temp git project, fills in
  `wrangler.jsonc` from the example, and runs the Worker on a free port, with Cloudflare
  credentials stripped from its environment. It checks:
  - `doctor` passes against the running Worker, and git ignores wrangler's state;
  - `watch` wakes on a delivered email;
  - `send` sends an approved reply once;
  - `mail sent --key` and `mail thread <provider_ref>` show the reply;
  - a reply to an email the sender has followed up is refused (409 STALE) and stays
    approved.

  It takes about 8 seconds once npx has wrangler cached. Ctrl-C stops the process groups
  it started.
- **Tests.** `test/kit.test.mjs` (in `pnpm test`): installs into a git project with work in
  progress, keeps local files on update, and adds the ignore lines once. There's also a
  doctor/init test for the token line. 77 tests pass. Each new rule was mutated and a
  test failed.
- **`new-desk`** already offered the Worker and asked before Cloudflare changes. It now
  points at the local run, for trying a mail desk with nothing on Cloudflare.

Simplify review: skipped two suggestions.
- Pinning a minimum wrangler, or lowering `compatibility_date`. The date sets runtime
  behaviour the Worker was tested under, and `@latest` is what Cloudflare's own docs use.
- Listing kit files through git. Installs would then need git, and strays in a kit-owned
  folder are meant to be removed.

Open:
- No deployed Worker yet. The done-bar box for standing one up stays open until a project
  says yes.
- `freePort` in the e2e can race with another process taking the port. That's rare, and
  the failure says wrangler stopped.
