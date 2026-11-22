export interface RateLimitDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export type RateLimitResult = { allowed: true; remaining: number; retryAfterSeconds: number } |
  { allowed: false; remaining: 0; retryAfterSeconds: number };

export async function consumeRateLimit(
  db: RateLimitDatabase,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<RateLimitResult> {
  if (!bucketKey || !Number.isInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) {
    throw new Error("Invalid rate-limit configuration");
  }
  const windowStartedAt = Math.floor(now / windowMs) * windowMs;
  const expiresAt = windowStartedAt + windowMs * 2;
  const row = await db.prepare(
    "INSERT INTO request_rate_limits (bucket_key,window_started_at,request_count,expires_at) VALUES (?,?,1,?) " +
    "ON CONFLICT(bucket_key) DO UPDATE SET " +
    "window_started_at=excluded.window_started_at, " +
    "request_count=CASE WHEN request_rate_limits.window_started_at=excluded.window_started_at THEN request_rate_limits.request_count+1 ELSE 1 END, " +
    "expires_at=excluded.expires_at " +
    "WHERE request_rate_limits.window_started_at<>excluded.window_started_at OR request_rate_limits.request_count<? " +
    "RETURNING request_count"
  ).bind(bucketKey, windowStartedAt, expiresAt, limit).first<{ request_count: number }>();
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartedAt + windowMs - now) / 1000));
  if (!row) return { allowed: false, remaining: 0, retryAfterSeconds };
  return { allowed: true, remaining: Math.max(0, limit - row.request_count), retryAfterSeconds };
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({
    error: "RATE_LIMITED",
    message: "Too many requests. Please wait before trying again."
  }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(retryAfterSeconds),
      "x-content-type-options": "nosniff"
    }
  });
}

export async function cleanupExpiredRateLimits(db: RateLimitDatabase, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM request_rate_limits WHERE expires_at<?").bind(now).run();
}
