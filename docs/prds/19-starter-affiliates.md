# PRD 19: starter, the affiliate program

Built in the public `react-saas-starter` repo. This file moves there when the lane
starts.

## Goal

An app made from the starter has its own affiliate program: people sign up as affiliates, share
a link, and earn a commission on what the customers they bring pay. The affiliates desk
(PRD 17) recruits and runs it.

## Locked decisions

- Built in, not bought. Hosted tools (Rewardful, FirstPromoter, Tolt, PartnerStack) charge a
  monthly fee and keep the data. Built in, the program costs nothing until it pays, its numbers
  sit in the app's own database where the desk reads them, and the terms are configuration.
- Any signed-in user can apply to be an affiliate. An admin approves them (or the desk prepares
  the approval for a person). An approved affiliate gets a code and a link (`/?ref=<code>`).
- A visit with `ref` sets a first-party cookie for the configured number of days. Attribution is
  saved on the organisation when it's created, first touch wins, and it never changes after.
  Nobody earns on their own organisation.
- When an attributed organisation's invoice is paid (PRD 18's webhook), the app writes a
  commission: the configured rate on the amount paid net of tax, in the invoice's currency, for
  the configured number of months (or for life). It starts `pending`, becomes `approved` after
  the refund window, and `paid` when an admin records the payout. A refund reverses it.
- Payouts are made by a person (bank transfer, PayPal, Wise) and recorded in the app, with an
  export for the month. Stripe Connect is the parking lot.
- The affiliate's page: their link, visits, sign-ups, paying customers, commission pending,
  approved and paid, and the terms.
- Admin pages: applications, affiliates, commissions, payouts, the month's export.
- An admin API (read for the desk, with a scoped token): affiliates, commissions owed by month,
  applications waiting.
- PostHog events: referral visit, referred sign-up, referred subscription, commission earned.

## Acceptance criteria

1. WHEN a visitor arrives with a valid `ref`, signs up and creates an organisation THE
   organisation SHALL be attributed to that affiliate.
2. WHEN that organisation's invoice is paid THE affiliate SHALL get one pending commission at the
   configured rate; WHEN the invoice is refunded THE commission SHALL be reversed.
3. WHEN an affiliate refers their own organisation THE app SHALL attribute nothing.
4. WHEN the refund window passes THE commission SHALL become approved, and the month's export
   SHALL list it.
5. WHEN an admin records a payout THE commissions it covers SHALL be marked paid, with who and
   when.

## Implementation Notes

(Filled in after it ships.)
