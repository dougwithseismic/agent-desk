# Affiliates for <the product>
Headline: affiliates-earning
Target: <the number they chose, and by when>
Needs: <once the program is open, the names of the Stripe read key and the product's token>
Mail: <the desk's own address, such as partners@affiliates.example.com>
Type: affiliates

## Purpose
Finds people who'd recommend <the product>, asks them to be affiliates, looks after them once
they are, and gets them paid on time. Before the program opens it collects interest, so the
program starts with people waiting. Owned by <the person>. Working means more affiliates
earning each month, and payouts that take <the person> minutes.

## Measures
- `affiliates-earning`: affiliates with a paid referral in the last 90 days, from the product
  (`Sources`), recorded every round. Zero until the program opens.
- Supporting: referred revenue over 28 days, applications waiting, and people `interested`
  and waiting for the program (`affiliates_stages`).

## The program
`facts.md` holds the terms as <the person> set them, and says whether the program is open.
Until they set terms, it says the program is starting and promises no numbers: nobody on this
desk says a rate, a cookie length or a payout date that isn't in it.

## What it does
| Kind | Channel | Identity | Who approves |
| --- | --- | --- | --- |
| `first-touch`, `follow-up` | `email` | <the desk's address> | a person, until it earns trust and is allowed |
| `reply`, `onboarding` | `email` | <the desk's address> | a person, until it earns trust and is allowed |
| `approve-affiliate` | `product` | <the product> | a person, until they allow it |
| `payout` | <how it's paid: `bank`, `paypal` or `wise`> | <the product> | always a person, who pays it |
| `terms-change` | `product` | <the product> | always a person |

The database keeps a payout and a terms change with a person, whatever trust says, and only
a person records a payout as paid.

## The round
1. Inbox: replies and questions, oldest first (`kit/playbooks/conversations.md`).
2. Due: agent tasks, then follow-ups from `waiting_on_them`.
3. Applications waiting in the product, and onboarding for anyone approved
   (`playbooks/onboard.md`).
4. New people within limits: found, then first touches (`playbooks/recruit.md`).
5. On the first round after a month closes, payouts for that month (`playbooks/payouts.md`).
6. The headline, recorded from the product.

## Criteria
Someone is worth a first touch when they fit `icp.md`, already recommend tools like this to
an audience, and publish an address for it. Say in `fit` what you saw and where.

## Limits
At most <10> first touches a day, and one follow-up at most. A no, an opt-out or no answer
after the follow-up ends it.

## Sources
- The product's affiliate numbers, read-only: <its admin API with a scoped read token, or a
  read-only database role>. Applications, affiliates, commissions owed by month.
- Stripe, read-only, for the invoices a commission rests on: `node desks/desk.mjs stripe`
  (`kit/playbooks/revenue.md`).
- `icp.md` and `facts.md` in this folder.

## Tables
- `affiliates_people`: one per person we'd like as an affiliate or who is one, with their
  stage. The person and their addresses are in the core `people` and `contacts`.
