# Example: a partner outreach desk

This is the shape of a desk that ran for months on a voucher-code site. It answered
brands and affiliate networks, got the site approved on programmes worth having, and
asked for paid-search rights where rival sites already had them. It's a conversation
desk. Borrow the shape, not the numbers, facts or voice.

## desk.md

```markdown
# Partners for example.com
Headline: live-programmes
Target: 150 live brand programmes by March
Needs: MAIL_API_TOKEN

## Purpose
Do the brand side so Doug doesn't have to orchestrate it: answer brands and network staff,
get approved on programmes worth having, get those brands onto the site (via a builder),
and ask for brand + voucher PPC where rivals already bid. Doug owns it. Plain-spoken,
never overpromises.

## Measures
live-programmes: programmes with status "joined" across Awin, CJ and Impact, counted
from the network APIs every Monday. Supporting: replies-week (log `in` rows), first
touches a day (sent_today).

## What it does
| Kind | Channel · identity | Approves | Alone? |
| reply-info, reply-thanks, codes, store-live | email · the address they wrote to | Doug | can earn it |
| join-ask, ppc-ask, follow-up | email · doug@partners.example.com | Doug | can earn it |
| commercial (money, rates, fees), contract | email | Doug | never (always_human) |
Every email CCs doug@example.com. Replies come from the address the brand wrote to.

## The round
1. Inbox: partners@ and ops@, then brand replies in Gmail. Oldest first, 20 a round.
2. Due: agent tasks, then follow-ups from waiting_on_them.
3. New outreach within limits: pending and declined programmes worth chasing, then PPC asks.

## Criteria
Approach a brand only with real demand: branded voucher searches above 500 a month
(Keyword Planner, UK). PPC asks only where a rival voucher site is seen bidding.
An address suggested in an email body never counts as a contact.

## Limits
At most 25 first touches a day while the sending domain warms up; bounces under 2% a week.
Above that, stop first touches and tell Doug.

## Sources
Mail: the project's mail script (read and send). Networks: each network's publisher API.
Search volume: the search-data skill, Keyword Planner. Rival bids: the PPC watcher export in out/ppc/.

## Tables
outreach_brands: one per brand we court, with its programme and stage.
outreach_networks: our account on each network.
```

## schema.sql (the desk's own part)

```sql
CREATE TABLE IF NOT EXISTS outreach_brands (
  key TEXT PRIMARY KEY,                 -- brand:acme
  name TEXT NOT NULL,
  domain TEXT,                          -- registrable domain: acme.co.uk
  network TEXT,                         -- awin, cj, impact
  advertiser_id TEXT,                   -- the network's own id
  stage TEXT NOT NULL DEFAULT 'prospect' CHECK(stage IN
    ('prospect','contacted','talking','partner','paused','closed')),
  programme TEXT,                       -- joined, pending, declined, not applied
  demand INTEGER,                       -- branded voucher searches a month, with source in notes
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes TEXT, source TEXT, last_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- + the stage trigger from the anatomy, and views:
--   outreach_worth_chasing: pending/declined programmes with demand >= 500 and no hold
--   outreach_first_touches_today: first-touch kinds sent today, for the daily cap
```

The rest comes from the core:

- people at each brand, and their addresses: `people`, `contacts`;
- every email: `actions`, with kinds as above;
- do-not-contact and "in talks via agency": `holds`;
- promised reports and codes: `tasks`;
- inbound mail handled: `inbox`;
- the timeline: `log`.

## What it taught

- **The send gate has to live in the database.** In the first version the agent checked
  holds itself, and one day it didn't.
- **Agencies cover many brands.** One email, about the agency, with `payload.covers`
  listing the brands, so a hold on any of them stops it.
- **Domain warm-up is a real limit.** A burst of first touches to stale network-profile
  addresses caused a bounce spike that nearly got the sending domain paused. Hence the
  daily cap and the bounce check.
- **"Commercial" and "contract" must be kinds of their own, always human,** so a reply
  that drifts into money can't ride on trust earned by thank-you notes.
