# Onboard: applications, approval, the welcome

People apply in the product. The desk reads the applications, prepares each approval for the
person, and welcomes everyone approved.

## 1. Applications

Read the applications waiting from the product (`Sources` in `desk.md`). For each, find the
person or record them (`recruit.md`, step 1: `fit` can say they applied unprompted), then set
their stage and the product's id for them:

```sql
INSERT INTO affiliates_people(key, fit, audience, stage, affiliate_id, source, last_by)
  VALUES ('person:sam-lee', 'applied unprompted; runs a forum for bookkeepers', 'a forum, about 3k members',
    'applied', 'aff_123', 'product: applications waiting', :me)
  ON CONFLICT(key) DO UPDATE SET stage = 'applied', affiliate_id = excluded.affiliate_id, last_by = excluded.last_by;
```

## 2. Approval

Check each against `icp.md`, its "who we don't ask" most of all, and any rules in
`facts.md`. Then an `approve-affiliate` action, which waits for the person until they allow
the desk to approve on its own:

```sql
INSERT INTO actions(desk, key, kind, channel, identity, about, target, title, body, evidence, status, why_human, created_by)
VALUES ('affiliates', 'approve-affiliate:aff_123', 'approve-affiliate', 'product', 'example.com', 'person:sam-lee',
  'affiliate:aff_123', 'Approve Sam Lee as an affiliate', :body, json_array('product: application aff_123'),
  'waiting', 'a person approves affiliates until they allow it', :me);
```

The body says who they are, their audience and where you saw it, which part of `icp.md`
they fit, and anything that gave you pause.

Once the person says yes, the approval is made in the product: by the desk if the product
lets it, otherwise by them in its admin pages. Record it sent as any human send is
(`kit/playbooks/actions.md`), and verified once the product shows them approved. A no is a
rejection with their words, and the applicant hears in a `reply`.

## 3. The welcome

Once they're approved in the product, they're `approved`, and get an `onboarding` email:
their link from the product, the terms in a line from `facts.md`, the assets, and who to
write to.

```sql
UPDATE affiliates_people SET stage = 'approved', last_by = :me WHERE key = 'person:sam-lee';
```

## 4. Earning

Every round, from the product: an approved affiliate with a paid referral in the last 90
days is `earning`, and one who's earning with none in 90 days goes back to `approved`. Then
record the headline:

```sql
INSERT INTO measures(desk, name, value, period_from, period_to, source, by)
  VALUES ('affiliates', 'affiliates-earning', 7, date('now', '-90 day'), date('now'),
    'product: affiliates with a paid referral, 90 days', :me);
```

An affiliate who goes quiet, or who asks how they're doing, gets a `reply` with their own
numbers from the product, never another affiliate's.
