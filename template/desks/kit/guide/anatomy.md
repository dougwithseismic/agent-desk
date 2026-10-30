# What a desk is made of

A desk is a standing piece of work an agent does for a business, with a person's say-so
where it matters. Examples: SEO for a site, partner outreach, paid search, CRO tests,
sales follow-up, admin. It isn't an app. It's a plan the agent reads, a few tables, and
the shared rules in this kit.

## Where it lives

Desks live in the repo of the project they serve, so the plan sits next to the code and
data it works on. In a Turborepo that's the repo root, beside `apps/` and `packages/`.

```text
desks/
  desk.mjs              the one script: every read and write goes through it (kit)
  kit/                  core schema, playbooks and this guide (kit: replaced on update)
  .env                  DESK_USER, and DESK_DB + DESK_DB_TOKEN when hosted (never in git)
  .env.example
  data/                 the local database and private working files (never in git)
    desk.db
    seo/                bodies, raw exports, anything private to one desk
  seo/                  one folder per desk (yours: the kit never touches it)
    desk.md             the one-page plan
    schema.sql          the desk's own tables, views and triggers
    migrations/         001-add-h1.sql: every table change after the first init
    playbooks/          only what this desk does differently, if anything
  outreach/
    ...
.claude/skills/desk/       run a desk (kit)
.claude/skills/new-desk/   make a desk (kit)
.agents/skills/*           links to the same skills for Codex
```

One database serves every desk in a project or business. The desks share people,
contacts, holds, locks, tasks and the log, so an SEO desk and an outreach desk see each
other's work on the same brand. A desk's own tables start with its name: `seo_pages`,
`outreach_brands`.

Anything another person or machine needs goes in the database, not in `desks/data/`.
Files in `data/` stay on the machine that made them.

## desk.md: the one-page plan

The agent reads this at the start of every session. Keep it to a page. A plan that
doesn't fit on a page is two desks, or a desk with a playbook.

```markdown
# SEO for example-shop.com
Headline: clicks-28d
Target: <the number they chose, and by when>
Needs: <environment variables the round uses>
Mail: <the desk's own email addresses, if it answers mail>
Round: <when its round is due, if it runs on a schedule: weekdays 09:00>

## Purpose
What it's for, who it serves, who owns it, and what "working" looks like.

## Measures
The headline: what it is, where it's read (tool, query, property), how often.
Supporting measures, if any. Each one recorded in `measures` with its source.

## What it does
Each kind of action: kind, channel, identity it acts as, who approves, and which stay
with a person always (money, contracts, anything they reserved).

## The round
The steps of one working session, in order.

## Criteria
What makes something worth doing, what stops it, the quality bar.

## Limits
Caps per day or week, rate limits, quiet times.

## Sources
Where data comes from: skills, commands, APIs, files. Read-only or not.

## Tables
One line per table in schema.sql: what a row is.
```

The header lines matter to the script: `Headline:` names the measure the board shows,
`Target:` is shown beside it, `Needs:` lists environment variables `doctor` checks, and
`Mail:` lists the addresses the desk answers. An address belongs to one desk, and
`node desks/desk.mjs watch <desk>` listens to those addresses, through the project's mail
Worker. Leave `Mail:` out if the desk doesn't answer email. `Round:` says when a listening
chat runs the round on its own: days (`daily`, `weekdays`, `weekends`, or names such as
`mon thu`) and 24-hour times on the listening machine's clock (`Round: mon thu 08:30, 14:00`).
Leave it out and rounds happen when someone asks for one. `watch` also wakes the chat for the
agent's tasks and checks as they come due, with or without either line.

## schema.sql: the desk's own tables

Only the things the desk tracks that the core doesn't: pages, brands, campaigns,
experiments, jobs. People, contacts, actions, tasks, checks, measures, holds, locks,
lessons and the log are already in the core (`kit/core.sql`); use them.

Each table of things follows the same pattern, so every desk reads the same way:

