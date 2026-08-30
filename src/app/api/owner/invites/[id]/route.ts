import { z } from "zod";
import { getCurrentOwner } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { deleteRegistrationInvite, updateRegistrationInvite } from "@/lib/owner";

const schema = z.object({ enabled: z.boolean().optional(), name: z.string().trim().max(50).nullable().optional() }).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("邀请码设置无效。");
  const { id } = await context.params;
  const invite = await updateRegistrationInvite(owner.id, id, parsed.data);
  if (!invite) return jsonError("注册邀请码不存在。", 404);
  return Response.json({ invite: { ...invite, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt?.toISOString() ?? null } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const { id } = await context.params;
  if (!(await deleteRegistrationInvite(owner.id, id))) return jsonError("注册邀请码不存在。", 404);
  return Response.json({ ok: true });
}
