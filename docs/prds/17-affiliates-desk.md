# PRD 17: the affiliates desk type

## Goal

A business can recruit affiliates, onboard them and pay them, with a desk doing the legwork.
A business can launch an affiliate program on its own say-so, and before it exists a desk can
email potential partners to say it's looking for affiliates. So the desk works before the program exists (collecting interest) and after
(running it).

## Locked decisions

- A conversation desk type in `kit/types/affiliates/`:
  - `Headline: affiliates-earning`: affiliates with a paid referral in the last 90 days.
    Supporting: referred revenue for 28 days, applications, and interested people waiting.
  - `icp.md`: who makes a good affiliate for this product, filled in at setup (people who
    already recommend tools like it: newsletter writers, consultants, agencies, community
    owners, reviewers).
  - `facts.md`: the program's terms as the person set them. Until they're set, it says the
    program is starting and promises no numbers.
  - `playbooks/`: `recruit.md` (find, first touch, one follow-up), `onboard.md` (welcome, the
    link, assets), `payouts.md` (monthly).
- Its table, `affiliates_people`, has a stage per person: `found`, `contacted`, `interested`,
  `applied`, `approved`, `earning`, `paused`, `closed`. `interested` is the waitlist before the
  program opens.
- Kinds: `first-touch` and `follow-up` (can earn trust), `reply` and `onboarding` (can earn
  trust), `approve-affiliate` (the person, until they allow it), `payout` and `terms-change`
  (always human).
- It reads the program's numbers from the product: the starter's affiliate admin API or a
  read-only database role (PRD 19), and Stripe for paid invoices (PRD 14).
- A payout is an action per affiliate per month with the amount, the invoices it rests on, and
  how it's paid. A person sends it.
- The rules for first touches follow the conversations playbook: a published address, one
  follow-up at most, an opt-out line, holds respected.

## Acceptance criteria

1. WHEN `new-desk` is asked for an affiliates desk THE desk SHALL start from the type, and its
   `facts.md` SHALL hold no terms until the person gives them.
2. WHEN the program isn't open THE desk's first touches SHALL invite interest, and replies
   SHALL move people to `interested`.
3. WHEN the month closes THE desk SHALL prepare one payout action per affiliate owed money, each
   waiting for a person.
4. WHEN a payout or terms change is created THE trust board SHALL show it as always a person.

## Tasks

1. `kit/types/affiliates/` files and schema.
2. `new-desk` setup questions for this type.
3. A test that the type initialises and its always-human kinds hold.

## Implementation Notes

Built 1 Nov 2026 in the kit: tasks 1 to 3.

- **The type**, `kit/types/affiliates/`:
  - `desk.md`: `Headline: affiliates-earning`, `Type: affiliates`, and a kinds table with
    who approves each. Its `Needs:` blank avoids capital words, because `Needs:` reads any
    upper-case word as an env var name.
  - `icp.md`, with blanks for setup.
  - `facts.md`: says `Program: not open yet`, and holds no terms or numbers until the person
    gives them (AC 1; a test checks there's no digit or currency sign in it).
  - `schema.sql`: `affiliates_people`, with its eight stages, the stage-log trigger and the
    `affiliates_stages` view.
  - `playbooks/`:
    - `recruit.md`: find, first touch, one follow-up, replies;
    - `onboard.md`: applications, approval, the welcome, earning and the headline;
    - `payouts.md`: monthly payouts, plus terms changes.
- **Guards in the core**, keyed on `desks.type = 'affiliates'` like the GM's. They live in the
  core so they hold whatever happens to the desk's own copy of `schema.sql`.
  - `affiliates_money_human`: a trust row for `payout` or `terms-change` is made always a
    person when it appears, however it appears: from the first action, or an upsert by the
    person (AC 4).
  - `affiliates_money_stays`: nobody sets it back, a person with a note included.
  - `affiliates_payout`: a payout must
    - be for a closed month (`payload.month` is `YYYY-MM`, before this month);
    - have the key `payout:<about>:<month>`, so the unique key allows one per affiliate per
      month (AC 3);
    - carry an amount above 0, a three-letter currency and at least one invoice.
  - `affiliates_payout_paid`: an agent can't claim a payout as sending; a person records it
    as paid.
- **Guards in the type's `schema.sql`**:
  - `affiliates_payout_to`: a payout goes to an `affiliates_people` row with `affiliate_id`,
    at approved, earning, paused or closed. It's here because it reads the type's own table.
  - A fix-up on every init returns `payout` and `terms-change` rows to always a person. It
    covers a desk that took the type after it already had those kinds.
- **AC 2** is the playbooks' job: first touches read `facts.md`. A yes before the program
  opens moves the person to `interested`, with a blocked task "(blocked: the program
  opens)". Opening the program unblocks only those tasks.
- **Tests**: four tests run the playbooks' own SQL:
  - setup, facts, recruiting and the waitlist;
  - always-a-person, nobody loosens it, no auto send, only a person pays;
  - payout shape;
  - a desk that takes the type later.

  20 one-change mutations, all caught. 123 tests in total.
- **Open:**
  - Not tried with a real product. It reads PRD 19's admin API, which isn't built yet.
  - The always-a-person kinds are hard-coded for this one type. If more types need fixed
    always-a-person kinds, a core list of `(type, kind)` pairs would replace this and the
    GM's channel rule.
  - A payout's content can still be edited before approval, without the insert guard's
    checks. The person approves the exact version, so they see what they pay.
