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

(Filled in after it ships.)
