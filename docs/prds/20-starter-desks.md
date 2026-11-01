# PRD 20: starter, ships with the kit, a GM and an affiliates desk

Built in the public `react-saas-starter` repo. This file moves there when the lane
starts.

## Goal

An app made from the starter comes with someone minding the business. Its first session can say
"set up the GM" and get a desk that reads the app's own numbers and money, and an affiliates
desk that can recruit before the program has its first affiliate.

## Locked decisions

- The kit is installed with `node bin/kit.mjs` (or the plugin, once PRD 09 lands) and updated
  the same way. The starter holds no copy of kit code beyond what the installer writes.
- `desks/gm` and `desks/affiliates` start from the kit's types with the starter's facts filled
  in: the funnel (visit, sign-up, organisation, checkout, paid) read from PostHog and from the
  app's database through a read-only role, and money from Stripe (PRD 14).
- A read-only Postgres role for desks, created by a migration, with access to the tables the
  desks read and nothing else. Its connection string goes in `desks/.env`.
- The README's setup prompt and checklist get one step: set up the GM, with the app's money goal.
- Each new app sets its own target and terms. The starter ships blanks, never numbers.

## Acceptance criteria

1. WHEN a new app is made from the starter and the GM is set up THE GM's first round SHALL read
   sign-ups, organisations and paid subscriptions from the app, and money from Stripe test mode.
2. WHEN the desks' database role tries to write THE database SHALL refuse it.
3. WHEN the kit is updated THE starter's desks SHALL be untouched.

## Implementation Notes

(Filled in after it ships.)
