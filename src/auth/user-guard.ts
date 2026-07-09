/** 已登录用户 ID；未登录返回 undefined */
export function requireAuthUserId(userId?: string | null): string | undefined {
  return userId || undefined;
}
