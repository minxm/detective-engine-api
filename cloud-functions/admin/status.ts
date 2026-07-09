import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { isAdminRole } from '../../src/auth/roles.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';

export async function handleAdminStatus(ctx: CloudContext): Promise<Response> {
  const authUser = await resolveAuthUser(ctx.headers);
  const admin = isAdminRole(authUser?.role);
  return jsonResponse({ success: true, isAdmin: admin, role: authUser?.role ?? 'user' });
}
