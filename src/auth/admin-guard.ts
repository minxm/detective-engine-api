import { isAdminRole } from './roles.js';
import { resolveAuthUser, type AuthUser } from './cloudbase.js';

export async function requireAdminUser(
  headers: Record<string, string | undefined>
): Promise<AuthUser | null> {
  const user = await resolveAuthUser(headers);
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}
