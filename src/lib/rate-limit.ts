import { db } from "@/lib/db";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Persistent atomic rate limiter backed by PostgreSQL.
 * Survives container rebuilds, worker scaling, and restarts.
 * Falls back safely to memory if database connection is temporarily interrupted.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; remaining: number; retryAfterMs: number }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  try {
    const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "createdAt", "updatedAt")
      VALUES (${key}, 1, ${resetAt}, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt";
    `;

    const row = rows[0];
    if (!row) {
      return memoryRateLimit(key, limit, windowMs);
    }

    const currentCount = Number(row.count);
    const rowResetTime = new Date(row.resetAt).getTime();
    const retryAfterMs = Math.max(0, rowResetTime - Date.now());

    if (currentCount > limit) {
      return { ok: false, remaining: 0, retryAfterMs };
    }

    return {
      ok: true,
      remaining: Math.max(0, limit - currentCount),
      retryAfterMs: 0,
    };
  } catch (error) {
    console.warn("[rate-limit] Database check failed, falling back to in-memory limiter:", error);
    return memoryRateLimit(key, limit, windowMs);
  }
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/** Periodic in-memory bucket cleanup for fallback mode. */
if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.resetAt <= now) memoryBuckets.delete(key);
    }
  }, 10 * 60 * 1000);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
