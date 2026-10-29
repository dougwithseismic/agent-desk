# Cloudflare mail setup playbook

Use this playbook when an agreed workflow needs Cloudflare Email Routing, Email
Sending, or a Worker-backed mailbox. It is a reusable preparation, change, and
verification procedure. It does not create a mailbox, change DNS, deploy a
Worker, alter an existing source repository, or send mail by itself.

Record the agreed route and authority in the desk's own `desks/<name>/playbooks/mail.md`
(what the "Mail record" section below lists). Keep provider secrets, customer mail and
domain-specific configuration out of this guide.

## Boundaries

- Treat native Cloudflare Email Service as transactional infrastructure: account
  verification, password resets, receipts, support replies, alerts, and other
  user-triggered messages. Do not use it for cold prospecting, newsletters,
  promotional campaigns, bulk partner outreach, or a campaign intended to evade
  another sender's reputation. Use an approved marketing or outreach provider
  for those messages.
- Prefer a working existing provider when it has the required purpose, sender
  identity, reputation boundary, storage, access controls, and audit trail. A
  dedicated domain or subdomain needs a documented reason.
- Read source configuration and documentation as evidence only. Do not clone an
  application, import another desk, or copy its addresses, records, limits, or
  credentials as defaults. A SQLite Durable Object, R2, KV, D1, or another
  store is chosen from the actual workflow; this playbook does not mandate D1.
- Keep discovered, prepared, applied, verified, uncertain, and blocked states
  separate. A successful command, HTTP 2xx, provider acceptance, or browser
  screen is not by itself proof of persistence, delivery, or inbox arrival.
- Never bypass the approved authenticated mailbox path because a credential
  failed or a send appears slow. A direct provider send can bypass sender
  validation, approval, caps, signatures, Sent storage, and audit evidence.
- Keep credentials in the existing local secret mechanism. Never print, paste,
  copy, commit, or capture secret values.

## Provider distinction and plan readiness

Cloudflare has separate capabilities that must be checked independently:

- **Email Routing** receives mail for a zone and routes it to verified
  destinations or a Worker. It is available on Workers Free and Paid, subject
  to the current onboarding and account state.
- **Email Sending** sends through a Worker `send_email` binding or the REST API
  after the sending domain is onboarded and authenticated.
- Sending to a verified destination is a separate, limited capability from
  sending to arbitrary recipients. Current Cloudflare documentation describes
  verified-destination sending as available without the arbitrary-recipient
  Workers Paid requirement. Arbitrary-recipient sending requires Workers Paid
  and is still subject to account and deliverability limits.
- A sending subdomain is onboarded as a sending domain. Routing is a zone-level
  feature by default; a routing subdomain can be enabled separately. Routing
  catch-all is an apex feature, while a routing subdomain uses literal
  recipient rules.

Plan readiness is a live provider fact. A Wrangler file, source repository,
domain name, or old dashboard screenshot cannot prove it. Read the current
account plan, Email Sending onboarding state, recipient capability, quota, and
domain status from Cloudflare before marking the workflow ready. If the
provider does not expose the required capability, mark the workflow blocked and
choose an approved transport; do not work around a plan restriction by changing
domains or splitting one send into verified-recipient messages.

## Read-only discovery

Start with the agreed purpose, message class, sender identity, audience,
storage requirement, and authorized action scope. If the purpose is a campaign
or cold outreach, stop and use the approved marketing/outreach workflow.

Inspect the source project and provider state without mutating either. Record
the source and retrieval time for each finding, and leave unknown values
unknown. Discover, in this order:

1. Cloudflare account, zone, owner, plan, domain/subdomain, DNS authority, and
   current Email Sending and Email Routing onboarding state.
2. Existing MX, SPF, DKIM, DMARC, MTA-STS, and other mail-provider records;
   identify which provider owns root-domain mail. A root MX change can interrupt
   unrelated mailboxes.
3. Routing rules, catch-all state, verified destinations, subdomain settings,
   Worker email handler, and whether rules are managed in the dashboard or by
   Wrangler.
4. Worker compatibility/deployment state, `send_email` binding restrictions,
   sender restrictions, account/domain bindings, and any local dry-run output.
