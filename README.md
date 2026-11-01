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

### Desks that answer mail

A desk that talks by email has its own addresses (a `Mail:` line in its `desk.md`), on a
subdomain whose mail goes to the project's mail Worker. Say "/desk partners listen" and
that session answers mail as it arrives: `node desks/desk.mjs watch partners` waits in the
background with no model running, and wakes the session when mail lands. The desk reads
its mail with `node desks/desk.mjs mail`, and `node desks/desk.mjs send <action id>` sends
an approved reply exactly as stored and records what happened. One desk is one agent at
work, and a project can have as many as it needs. Desks never read the person's own inbox.

A listening chat hears more than mail: the agent's tasks and checks as they come due, and
the desk's schedule, a `Round:` line such as `Round: weekdays 09:00`, where it runs a
round. A desk without mail can listen for those alone. `status` shows who is listening.

### Desks that read revenue

`node desks/desk.mjs stripe revenue` (or `mrr`, `customers`, `failed`) reads what the
business earns from Stripe with a restricted, read-only key in `desks/.env`, and
`--record` saves it as the desk's headline. Any other read is `stripe <path>`. It only
sends GETs and refuses a live secret key: changes in Stripe stay with a person
(`desks/kit/playbooks/revenue.md`).

### A GM that runs the other desks

Say "set up a GM" and `new-desk` starts from the GM type (`desks/kit/types/gm`). The GM runs
the business towards a money target and runs the other desks. Each round it records revenue
from Stripe and reads every desk. It audits what went out alone, checks its bets, and briefs
the desks on what to do next. Then it writes you one brief with yes-or-no questions. It
briefs; it doesn't do (see the guards below).

A watchdog notices stalled work without anyone looking: a desk with work and nobody listening,
a round missed, a brief past its due, a send stuck or uncertain, audits left undone, a headline
nobody measured. `status` shows it, with what fixes each. With your yes, each desk gets a
scheduled task in the Claude Code app (`Start:` in its `desk.md`), and the GM starts a desk
when it has work and nobody is listening.

## What lands in a project

```text
desks/
  desk.mjs          the one script: init, status, sql, lock, take, export, dump, doctor,
                    watch, mail and send for desks that answer mail, and stripe
  kit/              core schema, playbooks, desk types, guide and worked examples (replaced on update)
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
  There are no accounts to manage. Each person sets `DESK_USER` and works as themselves,
  and an agent named in a desk's `Agent:` line works under its own name (`--as <name>`).
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

An agent working under its own name makes things safer on its own: it can place holds,
revoke what's allowed and take trust away. Giving it more room is a person's say-so, so the
database refuses an agent that approves, allows work to go alone, releases someone else's
hold, loosens trust, or gives another desk a task other than through a brief. Loosening trust
needs the person's name and their words, and goes in the log.

Trusted work that went out alone gets audited by someone who didn't do it: another desk's
agent, such as a GM, or the person. Nobody audits their own work, and an audit never changes.

A GM desk (`Type: gm`) prepares briefs and initiatives and nothing else, and an initiative
never goes out on its own. A question for the person (a task with source `ask`) closes as
done only once their answer is in the log, under their name. A GM's bet runs only on a
check with a baseline, and ends won or lost only as that check says.

These guards stop mistakes. They aren't security: an agent that writes a person's name on
purpose isn't stopped, and anyone with the database can change it.

Trust is earned per kind of action, channel and identity:

1. two coached drafts;
2. five clean approved ones;
3. then trusted, with every fifth action shown in full as a spot check.

An edit, a refusal or a failed audit resets trust. Kinds marked always-human never get trust.

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

The tests use a fake mail Worker. To check desk mail end to end against the real Worker,
running on this machine under `wrangler dev`, use:

```bash
pnpm e2e
```

It takes a throwaway project from install to a sent reply (`test/e2e-mail.mjs` lists the
checks). No email leaves the machine and no Cloudflare account is used.

Needs Node 22.16 or newer, for `node:sqlite`.
