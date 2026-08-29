import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { guestCodes, users } from "@/db/schema";
import { releaseGuestUse, reserveGuestUse } from "@/lib/guest-usage";

describe("guest code atomic usage", () => {
  it("never allows concurrent requests past maxUses", async () => {
    const userId = crypto.randomUUID();
    const codeId = crypto.randomUUID();
    await getDb().insert(users).values({ id: userId, username: `owner-${userId}`, passwordHash: "hash" });
    await getDb().insert(guestCodes).values({ id: codeId, code: `SHIORI-${codeId.slice(0, 6).toUpperCase()}`, ownerUserId: userId, maxUses: 20 });
    const attempts = await Promise.allSettled(Array.from({ length: 50 }, () => reserveGuestUse(codeId)));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    const row = await getDb().query.guestCodes.findFirst({ where: eq(guestCodes.id, codeId) });
    expect(row?.usedUses).toBe(20);
  });

  it("reserves one use per AI call and safely restores a failed request", async () => {
    const userId = crypto.randomUUID();
    const codeId = crypto.randomUUID();
    await getDb().insert(users).values({ id: userId, username: `owner-${userId}`, passwordHash: "hash" });
    await getDb().insert(guestCodes).values({ id: codeId, code: `SHIORI-${codeId.slice(0, 6).toUpperCase()}`, ownerUserId: userId, maxUses: 5 });
    expect((await reserveGuestUse(codeId)).remaining).toBe(4);
    expect((await getDb().query.guestCodes.findFirst({ where: eq(guestCodes.id, codeId) }))?.usedUses).toBe(1);
    await releaseGuestUse(codeId);
    await releaseGuestUse(codeId);
    expect((await getDb().query.guestCodes.findFirst({ where: eq(guestCodes.id, codeId) }))?.usedUses).toBe(0);
  });
});