5. Storage and access boundaries: Durable Objects/SQLite, R2/KV/D1 or another
   store, retention, Cloudflare Access application and policy, service-token
   names, API-token scopes, and any protected API/MCP endpoint. Record names and
   IDs only; never record secret values.
6. Mailbox identities and behavior: canonical address, aliases, plus
   addressing, display name, default From, Reply-To, reply From, CC/BCC policy,
   signature source, attachment storage, threading headers, local caps,
   suppression checks, and the authoritative Sent/inbound records.
7. Provider activity, metrics, bounces, complaints, suppressions, and recent
   configuration/audit events for the relevant account and domain. Record the
   observation window; provider metrics are retained only for the period stated
   in the current documentation.

For a project that already pins Wrangler, use the local version and its help
output. Do not install an ad-hoc version with `npx`:

~~~sh
pnpm exec wrangler --version
pnpm exec wrangler email --help
pnpm exec wrangler email sending --help
pnpm exec wrangler email routing --help
~~~

Use only subcommands shown by the installed help. If the project has no local
Wrangler, use the Cloudflare dashboard or the official API reference rather
than adding a dependency during discovery. Running the kit's mail Worker is
different: it needs a Wrangler at least as new as its `compatibility_date`, so
its README uses `npx wrangler@latest`. For a supported configuration that
manages routing addresses, `pnpm exec wrangler deploy --dry-run` can show the
planned reconciliation; inspect it carefully because an empty managed address
list can remove rules owned by that configuration.

Observe DNS with read-only queries. To make an authoritative check, first read
the zone's nameservers, then query one of those nameservers directly:

~~~sh
dig +short NS example.com
dig @ns1.example.com +short MX example.com
dig @ns1.example.com +short TXT example.com
dig @ns1.example.com +short TXT _dmarc.example.com
~~~

Replace the example names only in a prepared, scoped command, using an
authoritative nameserver returned for the domain. Do not guess a Cloudflare MX
target, SPF include, DKIM key, selector, priority, TTL, or DMARC policy. The
provider-generated record set is the source of truth.

For a suppression read, use the provider's current API reference; the documented
operation is `GET /accounts/{account_id}/email/sending/suppressions`. Confirm
filters, pagination, scopes, and required read permission from the current
reference before constructing a request. Use the Email Service observability
documentation for current metrics datasets and fields rather than copying an
old GraphQL query.

## Choose the topology

Reuse an existing route when its purpose, identity, reputation boundary, access
policy, mailbox persistence, forwarding policy, and audit requirements match the
requested workflow. Confirm that the cloud resources are healthy; a hostname in
source configuration is not proof that the route exists or works.

Choose a dedicated sending or routing subdomain when the workflow requires a
separate product, sender identity, reputation boundary, access boundary, or
retention policy. Document the affected flows and rollback before applying it.

Do not enable apex Email Routing merely to create one Worker mailbox. Preserve
the existing root-domain MX unless the user explicitly authorizes a migration.
Do not treat a dedicated subdomain as permission for promotional or cold mail.

## Prepare the design

Prepare one reviewable change set containing the exact resources and records:

- domain/subdomain, Email Sending onboarding, Email Routing scope, and current
  provider ownership;
- Worker, email handler, `send_email` binding, allowed sender/destination
  restrictions, routing ownership, and deployment/version;
- canonical mailbox, aliases, plus-address behavior, display name, default
  From, Reply-To, reply From, CC/BCC, and authorized test identity;
- forwarding destinations and exclusions, including which destinations have
  completed provider verification;
- storage for message metadata, bodies, threading headers, and attachment
  bytes; retention and deletion behavior;
- Cloudflare Access application/policy, service-token reference, API-token
  read/edit scopes, and protected endpoint; and
- provider-generated DNS records, application caps, provider limits, stop
  conditions, evidence to collect, and rollback.

One scoped authorization may approve the named batch of DNS records, aliases,
forwarding destinations, secret references, Worker configuration, and other
listed setup actions. Do not ask for a separate approval for every record or
alias within that agreed batch. Ask again only when a missing authorization,
new recipient/test, or material scope expansion changes what will happen.

### DNS and authentication

