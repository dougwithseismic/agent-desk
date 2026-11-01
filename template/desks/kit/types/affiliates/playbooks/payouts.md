# Payouts: once a month, a person pays

A payout is money leaving the business, so it's always a person's. The desk works out what's
owed and why; the person approves it, pays it, and the desk records it under their name. The
database keeps every payout with a person whatever trust says, and refuses one recorded as
paid by an agent.

The desk never holds bank or payment details: the product does, and the person pays from
there.

## When

The first round after a month closes, for that month. A payout for a month still running is
refused.

## 1. What's owed

From the product, the commissions owed for the month, per affiliate: approved ones only,
past the refund window, never pending. Check each against the invoice it rests on in Stripe:
paid, and not refunded since.

```bash
node desks/desk.mjs stripe invoices/in_1Q2w
```

If a commission and its invoice don't agree, leave that affiliate's payout out, and give the
person a task with both numbers. Under the minimum in `facts.md`, it waits for next month.

## 2. One payout per affiliate

One action each, waiting for the person. The channel is how it's paid (`bank`, `paypal`,
`wise`), the target the affiliate's id in the product, and the payload what it pays and the
invoices it rests on:

```sql
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, payload, evidence, status, why_human, created_by)
VALUES ('affiliates', 'payout:person:sam-lee:2026-10', 'payout', 'paypal', 'example.com', 'person:sam-lee',
  'affiliate:aff_123', 'Pay Sam Lee 84.00 USD for October 2026', :body,
  json_object('month', '2026-10', 'amount', 84.00, 'currency', 'usd',
    'invoices', json_array('in_1Q2w', 'in_1Q3x'), 'commissions', json_array('com_88', 'com_91')),
  json_array('product: commissions owed, 2026-10', 'stripe invoices/in_1Q2w', 'stripe invoices/in_1Q3x'),
  'waiting', 'a payout is always a person''s', :me);
```

The key is `payout:<affiliate>:<month>`, so there's one per affiliate per month. The body
lists each commission with its invoice and amount, the total, and how it's paid. A hold on
the affiliate stops their payout too: tell the person which hold.

## 3. The person pays

Show the month's payouts together, with the total. The person approves each, or changes it.
They pay it, record it in the product (which marks the commissions paid), and tell you.
Then record it under their name, with the reference they give:

```sql
UPDATE actions SET status = 'sending', mode = 'human', sent_by = :person, last_by = :me WHERE id = :id AND status = 'approved';
UPDATE actions SET status = 'sent', provider_ref = :ref, last_by = :me WHERE id = :id;
```

It's `verified` once the product shows the commissions paid. Until the person says it's paid,
it stays approved: never record a payout as sent on a guess.

## Changing the terms

The first terms are what the person says when they open the program, written into
`facts.md` in their words. After that, a change is a `terms-change` action, always theirs: what
changes, from when, and whether it applies to affiliates already in the program or only new
ones.

```sql
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, status, why_human, created_by)
VALUES ('affiliates', 'terms-change:2026-12-01', 'terms-change', 'product', 'example.com', 'program:terms',
  'program:terms', 'Commission from 20% to 25% for referrals from 1 December', :body,
  'waiting', 'terms are always a person''s', :me);
```

Once they approve it, the product's settings and `facts.md` change together, and affiliates
it touches hear before it applies to them.
