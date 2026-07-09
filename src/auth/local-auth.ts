import crypto from 'node:crypto';

const SECRET = process.env.AUTH_TOKEN_SECRET ?? 'detective-local-auth-dev-secret-2047';

/** 生成本地认证 Token（HMAC-SHA256，无状态，默认 365 天有效期） */
export function generateLocalToken(userId: string, expiryDays = 365): string {
  const exp = Math.floor(Date.now() / 1000) + expiryDays * 86400;
  const payload = `${Buffer.from(userId).toString('base64url')}.${exp.toString(36)}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `local.${payload}.${sig}`;
}

/** 验证本地 Token，返回 userId；无效或过期返回 null */
export function verifyLocalToken(token: string): { userId: string } | null {
  if (!token.startsWith('local.')) return null;
  const parts = token.slice(6).split('.');
  if (parts.length !== 3) return null;
  const [b64UserId, expB36, sig] = parts;
  const payload = `${b64UserId}.${expB36}`;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const exp = parseInt(expB36, 36);
  if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  try {
    const userId = Buffer.from(b64UserId, 'base64url').toString();
    return { userId };
  } catch {
    return null;
  }
}

/** 使用 scrypt 哈希密码，格式：{saltHex}:{hashHex} */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

/** 验证密码与存储哈希是否匹配 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) { resolve(false); return; }
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else {
        try {
          resolve(crypto.timingSafeEqual(Buffer.from(key.toString('hex')), Buffer.from(hash)));
        } catch {
          resolve(false);
        }
      }
    });
  });
}
