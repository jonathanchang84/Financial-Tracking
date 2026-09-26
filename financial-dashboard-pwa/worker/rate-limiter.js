/** Serialized authentication rate limiter backed by Durable Object storage. */
export class AuthRateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let input;
    try {
      input = await request.json();
    } catch {
      return Response.json({ error: 'Invalid rate-limit request' }, { status: 400 });
    }
    const key = String(input.key || 'unknown');
    const limit = Math.max(1, Number(input.limit) || 10);
    const windowSeconds = Math.max(60, Number(input.windowSeconds) || 900);
    const now = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(now / windowSeconds);
    const storageKey = `bucket:${key}:${bucket}`;
    const previous = Number((await this.state.storage.get(storageKey)) || 0);
    const count = previous + 1;
    await this.state.storage.put(storageKey, count);
    // Expire old buckets so a long-lived DO does not accumulate every window.
    if (count === 1) {
      const stale = await this.state.storage.list({ prefix: `bucket:${key}:`, limit: 20 });
      const expired = Object.keys(stale).filter((entryKey) => !entryKey.endsWith(`:${bucket}`));
      if (expired.length) await this.state.storage.delete(expired);
    }
    return Response.json({ allowed: count <= limit, count, retryAfter: Math.max(0, bucket * windowSeconds + windowSeconds - now) });
  }
}
