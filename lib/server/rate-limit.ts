import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

const LIMIT_PER_MINUTE = 12;
const WINDOW_MS = 60_000;

const globalStore = globalThis as unknown as {
  __soulawareRateLimitMap?: Map<string, number[]>;
};

function getMemoryStore(): Map<string, number[]> {
  if (!globalStore.__soulawareRateLimitMap) {
    globalStore.__soulawareRateLimitMap = new Map<string, number[]>();
  }

  return globalStore.__soulawareRateLimitMap;
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const upstashLimiter =
  upstashUrl && upstashToken
    ? new Ratelimit({
        redis: new Redis({
          url: upstashUrl,
          token: upstashToken,
        }),
        limiter: Ratelimit.slidingWindow(LIMIT_PER_MINUTE, "1 m"),
        prefix: "soulaware:chat",
        analytics: false,
      })
    : null;

function applyMemoryLimit(key: string): LimitResult {
  const now = Date.now();
  const store = getMemoryStore();
  const existing = store.get(key) ?? [];
  const validEntries = existing.filter((entry) => now - entry < WINDOW_MS);

  if (validEntries.length >= LIMIT_PER_MINUTE) {
    const oldest = validEntries[0] ?? now;
    return {
      success: false,
      limit: LIMIT_PER_MINUTE,
      remaining: 0,
      reset: oldest + WINDOW_MS,
    };
  }

  validEntries.push(now);
  store.set(key, validEntries);

  return {
    success: true,
    limit: LIMIT_PER_MINUTE,
    remaining: LIMIT_PER_MINUTE - validEntries.length,
    reset: now + WINDOW_MS,
  };
}

export async function enforceRateLimit(key: string): Promise<LimitResult> {
  if (!upstashLimiter) {
    return applyMemoryLimit(key);
  }

  try {
    const result = await upstashLimiter.limit(key);

    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch {
    return applyMemoryLimit(key);
  }
}
