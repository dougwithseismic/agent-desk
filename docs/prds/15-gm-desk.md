# PRD 15: the GM desk type, and desk types in the kit

## Goal

A business gets a GM: the desk that runs the business towards money and runs the other desks.
It reads the money and the funnel, reads every desk, audits what went out alone, decides what
the desks should do next, briefs them, launches new initiatives, and writes the person one brief
a day with the decisions only they can make. It does work that moves the business, with trust
and spot checks a person can rely on.

## Locked decisions

- **Desk types.** `kit/types/<type>/` holds a starting desk: `desk.md`, `schema.sql`,
  `playbooks/` and any files it needs, with blanks the setup conversation fills. `new-desk`
  starts from a type when one fits, and the result belongs to the project like any desk. The GM
  is the first type and affiliates (PRD 17) the second; outreach and SEO follow in PRD 08.
- **The GM's plan** (`desk.md`):
  - `Headline: revenue-28d`, or `mrr` for a subscription business, read with PRD 14;
  - `Target:` set by the person;
  - `Agent: gm` (PRD 12);
  - `Round: weekdays 08:30`, before the desks' rounds;
  - `Needs: DESK_STRIPE_KEY`.
- **Its files:**
  - `mandate.md`: the goal in the person's words, what the GM may decide alone, its budget (0
    unless they set one), and the always-human list;
  - `plan.md`: the commercial plan (what we sell, to whom, at what price, through which
    channels), the funnel from first visit to paid with where each number is read, and the
    bets. The GM keeps it current. Changing a price or an offer is the person's call.
- **Its table**, `gm_bets`: a bet is a thing the GM thinks will move the money. Each row has its
  key (`bet:<slug>`), what it is, why, the effect it expects on the headline or a funnel step,
  the desks that own it, its stage (`proposed`, `running`, `checking`, `won`, `lost`, `dropped`)
  and a core `check` with its baseline and date.
- **The GM briefs, it doesn't do.** Its own actions are on channel `desk` (briefs) or `gm`
  (initiatives); email, site changes and anything else that goes out belong to the desk that
  owns them. A `Type: gm` line in `desk.md` is recorded on `init` (core migration 002 adds
  `desks.type`), and a trigger refuses any other action on a desk of that type. A prompt
  telling a model to delegate isn't enough: left to judge, it does "small" work itself. Work
  outside the database (editing code, say) can't be guarded, so the round playbook says to
  brief a builder instead.
- **Its decisions:**

  | Kind | What it is | Alone? |
  | --- | --- | --- |
  | `brief` | a task for a desk (PRD 11) | can earn it |
  | `pause` | a hold on a desk's kind or target | yes: it tightens |
  | `audit` | a verdict on a desk's work (PRD 13) | yes |
  | `initiative` | a new bet that needs building, a new desk or outside work | shown each time until the person allows it |
  | `ask` | a question for the person: a task they own on the GM desk, with options and a recommendation | yes: it only asks |
  | money, prices, contracts, publishing as the person, granting autonomy | | never (always human) |

- **The round,** in order: (1) money and funnel, from Stripe and the product's own sources;
  (2) every desk: board, listening, stuck work, waiting on the person, open briefs; (3) audits
  from `audit_due`; (4) bets: checks that are due, and their verdicts; (5) decide: at most three
  new briefs a round, pause what's failing, propose an initiative when the plan has a gap;
  (6) the person's brief.
- **The person's brief:** money against the target, and since last time; one line per desk;
  what went out alone, with the audited ones; briefs closed and what came of them; anything
  stuck, such as a desk with work and nobody listening; then numbered questions, each answerable
  "yes" or "no", followed by the person's own tasks, most money first. The GM records each answer
  as a `decision` in the log, in their words, and acts on it.
- **Initiatives** follow one path: a bet row, then a PRD in the project's own plan when it needs
  building, then builder tasks, then briefs to desks. An affiliate program is the worked example
  (PRDs 17–19).
- **`new-desk` sets up a GM** as a conversation: the money goal and target, the mandate, the
  Stripe key (or test mode until there is one), the desks it will run, a first `plan.md` written
  from what's in the repo (pricing, docs, analytics), and one round with the person.
- A worked example in `kit/guide/examples/gm.md`, written from the first real GM once one runs.

## Acceptance criteria

1. WHEN `new-desk` is asked for a GM THE resulting desk SHALL have the plan, files, table and
   playbooks above, and `init` SHALL accept it.
2. WHEN the GM runs a round in a throwaway project with two desks and a fake Stripe THE round
   SHALL record the headline, list each desk's state, pick audits from `audit_due`, and write the
   person's brief with numbered questions.
3. WHEN the GM briefs a desk THE brief SHALL go through PRD 11; WHEN brief kinds aren't trusted
   THE brief SHALL wait for the person.
4. WHEN the person answers "2 yes" THE log SHALL get a `decision` row with their words, and the
   question's task SHALL close.
5. WHEN a bet's check comes due THE GM's round SHALL measure it the same way as its baseline and
   record a verdict.
6. WHEN the GM proposes an initiative THE action SHALL wait for the person, whatever its trust.
7. WHEN a desk of type `gm` creates an action on any channel but `desk` or `gm` THE database
   SHALL refuse it, with a message saying to brief the desk that owns that work.

## Tasks

1. `kit/types/gm/`: `desk.md`, `mandate.md`, `plan.md`, `schema.sql` (`gm_bets`, its views), and
   `playbooks/round.md`, `decide.md`, `brief.md` (the person's brief), `initiatives.md`.
2. `new-desk`: starting from a type, and the GM conversation.
3. Views the round reads: one row per desk for the board, went-alone since a time, briefs, and
   audits due (some come from 11 and 13).
4. An end-to-end test: a throwaway project, the GM type, two desks, a fake Stripe, one round.
5. Core migration 002 (`desks.type`), `init` reading `Type:`, and the briefs-only trigger with
   its test.

## Implementation Notes

(Filled in after it ships.)
