/** Pure helpers for Supabase password-recovery callback URLs. */
const AUTH_QUERY_KEYS = [
  'code',
  'state',
  'type',
  'flow_id',
  'sb_flow_id',
  'error',
  'error_code',
  'error_description',
  'auth',
  'access_token',
  'refresh_token',
  'token_type',
  'expires_in',
  'expires_at'
];

/**
 * Inspect implicit-flow hash parameters and PKCE query parameters without
 * relying on the browser's global location object.
 */
export function inspectAuthCallback(href = '') {
  let url;
  try {
    url = new URL(href, 'https://app.invalid/');
  } catch {
    return { isRecovery: false, hasAuthParams: false, error: '' };
  }

  const search = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (key) => search.get(key) || hash.get(key) || '';
  const flowId = get('flow_id') || get('sb_flow_id');
  const type = get('type');
  const marker = get('auth').toLowerCase();
  const error = get('error_description') || get('error_code') || get('error');
  const recoveryErrorPattern = /otp_expired|recovery|reset link|password reset|email link.*(?:invalid|expired)/i;
  const isRecovery =
    type.toLowerCase() === 'recovery' ||
    marker === 'reset' ||
    /password.?recovery|recovery/i.test(flowId) ||
    (Boolean(error) && recoveryErrorPattern.test(error));
  const hasAuthParams = AUTH_QUERY_KEYS.some((key) => search.has(key) || hash.has(key));

  return { isRecovery, hasAuthParams, error };
}

/** Remove auth callback parameters while preserving the app path and ordinary route hash. */
export function stripAuthCallback(href = '') {
  let url;
  try {
    url = new URL(href, 'https://app.invalid/');
  } catch {
    return '';
  }
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
  // Supabase's implicit flow puts the recovery tokens in the fragment. Once
  // the client has consumed them, the fragment is no longer an app route.
  if (/access_token|refresh_token|error_description|error_code|type=recovery/i.test(url.hash)) {
    url.hash = '';
  }
  return url.toString();
}
