import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { guestCodes } from "@/db/schema";

export async function reserveGuestUse(codeId: string) {
  const rows = await getDb()
    .update(guestCodes)
    .set({ usedUses: sql<number>`${guestCodes.usedUses} + 1` })
    .where(
      and(
        eq(guestCodes.id, codeId),
        eq(guestCodes.enabled, true),
        lt(guestCodes.usedUses, guestCodes.maxUses),
        or(isNull(guestCodes.expiresAt), gt(guestCodes.expiresAt, new Date())),
      ),
    )
    .returning({ maxUses: guestCodes.maxUses, usedUses: guestCodes.usedUses });

  const row = rows[0];
  if (!row) throw new Error("GUEST_USES_EXHAUSTED");
  return { remaining: row.maxUses - row.usedUses };
}

export async function releaseGuestUse(codeId: string) {
  await getDb()
    .update(guestCodes)
    .set({ usedUses: sql<number>`greatest(0, ${guestCodes.usedUses} - 1)` })
    .where(eq(guestCodes.id, codeId));
}