Email Sending and Email Routing use different authentication records. Email
Sending commonly provides `cf-bounce` MX/SPF/bounce records, a sending DKIM
selector, and a sending DMARC record. Email Routing provides its own MX, SPF,
and DKIM records for the routing domain or subdomain. The exact names, values,
priorities, and locked/unlocked state come from the provider settings.

Copy provider-generated records exactly, preserve existing provider records, and
merge SPF into one `v=spf1` record while checking the SPF DNS-lookup limit. Do
not replace an existing root MX or publish a second SPF record as a shortcut.
After an authorized change, query authoritative DNS and compare it with the
provider's read-back. Record propagation and any provider warning separately.

### Routing, forwarding, and inbound handling

Add and verify forwarding destinations before enabling rules. Routing rules and
Worker `forward()` require verified destinations; a Worker invocation or
forwarding call does not prove final delivery to the destination inbox. For
multiple copies, forward once per verified destination and keep exclusions
explicit.

The inbound handler should consume the raw message once, select the mailbox
from the envelope recipient (which covers Bcc and list delivery), parse it,
persist the message and identifiers, then deliberately forward, reply, or
reject. Surface a real handler failure so Email Routing can retry or report a
delivery failure; silently swallowing an error drops mail.

### Identity, replies, signatures, and files

Keep these fields separate in the desk's mail record:

- canonical mailbox and envelope recipient;
- aliases that route into the mailbox and are allowed to send as it;
- display name, default new-message From, reply From, and explicit Reply-To;
- To, CC, and BCC policy;
- signature HTML/text source and version/hash, including whether it applies to
  new messages, replies, or both; and
- authorized test identity and recipient.

Validate every requested From against the canonical mailbox or an approved
alias. Preserve `In-Reply-To` and `References` on replies and store the
provider-issued Message-ID; never manufacture a provider ID. Apply a signature
in one layer only. Keep drafts' attachment behavior explicit because mailbox
stores often do not persist draft files.

For attachments and inline images, store filename, MIME type, disposition,
content ID, byte size, content hash and durable object key or equivalent. Keep binary data
separate from message metadata when appropriate, sanitize filenames, enforce an
application cap before provider submission, and apply the current provider
message-size and recipient limits. A local cap can be stricter; it cannot
authorize exceeding the provider limit.

## Apply the agreed change

Apply only the prepared, scoped change set. Preserve existing mail flow before
onboarding or DNS changes. Configure and verify destinations before routing
rules. Deploy the reviewed Worker and bindings only after checking routing
ownership and the dry-run result. Keep secrets in Cloudflare Secrets or the
approved local secret store.

Record provider request/action IDs, deployment/version IDs, DNS retrieval times,
audit entries, and partial or warning responses. A test send is a separate
action: it needs an authorized recipient and purpose, preferably an address
controlled by the user. Never use a fake recipient to test deliverability.

Applied means the provider accepted the requested configuration and an
authoritative read-back confirms it. It does not mean the route is healthy or a
message reached an inbox.

## Verify each layer

### Configuration and DNS

- Re-read Email Sending and Email Routing onboarding and active state.
- Compare provider-generated records with authoritative MX/TXT/DKIM/DMARC
  queries and record the retrieval time.
- Re-read routing rules, destination verification, Worker bindings and
  restrictions, storage bindings, and Access policy.
- Check the provider audit log for each configuration action.

### Inbound

- For an authorized test, verify the durable inbox record by envelope
  recipient, sender, subject, received time, provider identifiers, and
  attachment metadata and retrieved bytes/hashes where supported.
- Verify the routing Activity result (such as Forwarded, Handled, Dropped,
  Rejected, Delivery failed, or Error) rather than trusting a browser screen.
- Check a controlled forwarding destination only when it is in scope. Keep
  Worker handling, provider acceptance, and destination inbox receipt as
  separate observations.
- Exercise aliases, plus addresses, Bcc, and list mail only when the agreed
  test scope includes them.

### Outbound

- Read the application's authoritative Sent record. It should include the
  normalized sender, recipients, display name, subject/body or content hash,
  signature state, reply headers, attachment metadata, and provider Message-ID.
  Retrieve and compare stored attachment bytes/hashes where supported; names/counts
  alone cannot prove files arrived intact.
- Read the provider Activity event for that Message-ID. Distinguish accepted or
  queued, delivered to the recipient server, delivery failure, suppression
  rejection, and configuration/authentication failure.
