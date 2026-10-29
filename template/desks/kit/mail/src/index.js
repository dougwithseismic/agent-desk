// The desks' mail Worker, from the agent-desk kit. It receives mail for the desks'
// addresses (Email Routing), stores and threads it in D1, forwards a copy to the person,
// and sends the replies a desk has approved (Email Sending). Settings are in the
// project's desks/mail/wrangler.jsonc.

import { handleFetch } from './api.js';
import { handleEmail } from './inbound.js';

export default {
  async fetch(request, env) {
    return handleFetch(request, env);
  },
  async email(message, env) {
    await handleEmail(message, env);
  },
};
