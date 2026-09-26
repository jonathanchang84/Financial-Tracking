import test from 'node:test';
import assert from 'node:assert/strict';

import { friendlyAuthError } from '../src/services/authErrors.js';

test('keeps the real wait time the Worker sends instead of a flat one minute', () => {
  // Regression: the Worker reports "try again in 4 minutes" and the UI flattened it
  // to "wait a minute". Obeying the shorter claim failed even when the user waited,
  // and each retry re-incremented the counter and pushed the window further out.
  const server = { status: 429, code: 'rate_limited', message: 'Too many attempts in a short time — please try again in 4 minutes.' };
  assert.match(friendlyAuthError(server), /try again in 4 minutes/i);
  assert.doesNotMatch(friendlyAuthError(server), /wait a minute/i);
});

test('a 429 carrying no usable message still gets the generic rate limit copy', () => {
  // A Cloudflare edge block answers with HTML, so the client parses no payload and
  // reaches the mapper with a status but no message. That must not surface blank.
  assert.match(friendlyAuthError({ status: 429, message: '' }), /wait a minute/i);
  assert.match(friendlyAuthError({ status: 429 }), /wait a minute/i);
});

test('still translates the other authentication failures', () => {
  assert.match(friendlyAuthError({ code: 'invalid_credentials', message: 'nope' }), /incorrect/i);
  assert.match(friendlyAuthError({ status: 503, message: 'boom' }), /older build/i);
  assert.equal(friendlyAuthError({ message: 'plain server copy' }), 'plain server copy');
});
