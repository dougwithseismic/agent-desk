# PRD 13: audits, spot checks both ways

## Goal

Trusted work goes out without a person reading it, apart from every fifth. Nobody checks the
other four, and nobody checks whether a desk's headline number is true. The GM should, and the
person should be able to check the GM the same way. A failed check takes trust away, so a desk
that drifts loses its freedom without anyone having to notice by hand.

## Locked decisions

- A new core table, `audits`: what was checked (a key: `action:<id>`, `measure:<id>`,
  `task:<id>`), the audited desk, who checked, the verdict (`pass`, `fail`, `unsure`), notes,
  and evidence (refs that can be reopened). Append only, like the log.
- Nobody audits their own work: an audit of an action by its `created_by` or `sent_by`, or of a
  measure or task by whoever recorded it, is refused.
- A `fail` on an action resets that kind's trust, as a rejection does (epoch up, clean to 0,
  trusted off), and logs a `trust` row naming the audit. The desk then shows its next ones to a
  person until it earns trust again. A fail on a measure or task resets nothing, but the GM's
  brief carries it.
- `unsure` goes to the person in the GM's brief, with the evidence.
- A view, `audit_due`: actions sent alone (mode auto) in the last 14 days with no audit and no
  person review, per desk and kind, newest first, with any bounce, complaint or negative reply
  first.
- The GM audits at least one in five of each desk's auto sends each week, plus every one that
  bounced or drew a complaint. Its playbook (PRD 15) says what to check: the claims against the
  desk's facts, the voice, the criteria, the holds, and what happened after.
- The person checks the GM through the spot check the gate already makes (every fifth trusted
  decision in full), and can audit anything else with the same table.

## Acceptance criteria

1. WHEN an audit is recorded with verdict `fail` on an action THE trust row for that action's
   desk, kind, channel and identity SHALL be reset, and the log SHALL say which audit did it.
2. WHEN an agent or person audits an action they created or sent THE database SHALL refuse it.
3. WHEN an audit row is updated or deleted THE database SHALL refuse it.
4. WHEN an action went out alone and has no audit THE `audit_due` view SHALL list it; WHEN it
   is audited THE view SHALL drop it.
5. WHEN an audit on a measure fails THE trust table SHALL be unchanged and the GM's brief view
   SHALL list it.
6. Each guard SHALL have a test that fails without it.

## Tasks

1. `core.sql`: `audits`, its triggers and `audit_due`.
2. `desk.mjs status`: audits due per desk.
3. `kit/playbooks/audits.md`: choosing the sample, what to check, writing a verdict someone can
   reopen.
4. Tests.

## Implementation Notes

Built 1 Nov 2026 in the kit: a new core table and triggers in `core.sql`, no migration.

- **`audits`**: desk, `checked` (`action:<id>`, `measure:<id>`, `task:<id>`), verdict, notes,
  evidence (a JSON list), by, at. `audit_written` reads the view `audited_work` (each
  action, measure and task with who made or sent it) and refuses an audit of something that isn't
  on that desk, one by whoever created or sent the action / recorded the measure / created
  the task, blank notes, evidence that isn't a list, and a fail or unsure with no evidence.
  `audit_no_update` and `audit_no_delete` keep it append only; a later audit of the same
  thing supersedes an earlier one.
- **A fail on an action** (`audit_failed_resets_trust`) resets that kind's trust as a
  rejection does and logs a `trust` row with `ref = 'audit:<id>'`, by the auditor, naming the
  audit and its notes. It resets whatever stage the action was in, and for human-sent
  actions too.
- **`audit_due`**: actions with mode `auto`, status sent, verified or uncertain, in the last
  14 days, with no audit. `trouble` counts holds placed since on any key the action
  touches (through a new `hold_keys` view, which `active_hold_keys` now builds on) (bounces, complaints and opt-outs become holds), and those sort first. "Negative
  reply" isn't detected beyond that: the inbox has no sentiment, so the playbook asks the
  auditor to read the thread.
- **`audit_findings`** is the GM's brief view from criterion 5: fails and unsures whose
  newest audit is still a fail or unsure. PRD 15's brief reads it.
- `status` adds "N sent alone, not audited (M with trouble since)" per desk and an audit
  findings section; `--json` has `audits_due` and `audit_findings`.
- A desk without an `Agent:` works as the person, so the person can't audit it: another
  desk's agent (the GM) does. The playbook says so.
- Views carry no ORDER BY; `status` and the playbook order their own queries.
- Each guard and view clause fails a test when removed (mutations rechecked after simplify).
- Review fix: the own-work check first looked the id up with a cast alone, so `task:123`
  also matched action 3. Each lookup now compares the whole ref (`'task:' || id`), and a
  test covers it.
- **Open.** Not run against hosted libSQL (same gap as PRD 12). The SQL uses `json_type`
  and `json_array_length`, which libSQL has. The reset UPDATE is a third copy of the
  rejection one; triggers can't share a body. `audit_due` works out `trouble` per listed
  row through `action_touches`; fine for 14 days of auto sends, worth a look if a desk
  sends thousands alone.
