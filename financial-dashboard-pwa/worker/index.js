import { AuthRateLimiter } from './rate-limiter.js';
import { handleAuth } from './auth.js';
import { handleSync } from './sync.js';
import { AppError, checkOrigin, errorResponse, json } from './support.js';

export { AuthRateLimiter };

const API_PREFIX = '/api/';

function cleanPath(path) {
  return path.replace(/^\/+|\/+$/g, '');
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
      return notFound();
    }

    let origin = '';
    try {
      origin = checkOrigin(request, env);
    } catch (error) {
      return errorResponse(error);
    }

    // Only the configured app origin may make credentialed API calls.
    const cors = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin'
        }
      : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }
      });
    }

    try {
      const path = cleanPath(url.pathname.slice(API_PREFIX.length));
      const response = path === 'health' && request.method === 'GET'
        ? json({ ok: true })
        : path.startsWith('auth/')
          ? await handleAuth(request, env, path.slice(5))
          : path.startsWith('sync/')
            ? await handleSync(request, env, path.slice(5))
            : await Promise.reject(new AppError('Application API route not found.', 404, 'not_found'));
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const response = errorResponse(error);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  }
};
