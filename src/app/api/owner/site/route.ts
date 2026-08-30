import { z } from "zod";
import { getCurrentOwner } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { updateSiteSettings } from "@/lib/owner";

const schema = z.object({
  registrationMode: z.enum(["open", "invite", "closed"]).optional(),
  maxUsers: z.number().int().min(1).max(10000).optional(),
  siteName: z.string().trim().min(1).max(80).optional(),
  allowGuestCodes: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request) {
  const owner = await getCurrentOwner();
  if (!owner) return jsonError("仅站点 Owner 可以执行此操作。", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("站点设置无效。");
  const settings = await updateSiteSettings(parsed.data);
  return Response.json({ settings });
}
