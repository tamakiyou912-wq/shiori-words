import { z } from "zod";
import { getCurrentOwner } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { deleteUser, revokeUserSessions, setUserStatus } from "@/lib/owner";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("revokeSessions") }),
]);
const deleteSchema = z.object({ confirmationUsername: z.string().min(1).max(32) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("用户操作无效。");
  const { id } = await context.params;
  if (parsed.data.action === "revokeSessions") {
    if (!(await revokeUserSessions(id))) return jsonError("普通用户不存在。", 404);
  } else {
    const status = parsed.data.action === "suspend" ? "SUSPENDED" : "ACTIVE";
    if (!(await setUserStatus(id, status))) return jsonError("普通用户不存在。", 404);
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("请输入用户名确认删除。");
  const { id } = await context.params;
  if (!(await deleteUser(id, parsed.data.confirmationUsername))) return jsonError("用户名不匹配，或普通用户不存在。", 400);
  return Response.json({ ok: true });
}
