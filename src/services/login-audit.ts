import { getDatabase } from '../db/index.js';
import { generateId, now } from '../utils/index.js';

const RETENTION_DAYS = 14;
const TZ = 'Asia/Shanghai';

export type DailyActivityRow = {
  date: string;
  loginCount: number;
  onlineCount: number;
};

function dateKey(ts = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function startOfTodayMs(): number {
  const key = dateKey();
  return new Date(`${key}T00:00:00+08:00`).getTime();
}

function recentDateKeys(days = RETENTION_DAYS): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d.getTime()));
  }
  return keys;
}

async function pruneOldRecords(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  void getDatabase()
    .loginAudits.deleteOlderThan(cutoff)
    .catch((err) => console.warn('[LoginAudit] 清理过期记录失败:', (err as Error).message));
}

/** 登录/注册审计（列表展示） */
export async function recordLoginAudit(params: {
  userId: string;
  username?: string;
  nickname: string;
  source: 'login' | 'register';
}): Promise<void> {
  if (!params.userId) return;
  try {
    const db = getDatabase();
    await db.loginAudits.add({
      _id: generateId(),
      userId: params.userId,
      username: params.username,
      nickname: params.nickname,
      source: params.source,
      createdAt: now(),
    });
    void pruneOldRecords();
  } catch (err) {
    console.warn('[LoginAudit] 写入失败:', (err as Error).message);
  }
}

/** 当日首次在线（去重，用于每日在线统计） */
export async function recordOnlinePresence(
  userId: string,
  nickname?: string,
): Promise<void> {
  if (!userId) return;
  try {
    const db = getDatabase();
    const exists = await db.loginAudits.hasToday(userId, 'online', startOfTodayMs());
    if (exists) return;
    await db.loginAudits.add({
      _id: generateId(),
      userId,
      nickname: nickname ?? userId,
      source: 'online',
      createdAt: now(),
    });
    void pruneOldRecords();
  } catch (err) {
    console.warn('[LoginAudit] 在线记录失败:', (err as Error).message);
  }
}

/** 近 N 日登录/在线人数（从 login_audits 聚合） */
export async function getDailyActivityStats(days = RETENTION_DAYS): Promise<DailyActivityRow[]> {
  const db = getDatabase();
  const keys = recentDateKeys(days);
  const since = Date.now() - days * 86_400_000;
  const records = await db.loginAudits.listSince(since);

  const buckets = new Map(keys.map((key) => [key, { logins: new Set<string>(), online: new Set<string>() }]));

  for (const record of records) {
    const key = dateKey(record.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (record.source === 'online') {
      bucket.online.add(record.userId);
    } else if (record.source === 'login' || record.source === 'register') {
      bucket.logins.add(record.userId);
    }
  }

  return keys.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      date: key,
      loginCount: bucket.logins.size,
      onlineCount: bucket.online.size,
    };
  });
}
