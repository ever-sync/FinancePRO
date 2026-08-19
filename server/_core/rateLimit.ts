import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  maxKeys?: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export function createRateLimiter({
  windowMs,
  max,
  maxKeys = 10_000,
}: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let entry = entries.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - entry.count))
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1_000)));

    if (entries.size > maxKeys) {
      entries.forEach((value, storedKey) => {
        if (value.resetAt <= now) entries.delete(storedKey);
      });
      while (entries.size > maxKeys) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) break;
        entries.delete(oldestKey);
      }
    }

    if (entry.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)))
      );
      return res
        .status(429)
        .json({
          ok: false,
          error: "Muitas requisicoes. Tente novamente em instantes.",
        });
    }

    return next();
  };
}

export const trpcRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 240,
});
export const whatsappWebhookRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
});
export const n8nAgentRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 180,
});
export const assistantCronRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
});
export const healthRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
});
