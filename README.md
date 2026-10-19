# Agent desk

A kit for putting desks into a project. A desk is a standing piece of agent work for a
business: SEO, PPC, CRO, outreach, sales, admin, anything. A person approves the work
where it matters. Each desk has a one-page plan, a few tables of its own, and a shared
SQLite database that does the guarding.

There's no app and no service to run. The agent reads the plan, works in the chat, and
reads and writes through one script with no dependencies.

## Use it

In Claude Code or Codex, in this repo or in the project, say:

> Set up a desk for SEO on vouchernaut.com

The `new-desk` skill installs the kit into the project and asks what the desk is for and
how success is measured. It looks at the project's data, proposes the desk, builds it,
and does one real round with you. After that, say `/desk`, or "run the seo desk", in
that project.

To install or update the kit by hand:

```bash
node bin/kit.mjs ~/path/to/project
```

Add `--check` to see what would change without changing anything.

## What lands in a project

```text
desks/
  desk.mjs          the one script: init, status, sql, lock, take, export, dump, doctor
  kit/              core schema, playbooks, guide and worked examples (replaced on update)
  .env              DESK_USER, and the hosted database's address and token (never in git)
  data/             the local database and private files (never in git)
  seo/              a desk: desk.md, schema.sql, migrations/, playbooks/ (yours)
.claude/skills/     desk (work a desk) and new-desk (make one)
.agents/skills/     links to the same skills for Codex
```

The kit owns `desk.mjs`, `kit/` and the two skills. Desk folders belong to the project.
An update never touches them. In a Turborepo, `desks/` sits at the root beside `apps/`
and `packages/`.

## Storage

One SQLite database serves every desk in a project or business, so desks see each
other's people, holds and work.

- **On one machine:** a file in `desks/data/`. This is the default and needs nothing
  else. Every git worktree of the project uses the main checkout's file, so parallel
  sessions see the same desks.
- **Shared:** a [libsql-server](https://github.com/tursodatabase/libsql) service on
  Railway with a volume and one token, set up in one step from the
  [Hosted SQLite (libSQL)](https://railway.com/deploy/hosted-sqlite-libsql) template.
  There are no accounts to manage. Each person sets `DESK_USER` and works as themselves.
  `kit/playbooks/hosting.md` has the steps, plus backups and moving between the two.

The same SQL runs in both modes. A multi-statement write is all-or-nothing in both.

## What the database guards

The rules live in triggers, so they hold whichever agent or person is writing. The
database refuses:

- a send that isn't approved, or earned by trust;
- an approval of a version nobody saw;
- anything touching a held person, address, domain or brand, including CCs and the
  brands an agency email covers;
- work on something another person has locked;
- a second claim on an action;
- changes to what was already attempted;
- any edit of the log.

Trust is earned per kind of action, channel and identity:

1. two coached drafts;
2. five clean approved ones;
3. then trusted, with every fifth action shown in full as a spot check.

An edit or a refusal resets trust. Kinds marked always-human never get trust.

Locks show who is working on what. `take` hands a lock over without asking, and the log
records the takeover.

## Working on the kit

```text
template/    what bin/kit.mjs copies into a project
bin/kit.mjs  the installer
test/        tests: each one runs the real script in a throwaway project
```

```bash
pnpm test
```

That runs against a local file. To run the same tests against a hosted server, use an
empty database kept for tests, because each test wipes it:

```bash
DESK_TEST_URL=https://... DESK_TEST_TOKEN=... pnpm test
```

Needs Node 22.16 or newer, for `node:sqlite`.