- Treat provider acceptance as sent, not delivered. A controlled recipient
  inbox is evidence of arrival, not a replacement for the provider event.
- Preserve the invariant that a failed provider submission does not create a
  false Sent record. Reconcile ambiguous results before retrying.

### Health and suppression

Inspect account and sending-domain suppressions before an authorized send. Use
the current suppression API's scope and mutability fields; do not infer that an
entry can be changed from its reason text. Stop on hard bounces, complaints,
active suppression, repeated soft bounces, authentication failures, rate-limit
responses, or a material deliverability decline. Use current Cloudflare
deliverability guidance and the project's approved thresholds as alert
boundaries.

Do not delete a suppression just to make a test pass. Do not switch aliases,
domains, or transports to bypass it. Reconcile a timeout, ambiguous API result,
partial response, or unknown delivery state through application records,
provider Activity, audit logs, and the controlled recipient before retrying;
never send a duplicate automatically.

## Credentials and access

Claude and Codex may use the same named local credential reference without
exchanging secret values. Keep environment variables, keychain entries,
protected secret-manager references, local `.env`/`.dev.vars`, Wrangler auth
state, and API-token files outside Git and captured logs. A presence check may
look like this without printing a value:

~~~sh
test -n "${MAIL_ACCESS_CLIENT_ID:-}" && \
  test -n "${MAIL_ACCESS_CLIENT_SECRET:-}" || exit 2
~~~

Fail closed when required credentials are absent. Distinguish credentials by
purpose:

- Access service-token ID/secret authenticate to a protected mailbox or MCP
  Worker; they are not Email Sending API credentials.
- Access JWT audience/domain configuration validates the Access token and must
  fail closed when required production settings are missing.
- Cloudflare API tokens should have only the Email Sending, Email Routing, DNS,
  or Analytics permissions required for the task. Separate read-only diagnosis
  from authorized mutation; suppression changes require the provider's edit
  permission.

Never run a command that prints a reusable auth token into a shared transcript.

## State and recovery

Use these states in the desk's mail record and the log:

| State | Evidence | Next step |
| --- | --- | --- |
| discovered | Read-only source/provider inventory, timestamps, IDs, and unknowns | Resolve dependencies or prepare a change set |
| prepared | Exact resources, provider records, affected flows, limits, recipient, and rollback | Apply within existing scoped authorization, or resolve the missing authority for the listed batch |
| applied | Provider/deployment receipts and configuration read-back | Run independent verification |
| verified | DNS/provider state, routing or Worker handling, durable record, provider event, and in-scope inbox observation | Operate within the desk's limits |
| uncertain | Timeout, ambiguous, partial, or unknown delivery result | Reconcile before retrying |
| blocked | Missing plan capability, unverified destination, failed auth, DNS conflict, suppression, or missing authorization | Preserve evidence and request the specific dependency |

Recovery preserves evidence first. For a failed or uncertain send, inspect the
application idempotency/send record, provider Message-ID or request ID,
Activity, suppression state, and audit trail before any retry. For inbound
failure, inspect the envelope recipient, Worker error, routing Activity, and
durable storage transaction before forwarding again. Treat rate limits,
provider suppression, missing verification, and authentication errors as stop
conditions; do not bypass them.

## Mail record

Populate `desks/<name>/playbooks/mail.md` with the current non-secret purpose, authority,
identity, transport, provider/account/domain state, authentication records and
retrieval times, routing/destinations, storage and Access boundary, aliases and
reply behavior, signature and file rules, suppression/limit state, authorized
test scope, authoritative Sent/inbound checks, evidence references, and current
state. Keep credentials, raw customer mail, full attachment contents, and secret
headers out of it.

## Key Cloudflare references

Refresh these official pages before an applied change; provider documentation
and the API specification override this playbook:

- [Domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Email authentication](https://developers.cloudflare.com/email-service/concepts/email-authentication/)
- [Routing addresses and rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)
- [Email subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)
- [Send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Workers send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [REST send API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Suppression API reference](https://developers.cloudflare.com/api/resources/email_sending/subresources/suppressions/)
- [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Email Service pricing and plan availability](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Email deliverability](https://developers.cloudflare.com/email-service/concepts/deliverability/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
