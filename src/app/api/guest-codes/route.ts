import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { apiCredentials, guestCodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { ensureSiteSettings } from "@/lib/site";

const createSchema = z.object({
  name: z.string().trim().max(50).optional(),
  maxUses: z.number().int().min(1).max(10000).default(20),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `SHIORI-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  const codes = await getDb().query.guestCodes.findMany({
    where: eq(guestCodes.ownerUserId, user.id),
    orderBy: [desc(guestCodes.createdAt)],
  });
  return Response.json({ codes });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录。", 401);
  if (!(await ensureSiteSettings()).allowGuestCodes) return jsonError("站点当前已关闭体验码功能。", 403);
  const credential = await getDb().query.apiCredentials.findFirst({ columns: { id: true }, where: eq(apiCredentials.userId, user.id) });
  if (!credential) return jsonError("请先配置并保存自己的 API。", 400);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请检查名称、次数和有效期。");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = createCode();
    try {
      const [created] = await getDb().insert(guestCodes).values({
        id: crypto.randomUUID(),
        code,
        ownerUserId: user.id,
        name: parsed.data.name || null,
        maxUses: parsed.data.maxUses,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      }).returning();
      return Response.json({ code: created }, { status: 201 });
    } catch {
      if (attempt === 3) return jsonError("暂时无法创建体验码，请重试。", 500);
    }
  }
  return jsonError("暂时无法创建体验码，请重试。", 500);
}
