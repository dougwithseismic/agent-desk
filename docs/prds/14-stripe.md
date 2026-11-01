# PRD 14: Stripe as a source, read-only

## Goal

A desk can read what the business earns, straight from Stripe, without a dependency and
without being able to change anything there. The GM's headline is money (PRD 15), and Doug
wants "all the tools, skills, and related resources needed to generate revenue with Stripe".
Reading comes first; writes stay with a person.

## Locked decisions

- `node desks/desk.mjs stripe <path> [k=v ...]` makes a GET to `https://api.stripe.com/v1/<path>`
  with `DESK_STRIPE_KEY` from `desks/.env`, using `fetch`, and prints JSON. `--all` follows
  pagination up to 10,000 objects. It never sends anything but GET.
- The key must be a restricted key (`rk_live_` or `rk_test_`) or a test secret key
  (`sk_test_`). A live secret key (`sk_live_`) is refused before any call: it can write.
- Summaries, each with `--days n` where it applies, and `--currency` when there's more than one:
  - `stripe revenue`: charges minus refunds from balance transactions, gross and net of fees;
  - `stripe mrr`: active and past-due subscriptions, each item made monthly;
  - `stripe customers`: new customers, and how many paid;
  - `stripe failed`: failed payments and open invoices past due.
- `--record <name> --desk <desk>` writes the summary into `measures`, with `source` saying the
  command, the window and test or live mode.
- `DESK_STRIPE_URL` points the command at a fake server for tests. The tests never reach
  Stripe.
- `doctor` checks the key's prefix and makes one cheap read.
- A Stripe write (a price, coupon, payment link, refund, payout) is an action of an
  always-human kind, made by a person in the Dashboard or by the product's own admin. The kit
  has no write path.
- `kit/playbooks/revenue.md`: making the restricted key (which resources get read access:
  balance transactions, charges, customers, invoices, prices, products, subscriptions, payment
  links), where it goes, what each summary counts, test and live mode, and what stays a
  person's.

## Acceptance criteria

1. WHEN `stripe charges limit=3` runs with a restricted key THE command SHALL make one GET and
   print the JSON.
2. WHEN the key starts `sk_live_` THE command SHALL refuse before any request, and say to make
   a restricted key.
3. WHEN asked for anything that isn't a read THE command SHALL refuse; there SHALL be no flag
   that sends POST or DELETE.
4. WHEN `stripe revenue --days 28 --record revenue-28d --desk gm` runs THE `measures` table SHALL
   get one row with the value, the period and the source.
5. WHEN `stripe mrr` runs over subscriptions billed yearly, monthly and weekly THE result SHALL
   be the monthly sum, per currency.
6. WHEN the key is missing or wrong THE command and `doctor` SHALL say which, without printing
   the key.

## Tasks

1. `desk.mjs`: the `stripe` command, its summaries and `--record`; `doctor`.
2. A fake Stripe server in `test/` with fixtures for the summaries.
3. `kit/playbooks/revenue.md`; the desk skill points to it.
4. Tests.

## Implementation Notes

(Filled in after it ships.)
