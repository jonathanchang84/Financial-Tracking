import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectAuthCallback, stripAuthCallback } from '../src/services/authRecovery.js';

test('recognizes the explicit reset marker before Supabase emits its event', () => {
  const result = inspectAuthCallback('https://app.example/?auth=reset');
  assert.equal(result.isRecovery, true);
  assert.equal(result.hasAuthParams, true);
});

test('recognizes an implicit recovery callback in the URL fragment', () => {
  const result = inspectAuthCallback(
    'https://app.example/?keep=1#access_token=abc&refresh_token=def&type=recovery&expires_in=3600'
  );
  assert.deepEqual(result, { isRecovery: true, hasAuthParams: true, error: '' });
});

test('recognizes a PKCE recovery callback and its flow metadata', () => {
  const result = inspectAuthCallback('https://app.example/?code=abc&sb_flow_id=recovery-flow');
  assert.equal(result.isRecovery, true);
  assert.equal(result.hasAuthParams, true);
});

test('recognizes an expired recovery callback as a recovery error', () => {
  const result = inspectAuthCallback(
    'https://app.example/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
  );
  assert.equal(result.isRecovery, true);
  assert.match(result.error, /expired/i);
});

test('does not treat a generic PKCE sign-in code as password recovery', () => {
  const result = inspectAuthCallback('https://app.example/?code=abc&sb_flow_id=sign-in-flow');
  assert.deepEqual(result, { isRecovery: false, hasAuthParams: true, error: '' });
});

test('does not treat an ordinary app hash route as an auth callback', () => {
  const result = inspectAuthCallback('https://app.example/#cashflow');
  assert.deepEqual(result, { isRecovery: false, hasAuthParams: false, error: '' });
});

test('strips callback parameters but preserves an ordinary app route', () => {
  assert.equal(
    stripAuthCallback('https://app.example/?keep=1&code=abc&sb_flow_id=flow&auth=reset#pensions'),
    'https://app.example/?keep=1#pensions'
  );
  assert.equal(
    stripAuthCallback('https://app.example/#access_token=abc&refresh_token=def&type=recovery'),
    'https://app.example/'
  );
});
