# PRD 18: starter, Stripe billing per organisation

Built in the public `react-saas-starter` repo. This file moves there when the lane
starts.

## Goal

An app made from the starter can take money from day one. The starter has accounts, organisations,
analytics and email, but no way to pay. A stranger should be able to pick a plan, pay through
Stripe Checkout, manage it in the Customer Portal, and have the app know what they're entitled
to.

## Locked decisions

- Subscriptions belong to an organisation, not a user. The owner and admins manage billing.
- Use Better Auth's Stripe plugin if it covers organisation subscriptions, trials and the
  Customer Portal (check its current docs first); otherwise a `billing` module in
  `apps/server/src/modules` with our own webhook. Record which, and why, in the starter's
  decisions.
- Plans come from configuration that names Stripe price ids, with entitlements per plan (seats,
  limits, features) in shared code (`packages/contracts`), so the web app and the API read the
  same rules.
- The webhook handles checkout completed, subscription created, updated and deleted, invoice
  paid and payment failed. It verifies signatures, is idempotent per event id, and keeps a
  `subscriptions` table that mirrors Stripe.
- A billing page in organisation settings: current plan, change plan (Checkout), manage
  (Portal), invoices. A failed payment shows a banner to admins.
- PostHog events for the funnel: plan viewed, checkout started, subscribed, cancelled, payment
  failed, server-side where the server knows.
- Test mode by default. `.env.example` and `deploy/RAILWAY.md` list the keys; live keys are the
  app owner's step.
- Tests: webhook handling with recorded fixtures; an e2e run through Checkout in test mode where
  CI allows it.

## Acceptance criteria

1. WHEN an organisation owner picks a plan THE app SHALL send them to Stripe Checkout and, after
   payment, SHALL show the plan as active within a minute.
2. WHEN Stripe sends the same event twice THE app SHALL apply it once.
3. WHEN a subscription is cancelled or a payment fails THE app's entitlements SHALL follow, and
   admins SHALL see why.
4. WHEN a member who isn't an owner or admin opens billing THE app SHALL show the plan but not
   let them change it.
5. WHEN the Stripe keys aren't set THE app SHALL run with billing switched off and say so on the
   billing page.

## Implementation Notes

(Filled in after it ships.)
