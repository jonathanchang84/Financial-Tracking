/** Pure translations for application API errors. */
export function friendlyAuthError(error) {
  const message = String(error?.message || error || '');
  const code = String(error?.code || '').trim().toLowerCase();
  const status = Number(error?.status ?? 0);

  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    // The Worker already computes the real wait ("try again in 4 minutes"), so keep
    // that wording when it arrives. Reporting a flat "wait a minute" regardless of
    // the actual window is what made a rate-limited sign-in look permanently dead,
    // and obeying it only re-incremented the counter and pushed the window out.
    // A Cloudflare edge block answers with HTML rather than JSON, so no message
    // reaches us here and the generic copy below remains the fallback for that case.
    if (/try again in \d+ minutes?/i.test(message)) return message;
    return 'Too many attempts in a short time — please wait a minute and try again.';
  }

  if (code === 'invalid_email' || /invalid email|email address .* is invalid/i.test(message)) {
    return 'Enter a valid email address and try again.';
  }
  if (code === 'invalid_password' || /password must be at least|password should be at least/i.test(message)) {
    return 'Password must be at least 8 characters.';
  }
  if (code === 'account_exists' || /already exists|already registered|already been registered/i.test(message)) {
    return 'An account with this email already exists — switch to "Sign in".';
  }
  if (code === 'invalid_credentials' || /invalid login credentials|email or password is incorrect|current password is incorrect/i.test(message)) {
    return 'Email or password is incorrect.';
  }
  if (code === 'token_expired' || code === 'token_used' || /expired|already been used|invalid or has expired/i.test(message)) {
    return 'This link has expired or was already used — request a new one.';
  }
  if (code === 'service_misconfigured' || /application service is missing|service is not configured/i.test(message)) {
    return 'The application service is not configured yet. Please contact the app owner.';
  }
  if (code === 'recovery_failed' || /secret answer is not correct/i.test(message)) {
    return 'That secret answer is not correct. Try another one, or sign in if you know your password.';
  }
  if (code === 'same_email' || /same as the current one/i.test(message)) {
    return 'That is already your current email address.';
  }
  // A 5xx means the server threw. Name the likely stale-deploy cause explicitly,
  // because that is by far the most common reason and the user cannot see it.
  if (status >= 500 || /could not complete that request/i.test(message)) {
    return 'The sign-in service hit an internal error. This usually means the server is running an older build — the app owner needs to redeploy it.';
  }
  return message;
}