```sql
CREATE TABLE IF NOT EXISTS seo_pages (
  key TEXT PRIMARY KEY,                 -- page:/stores/nike, the key used everywhere else
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  stage TEXT NOT NULL DEFAULT 'found' CHECK(stage IN
    ('found','planned','changing','checking','done','dropped')),
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT,
  source TEXT,                          -- where we learnt about it
  last_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A stage change stamps the time and goes in the log.
DROP TRIGGER IF EXISTS seo_pages_stage;
CREATE TRIGGER seo_pages_stage AFTER UPDATE OF stage ON seo_pages WHEN NEW.stage IS NOT OLD.stage
BEGIN
  UPDATE seo_pages SET stage_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = NEW.key;
  INSERT INTO log(desk, by, kind, about, summary)
    VALUES ('seo', coalesce(NEW.last_by, 'agent'), 'status', NEW.key, NEW.key || ': ' || OLD.stage || ' > ' || NEW.stage);
END;
```

- **A key column** in the shared key form (`kind:id`), so locks, holds, actions, checks
  and the log can all point at the row.
- **A stage** with every value listed and commented, and `stage_at` for how long it's
  been there.
- **Times** as UTC ISO text (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`); dates as
  `YYYY-MM-DD`. `created_at`, `updated_at` on everything.
- **Where it came from** (`source`), and `last_by` for who changed it.
- **Views** for the questions the round asks every time ("pages to check", "brands
  worth approaching"), so the agent doesn't rewrite the same query.

`init` runs schema.sql every time: `CREATE TABLE IF NOT EXISTS` makes tables once, and
views and triggers should be `DROP ... IF EXISTS` then `CREATE` so edits take effect.
Once a table has data, never edit its `CREATE TABLE`: add a file in `migrations/`
(`001-add-h1.sql` with `ALTER TABLE seo_pages ADD COLUMN h1 TEXT;`). Each migration runs
once, in name order, and a fresh database runs them all after schema.sql.

## Keys

Things are named the same way everywhere, as `kind:id`:

| Key | For |
| --- | --- |
| `brand:acme` | an organisation |
| `person:jo-bloggs` | a person in `people` |
| `email:jo@acme.com`, `domain:acme.com` | an address, or everyone at a domain |
| `page:/stores/nike` | a page on the desk's site |
| `campaign:123`, `adgroup:456`, `keyword:789` | ad platform objects, by their own id |
| `test:hero-copy-oct` | an experiment |
| `action:42` | an action |

Locks, holds, actions (`about`, `target`), tasks, checks and the log all use them, which
is how a hold on `domain:acme.com` stops an email to `jo@acme.com`, and a lock on
`brand:acme` stops a send about Acme from someone else.

## Two families

Most desks are one of these, or a bit of both.

**Conversation desks** work with people: outreach, partnerships, sales, recruiting,
support. Their things are organisations or opportunities with a stage; their actions are
messages; their round is inbox, then promises and follow-ups, then new approaches. Read
`kit/playbooks/conversations.md`.

**Change desks** change something and measure it later: SEO, PPC, CRO, pricing. Their
things are pages, campaigns or experiments; their actions are changes; every change gets
a check with a baseline and a date to look again. Their round is measure, check what's
due, find the next best change. Read `kit/playbooks/changes.md`.

Admin desks are mostly tasks with owners and dates, plus the occasional action (an
email, a booking, a payment that always waits for a person).

## When to make another desk

Make a new desk when the purpose, the headline measure or the people who own it differ.
"SEO" and "partner outreach" are two desks even when they touch the same brands. "SEO
titles" and "SEO internal links" are one desk with two kinds of action.

## Worked examples

`kit/guide/examples/` has real desks to borrow from, not to copy: outreach (a partner
desk for an affiliate site), job search (a candidate's applications), and SEO (a change
desk on Search Console data). Take the shape that fits; never their thresholds, facts or
voice.

`kit/guide/cloudflare-mail.md` is a recipe for a desk that needs its own mailbox or
sending domain.
