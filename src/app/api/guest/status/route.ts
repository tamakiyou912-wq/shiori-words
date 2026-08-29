import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { guestCodes } from "@/db/schema";
import { getPrincipal } from "@/lib/principal";

export async function GET() {
  const principal = await getPrincipal();
  if (!principal || principal.kind !== "guest") return Response.json({ guest: null });
  const row = await getDb().query.guestCodes.findFirst({
    columns: { code: true, maxUses: true, usedUses: true, expiresAt: true, enabled: true },
    where: eq(guestCodes.id, principal.guestCodeId),
  });
  return Response.json({ guest: row ? { ...row, remainingUses: Math.max(0, row.maxUses - row.usedUses) } : null });
}
