import { getDatabase } from '../db/index.js';
import { generateId, now } from '../utils/index.js';
import { hashPassword } from './local-auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function isEmailAccount(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

function validateAccount(account: string): string {
  const trimmed = account.trim();
  if (!trimmed) throw new Error('请输入用户名或邮箱');

  if (isEmailAccount(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (!USERNAME_RE.test(trimmed)) {
    throw new Error('用户名格式不正确，需以字母或数字开头，仅可包含字母、数字、._-');
  }
  if (/^\d+$/.test(trimmed)) {
    throw new Error('用户名不能为纯数字');
  }

  return trimmed.toLowerCase();
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 32) {
    throw new Error('密码长度需为 8–32 位');
  }
  if (/^[^a-zA-Z0-9]/.test(password)) {
    throw new Error('密码不能以特殊字符开头');
  }

  let types = 0;
  if (/[a-z]/.test(password)) types++;
  if (/[A-Z]/.test(password)) types++;
  if (/[0-9]/.test(password)) types++;
  if (/[()!@#$%^&*|?><_-]/.test(password)) types++;
  if (types < 3) {
    throw new Error('密码需包含大小写字母、数字、特殊字符中的至少三项');
  }
}

/** 将用户注册到本地数据库（MongoDB），不创建 CloudBase 用户 */
export async function registerLocalUser(account: string, password: string): Promise<{ uid: string; name: string }> {
  const username = validateAccount(account);
  validatePassword(password);

  const db = getDatabase();

  const existing = await db.users.findByUsername(username);
  if (existing) {
    throw new Error('该用户名或邮箱已被注册');
  }

  const passwordHash = await hashPassword(password);
  const uid = generateId();
  const displayName = account.trim();
  const ts = now();

  await db.users.upsert({
    _id: uid,
    username,
    passwordHash,
    nickname: displayName,
    role: 'user',
    score: 0,
    createdAt: ts,
    updatedAt: ts,
  });

  return { uid, name: displayName };
}

/** 保留旧名称兼容（现在使用本地注册） */
export const registerCloudBaseUser = registerLocalUser;
