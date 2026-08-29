import { revokeCurrentSession } from "@/lib/auth";

export async function POST() {
  await revokeCurrentSession();
  return Response.json({ ok: true });
}
