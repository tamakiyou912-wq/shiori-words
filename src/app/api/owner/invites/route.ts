import { z } from "zod";
import { getCurrentOwner } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { createRegistrationInvite } from "@/lib/owner";

const schema = z.object({
  name: z.string().trim().max(50).optional(),
  maxUses: z.number().int().min(1).max(10000),
  expiresAt: z.iso.datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请检查邀请码名称、人数和有效期。");
  const invite = await createRegistrationInvite(owner.id, {
    name: parsed.data.name,
    maxUses: parsed.data.maxUses,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });
  return Response.json({ invite: { ...invite, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt?.toISOString() ?? null } }, { status: 201 });
}
