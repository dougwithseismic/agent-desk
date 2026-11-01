# PRD 12: agents work under their own names, and they tighten while people loosen

## Goal

Today a desk's agent works as the person (`DESK_USER=doug`), so the database can't tell the
person's approval from the agent's work. That was fine while a person sat in every chat. A GM
that makes decisions on its own, in sessions that may run in bypass mode, needs a line the
database holds: an agent can make things safer on its own, but only a person can give it more
room. Trust and spot checks are what let a person rely on it.

## Locked decisions

- A desk can name the agent that works it, in a `desk.md` header line: `Agent: gm`. `init`
  records each one in a new core table, `agents` (name, desk, for whom, when). A name in
  `agents` is an agent everywhere in this database; any other name is a person.
- An agent works under its name: `node desks/desk.mjs --as gm ...`, or `DESK_AS=gm` in the
  environment. `:me` and every `by` the script writes become the agent's name. The desk skill
  passes it whenever the desk has an `Agent:` line.
- The database refuses, when the writer is an agent:
  - approving an action (`approved_by` is an agent);
  - adding a row to `allowed`, or clearing a revoke;
  - releasing a hold someone else placed;
  - loosening trust: lowering `needed`, `coach_needed`, or raising `check_every`, clearing
    `always_human`, or setting `trusted` before the clean count is reached;
  - creating a task on another desk, except through a brief (PRD 11).
- An agent may, on its own: place holds, revoke `allowed` rows, take trust away (a reset),
  release its own holds, and create tasks on its own desk, including tasks for a person.
- Trust gets a `last_by` column and a `words` column (core migration `001`), so a loosening
  change says who made it and what they said. Loosening needs both, from a person. The
  database's own trust updates (counting clean sends) are unaffected.
- `status` lists the agents and who each works for.
- Like every guard in the kit, this stops mistakes: an agent that writes a person's name on
  purpose isn't stopped. `README.md` says so plainly.

## Acceptance criteria

1. WHEN `init` reads a desk with `Agent: gm` THE `agents` table SHALL have a row for `gm` and
   that desk, and running `init` again SHALL change nothing.
2. WHEN a command runs with `--as gm` or `DESK_AS=gm` THE rows it writes SHALL carry `gm` as
   their `by`, `created_by`, `last_by` or `sent_by`.
3. WHEN an agent sets `approved_by` to its own name THE database SHALL refuse it.
4. WHEN an agent inserts into `allowed`, or clears `revoked_at` THE database SHALL refuse it;
   WHEN it sets `revoked_at` THE database SHALL accept it.
5. WHEN an agent releases a hold placed by someone else THE database SHALL refuse it; its own
   holds it SHALL be able to release.
6. WHEN an agent loosens trust in any of the listed ways THE database SHALL refuse it; WHEN a
   person loosens it with `last_by` and `words` set THE database SHALL accept it and log it;
   WHEN anyone resets trust THE database SHALL accept it.
7. WHEN an agent creates a task on a desk other than its own, not through a brief THE database
   SHALL refuse it.
8. WHEN an existing database without migration 001 runs `init` THE migration SHALL apply once
   and existing trust rows SHALL keep their values.
9. Each guard SHALL have a test that fails without it.

## Tasks

1. `core.sql`: the `agents` table; the guards above as triggers. `kit/migrations/001-trust-by.sql`
   adds `trust.last_by` and `trust.words`. Check that triggers in `core.sql` that name the new
   columns still create on a database that hasn't run the migration yet (core runs first); if
   not, create those triggers in the migration and in `core.sql` after it.
2. `desk.mjs`: `--as` and `DESK_AS`; `init` reads `Agent:`; `status` shows agents; `doctor`
   warns about an `Agent:` name that's also used as a person's `DESK_USER`.
3. Desk skill and `kit/guide/anatomy.md`: the `Agent:` line, and working under it.
4. Tests for criteria 1–8.

## Implementation Notes

Built 1 Nov 2026 in the kit, as core migration 001 and triggers in `core.sql`.

- **Names.** `Agent:` in `desk.md` (lowercased, letters, digits, dashes) goes into `agents`
  on `init`. `init` checks every line before it writes anything, and refuses a name that is
  also `DESK_USER` (case-insensitive); `doctor` reports the same faults from the same check. `--as` / `DESK_AS` sets `:me`; `:person` is always
  `DESK_USER`, so playbooks write approvals and allows under `:person` and the agent's own
  work under `:me`. An `--as` name not in `agents` is refused, so a typo can't slip past
  the guards as a "person". `agents` rows can't be deleted or changed.
- **Guards** (each fails a test when removed; mutations checked): `action_approve`
  (agent can't approve), `allowed_by_person`, `allowed_kept`, `hold_kept` (fixed once placed,
  released with a name, an agent's own only), `hold_not_deleted`, `trust_loosened`, `trust_started`, `task_agent_desk`, `task_stays`,
  `agent_kept`, `agent_fixed`; `trust_said` and `trust_said_new` log a person's words.
- **Beyond the PRD, for people too.** Without them each guard had a side door, so these
  apply to everyone: an `allowed` row is fixed once written except for its revoke (widen by
  revoking and allowing again); a hold is fixed once placed except for its release, and is
  never deleted; a released hold says who released it; a task can't move desks.
- **Trust loosening** needs `last_by` naming a person and a fresh `note` (different from the
  row's last). The PRD planned a `words` column; `trust.note` already held "their words", so
  migration 001 adds only `last_by`. A person who repeats exactly the words already on the
  row is refused until they say it differently: the price of an agent not being able to
  reuse the last person's say-so. Counts jumping by more than one, or `since_check` reset without a clean
  send, count as loosening. A new trust row looser than the defaults needs the same. An
  `INSERT OR REPLACE` over an existing row reads as a new row (SQLite fires BEFORE INSERT
  before conflict resolution), so it's checked against the defaults only: a deliberate
  workaround, which the README's "guards stop mistakes" covers.
- **Triggers name columns the migration adds.** SQLite checks trigger bodies when they
  fire, not when created (checked on 3.50.4), so `core.sql` runs before migration 001
  without error.
- **Open.** Not run against a hosted libSQL database: the libsql-server image couldn't be
  pulled here, and a throwaway Railway database needs Doug's yes. The new SQL is triggers,
  `ALTER TABLE ADD COLUMN` and literal RAISE messages, all features the hosted tests have
  covered before (row-value compares were kept out for that reason). `workAs` costs one
  query per `--as` command, which on a hosted database is one extra round trip; accepted.
- **Left for later** (simplify review): one append-only "say-so" table that approvals,
  allows and loosenings point at, instead of the same rule in four triggers; revokes and
  releases as rows of their own, so `allowed` and `holds` could be fully fixed; trust
  settings apart from the database's counts. Each is a bigger change than this PRD.
