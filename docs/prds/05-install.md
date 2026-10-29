# PRD 05: Installing the mail Worker, and the end-to-end check

## Goal

A project goes from "no mail" to "desks answer mail as it arrives" by following the kit:
install the kit, fill in `desks/mail/wrangler.jsonc`, deploy once, set two lines in
`desks/.env`, and say `/desk <name> listen`.

## Locked decisions

- `bin/kit.mjs` ships `desks/kit/mail/` with the rest of `kit/`, and ignores `node_modules`
  and `.wrangler` anywhere under the kit's folders.
- `kit/mail/README.md` is the setup recipe: Cloudflare routing per address, Email Sending on
  the subdomain, D1, the secret, deploy, `desks/.env`. It points at `kit/guide/cloudflare-mail.md`
  for the Cloudflare side, and states the contract for projects that keep their own Worker.
- `new-desk` offers the Worker when a desk talks by email and the project has none, and asks
  before any Cloudflare change.
- The end-to-end check runs the Worker with `wrangler dev` on this machine: mail goes in
  through the local email handler, `watch` wakes, `send` replies, the Worker's Sent record
  shows it. No Cloudflare account is touched.

## Implementation Notes

(Filled in after shipping.)
