# The commercial plan

What we sell, to whom, at what price and through which channels; the funnel from first
visit to paid; and the bets. The GM keeps it current and says in the person's brief what
changed. A price or an offer changes only when the person says so: the GM asks, and writes
it here once they've decided.

## What we sell
<Each product or plan: what it is, its price, who it's for. Read from the pricing page and
Stripe (`node desks/desk.mjs stripe prices active=true`), not from memory.>

## Who buys
<The buyers, a line each, and the job they buy it for.>

## Channels
<Where buyers come from (search, partners, affiliates, outreach, ads, word of mouth), and
the desk that owns each, or "nobody yet".>

## The funnel
| Step | Measure | Where it's read |
| --- | --- | --- |
| Visit | `visits-28d` | <analytics: property, filters> |
| Sign up | `signups-28d` | <the product's database: the query> |
| Customer | `customers-28d` | `stripe customers --record customers-28d` (`paid` says how many paid) |
| Revenue | `revenue-28d` | `stripe revenue --currency <code> --record revenue-28d` |

Each is recorded on the gm desk every round (`--desk gm`), read the same way each time
(`kit/playbooks/changes.md`). A step with no source yet says so here: that's a gap worth a
bet.

## Bets
Kept in `gm_bets` (`SELECT * FROM gm_bet_board`). Name the open ones here, a line each,
with what they expect.

## Changes
<Dated lines: what changed in this plan, and why. A price or offer change quotes the
person.>
