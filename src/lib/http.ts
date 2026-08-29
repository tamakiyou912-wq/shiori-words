import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, [string, number]> = {
    RATE_LIMITED: ["请求过于频繁，请稍后再试。", 429],
    GUEST_USES_EXHAUSTED: ["体验次数已用完。", 402],
    ENCRYPTION_KEY_MISSING: ["服务器尚未配置 ENCRYPTION_KEY。", 503],
    ENCRYPTION_KEY_INVALID: ["服务器的 ENCRYPTION_KEY 配置无效。", 503],
    DATABASE_URL_POSTGRES_REQUIRED: ["生产数据库尚未配置。", 503],
  };
  const [message, status] = messages[code] ?? ["服务暂时不可用，请稍后再试。", 500];
  return { message, status, code };
}
