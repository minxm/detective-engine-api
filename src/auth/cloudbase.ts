import type { UserRole } from '../types/index.js';
import { ensureUserRecord } from './roles.js';

export interface AuthUser {
  userId: string;
  nickname?: string;
  avatar?: string;
  platform?: string;
  role: UserRole;
}

export function isCloudBaseEnabled(): boolean {
  return Boolean(process.env.TCB_ENV_ID && process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY);
}

function getAuthBaseUrl(): string | null {
  const envId = process.env.TCB_PUBLIC_ENV_ID ?? process.env.TCB_ENV_ID;
  if (!envId) return null;
  return `https://${envId}.api.tcloudbasegateway.com`;
}

export async function verifyCloudBaseToken(accessToken: string): Promise<Omit<AuthUser, 'role'> | null> {
  const baseUrl = getAuthBaseUrl();
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl}/auth/v1/user/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) return null;
    const profile = (await res.json()) as {
      user_id?: string;
      sub?: string;
      username?: string;
      nickName?: string;
      name?: string;
      avatarUrl?: string;
      avatar?: string;
      provider_type?: string;
    };

    const userId = profile.user_id || profile.sub;
    if (!userId) return null;

    return {
      userId,
      nickname: profile.nickName || profile.username || profile.name || undefined,
      avatar: profile.avatarUrl || profile.avatar || undefined,
      platform: profile.provider_type,
    };
  } catch (error) {
    console.warn('[Auth] CloudBase token verify failed:', (error as Error).message);
    return null;
  }
}

export async function resolveAuthUser(
  headers: Record<string, string | undefined>
): Promise<AuthUser | null> {
  const authHeader = headers.authorization ?? headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token || token === 'anonymous') return null;

  if (token.startsWith('guest_')) {
    return {
      userId: token,
      nickname: `侦探${token.slice(-4)}`,
      role: 'user',
    };
  }

  const cloudUser = await verifyCloudBaseToken(token);
  if (cloudUser) {
    const record = await ensureUserRecord(cloudUser);
    return {
      ...cloudUser,
      nickname: record.nickname,
      avatar: record.avatar,
      role: record.role,
    };
  }

  const record = await ensureUserRecord({ userId: token });
  return {
    userId: token,
    nickname: record.nickname,
    avatar: record.avatar,
    role: record.role,
  };
}

export function getAuthConfig() {
  return {
    enabled: isCloudBaseEnabled(),
    envId: process.env.TCB_PUBLIC_ENV_ID ?? process.env.TCB_ENV_ID ?? '',
    region: process.env.TCB_REGION ?? 'ap-shanghai',
  };
}
