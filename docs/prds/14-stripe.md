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

Built 1 Nov 2026 in the kit: `desk.mjs` only, no schema change.

- **`stripe <path> [name=value ...]`** makes one GET to `DESK_STRIPE_URL` (default
  `https://api.stripe.com`) + `/v1/<path>`; `--all` pages with `starting_after`, or
  `next_page` for search, up to 10,000. The one fetch is in `stripeGet`, hard-coded GET.
  A path is checked against `^[a-z][a-z0-9_]*(/[A-Za-z0-9_]+)*$`, every other argument must
  be `name=value`, and a first word such as post, delete, cancel or refund is refused with
  "a change in Stripe is a person's". There is no flag that changes the method.
- **The key.** `rk_live_`, `rk_test_` or `sk_test_`; `sk_live_` and anything else are refused
  before a request. A live key goes only to `https://api.stripe.com`, so a stray
  `DESK_STRIPE_URL` can't send it elsewhere. Stripe's error text is passed through with any
  key-shaped string replaced by `<key>`. 401 and 403 get their own messages.
- **Summaries** are small objects in `stripeSummaries`: what they read into rows (one per
  currency, or one row when `overall`), which fields are money (shown in whole units),
  whether they have a window, and the one number `--record` saves. `revenue` reads balance
  transactions (`charge`/`payment` gross, `refund`/`payment_refund` refunds, fees, net);
  `mrr` reads active and past-due subscriptions and makes each item monthly (day x 365/12,
  week x 52/12, year / 12, over `interval_count`), skipping tiered and metered items and
  counting them; `customers` counts customers created in the window and those with a
  succeeded charge in it; `failed` counts failed charges in the window and open invoices past
  their due date or charged automatically and failed. Amounts are in whole units, with
  zero-decimal and three-decimal currencies handled.
- **`--record <name>`** saves one number in `measures` with the window as dates, a unit
  (`USD`, `USD/month`, `customers`, `to chase`) and a source such as
  `stripe revenue --days 28 --currency usd (test mode)`. More than one currency needs
  `--currency`; a currency with nothing in the window records 0, since a quiet week is a real
  number. The JSON output gains `recorded`.
- Flags `stripe` would otherwise ignore are refused: `--limit` (it's `limit=3`), `--days` on
  `mrr`, `--currency` on `customers`, and `--days`/`--currency`/`--record` on a plain read.
- `doctor` checks the key and reads `balance_transactions?limit=1` when `DESK_STRIPE_KEY` is
  set; a desk with `Needs: DESK_STRIPE_KEY` is told when it's missing.
- Tests run a fake Stripe (`fakeStripe`) with two-object pages, Stripe's error shapes and a
  request log. Every rule above fails a test when removed (mutation-checked).
- Extras beyond the PRD: the live-key host rule, three-decimal currencies, `failed` counting
  automatically charged invoices that failed (they have no due date, so a SaaS on
  subscriptions would otherwise always show 0).
- Left after review: a fetch helper shared with `mailFetch` (it takes a method, which would
  move the GET-only rule out to callers); names for the summaries that can't be Stripe paths
  (the PRD names them, so `stripe customers` alone is the summary and a pair makes it a
  plain read); Stripe search or server-side filters for `failed` and `customers`, streaming
  pages instead of holding up to 10,000 objects, and parallel windows. Those pay off only
  on accounts with thousands of charges a month.
- **Open.** Not run against a real Stripe account: no test keys yet (Needs Doug). MRR is
  before discounts and ignores trials. `failed` can count one failed renewal twice (as a
  failed charge and as an open invoice), and says so. Balance transactions are in the
  currency the money settled in, so a sale in euros to a dollar account shows in USD.
