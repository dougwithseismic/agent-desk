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

(Filled in after it ships.)
