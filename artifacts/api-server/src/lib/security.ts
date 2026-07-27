import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Backend hardening helpers (SEC-2 / SEC-4).
 *
 * These are intentionally dependency-free: this API runs as a single
 * persistent instance (Render free / Docker), and adding `helmet` /
 * `express-rate-limit` here would touch package.json + the pnpm lockfile,
 * which has repeatedly broken the `--frozen-lockfile` build path (see
 * SESSION_LOG "gotcha del lockfile"). A hand-rolled header middleware and an
 * in-memory fixed-window limiter cover this app's threat model; swap to the
 * battle-tested libs later if the deploy grows to multiple instances.
 */

/** bcrypt work factor. Bumped from 10 → 12 for 2026 (SEC-2). */
export const BCRYPT_ROUNDS = 12;

/**
 * Minimal security headers for a JSON-only API (SEC-4). No CSP tuning for
 * markup is needed — the API never returns HTML — so `default-src 'none'`
 * is safe and locks down any accidental document response. HSTS is only sent
 * in production (behind HTTPS on Render); sending it over plain-HTTP local dev
 * would poison the browser cache for localhost.
 */
export function securityHeaders(): RequestHandler {
  const isProduction = process.env["NODE_ENV"] === "production";
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.removeHeader("X-Powered-By");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  };
}

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window rate limiter keyed by client IP (SEC-4). Returns 429
 * with a `Retry-After` header once `max` requests are seen within `windowMs`.
 * State is per-process (fine for a single instance); it resets on restart and
 * self-prunes expired windows so the map can't grow unbounded.
 *
 * With `skipSuccessfulRequests`, only requests that end in a failure (response
 * status >= 400) keep their tick — successful ones are refunded when the
 * response finishes. Used on login so a shared account behind one office IP
 * can't be throttled by legitimate sign-ins, while wrong-password attempts
 * (the brute-force vector) still accumulate toward the limit.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}): RequestHandler {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later.",
    skipSuccessfulRequests = false,
  } = options;
  const hits = new Map<string, WindowState>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";

    // Opportunistic prune of expired windows to bound memory.
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }

    let state = hits.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      hits.set(key, state);
    }
    state.count += 1;

    if (state.count > max) {
      const retryAfterSec = Math.ceil((state.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: message });
      return;
    }

    if (skipSuccessfulRequests) {
      // Refund the tick once we know the outcome, so only failures (>= 400)
      // count. `state` is captured by reference; if its window has since rolled
      // over this decrements an orphaned object, which is harmless.
      const counted = state;
      res.on("finish", () => {
        if (res.statusCode < 400) {
          counted.count = Math.max(0, counted.count - 1);
        }
      });
    }

    next();
  };
}
