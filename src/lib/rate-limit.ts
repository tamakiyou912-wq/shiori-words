import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { hashPrivateValue } from "./security";

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function enforceRateLimit(rawKey: string, limit: number, windowMs = 60_000) {
  const key = hashPrivateValue(rawKey);
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const rows = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql<number>`case when ${rateLimits.windowStart} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql<Date>`case when ${rateLimits.windowStart} < ${cutoff} then ${now} else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  if ((rows[0]?.count ?? 1) > limit) throw new Error("RATE_LIMITED");
}

export async function clearRateLimit(rawKey: string) {
  await getDb().delete(rateLimits).where(eq(rateLimits.key, hashPrivateValue(rawKey)));
}
