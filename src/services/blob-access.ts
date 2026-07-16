import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCloudBaseApp } from '../db/cloudbase-client.js';
import { resolveBlobAdapterName } from '../blob/index.js';
import { CORS_HEADERS, jsonResponse } from '../utils/index.js';

const CLOUD_PREFIX = 'case-images';
const TEMP_URL_MAX_AGE = 60 * 60 * 24 * 30;
const CLOUDBASE_HOST_SUFFIX = 'tcb.qcloud.la';

/** 从各类历史 URL 形态中提取对象存储 key，如 cases/{caseId}/victim.png */
export function extractBlobKey(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (/^cases\//.test(trimmed)) {
    return trimmed.split('?')[0].split('#')[0];
  }

  const cloudMatch = trimmed.match(/cloud:\/\/[^/]+\/case-images\/(cases\/[^?#]+)/i);
  if (cloudMatch) return cloudMatch[1];

  for (const prefix of ['/api/blobs/', '/blobs/']) {
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length)).split('?')[0].split('#')[0];
    }
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = decodeURIComponent(parsed.pathname);
    for (const prefix of ['/api/blobs/', '/blobs/', '/case-images/']) {
      const idx = pathname.indexOf(prefix);
      if (idx >= 0) {
        const key = pathname.slice(idx + prefix.length).replace(/^\/+/, '');
        if (key.startsWith('cases/')) return key.split('?')[0];
      }
    }
    const match = pathname.match(/\/cases\/[^?#]+/);
    if (match) return match[0].replace(/^\//, '');
  } catch {
    const match = trimmed.match(/cases\/[^?#]+/);
    if (match) return match[0];
  }

  return null;
}

export function toBlobProxyPath(key: string): string {
  return `/api/blobs/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function isCloudBaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(CLOUDBASE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * 从已存的 CloudBase 直连 URL 重建 fileID。
 * 形如 https://{bucket}.tcb.qcloud.la/{cloudPath}?sign=... →
 * cloud://{envId}.{bucket}/{cloudPath}
 */
function buildFileIdFromStoredUrl(url: string): string | null {
  const env = process.env.TCB_ENV_ID ?? '';
  if (!env) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(CLOUDBASE_HOST_SUFFIX)) return null;
    const bucket = parsed.hostname.slice(0, -(`.${CLOUDBASE_HOST_SUFFIX}`.length));
    const cloudPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    if (!bucket || !cloudPath) return null;
    return `cloud://${env}.${bucket}/${cloudPath}`;
  } catch {
    return null;
  }
}

/** 按 blob key 构造可能的 fileID 候选（兼容有/无 bucket 两种形态） */
function buildFileIdCandidatesForKey(key: string): string[] {
  const env = process.env.TCB_ENV_ID ?? '';
  if (!env) return [];
  const cloudPath = `${CLOUD_PREFIX}/${key}`;
  const ids = [`cloud://${env}/${cloudPath}`];
  const bucket = process.env.TCB_STORAGE_BUCKET?.trim();
  if (bucket) ids.unshift(`cloud://${env}.${bucket}/${cloudPath}`);
  return ids;
}

function isCloudBaseConfigured(): boolean {
  return Boolean(process.env.TCB_ENV_ID && process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY);
}

async function getTempUrlForFileIds(fileIds: string[]): Promise<string | null> {
  if (fileIds.length === 0) return null;
  const app = getCloudBaseApp();
  const unique = [...new Set(fileIds)];
  const res = await app.getTempFileURL({
    fileList: unique.map((fileID) => ({ fileID, maxAge: TEMP_URL_MAX_AGE })),
  });
  const list = res.fileList ?? [];
  for (let i = 0; i < unique.length; i++) {
    const item = list[i];
    if (item?.code === 'SUCCESS' && item.tempFileURL) return item.tempFileURL;
    if (item && item.code !== 'SUCCESS') {
      console.warn('[blob-access] getTempFileURL 失败:', unique[i], item.code);
    }
  }
  return null;
}

async function getCloudBaseTempUrlForKey(key: string, sourceUrl?: string): Promise<string> {
  const candidates: string[] = [];
  if (sourceUrl && isCloudBaseUrl(sourceUrl)) {
    const fromUrl = buildFileIdFromStoredUrl(sourceUrl);
    if (fromUrl) candidates.push(fromUrl);
  }
  candidates.push(...buildFileIdCandidatesForKey(key));

  const tempUrl = await getTempUrlForFileIds(candidates);
  if (!tempUrl) {
    throw new Error('CloudBase 获取图片访问地址失败');
  }
  return tempUrl;
}

/**
 * 批量把已存（可能已过期）的图片地址刷新为新鲜的临时直连地址。
 * 支持 CloudBase 直连、/blobs、/api/blobs、localhost 等历史形态。
 */
export async function refreshCloudBaseUrls(urls: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0 || !isCloudBaseConfigured()) return result;

  const entries: Array<{ url: string; fileIds: string[] }> = [];

  for (const url of unique) {
    const fileIds: string[] = [];
    if (isCloudBaseUrl(url)) {
      const fromUrl = buildFileIdFromStoredUrl(url);
      if (fromUrl) fileIds.push(fromUrl);
    }
    const key = extractBlobKey(url);
    if (key) fileIds.push(...buildFileIdCandidatesForKey(key));
    if (fileIds.length > 0) entries.push({ url, fileIds: [...new Set(fileIds)] });
  }

  if (entries.length === 0) return result;

  try {
    const app = getCloudBaseApp();
    // 按 URL 逐个刷新，避免不同 fileID 候选混在一次请求里对不上结果下标
    for (const { url, fileIds } of entries) {
      try {
        const res = await app.getTempFileURL({
          fileList: fileIds.map((fileID) => ({ fileID, maxAge: TEMP_URL_MAX_AGE })),
        });
        const list = res.fileList ?? [];
        let refreshed = false;
        for (let i = 0; i < fileIds.length; i++) {
          const item = list[i];
          if (item?.code === 'SUCCESS' && item.tempFileURL) {
            result.set(url, item.tempFileURL);
            refreshed = true;
            break;
          }
        }
        if (!refreshed) {
          const codes = list.map((item) => item?.code ?? 'UNKNOWN').join(',');
          console.warn('[blob-access] 刷新图片地址未成功:', url.slice(0, 120), codes);
        }
      } catch (error) {
        console.warn('[blob-access] 刷新单张图片失败:', url.slice(0, 120), (error as Error).message);
      }
    }
  } catch (error) {
    console.warn('[blob-access] 刷新图片地址失败:', (error as Error).message);
  }

  return result;
}

function localBlobRoot(): string {
  return path.resolve(process.env.DB_DATA_DIR ?? './data', 'blobs');
}

function isSafeBlobKey(key: string): boolean {
  return /^cases\/[^/]+\/.+\.(png|jpg|jpeg|webp)$/i.test(key);
}

/** GET /api/blobs/:key → 302 到新鲜 CloudBase 临时链接（或本地文件） */
export async function handleBlobGetRequest(rawKey: string): Promise<Response> {
  const key = decodeURIComponent(rawKey).replace(/^\/+/, '');
  if (!key || !isSafeBlobKey(key)) {
    return jsonResponse({ success: false, error: '无效的图片路径' }, 400);
  }

  const adapter = resolveBlobAdapterName();

  if (adapter === 'cloudbase' || isCloudBaseConfigured()) {
    try {
      const tempUrl = await getCloudBaseTempUrlForKey(key);
      return new Response(null, {
        status: 302,
        headers: {
          Location: tempUrl,
          'Cache-Control': 'private, max-age=3600',
          ...CORS_HEADERS,
        },
      });
    } catch (error) {
      console.error('[blob-access] CloudBase redirect failed:', key, error);
      return jsonResponse({ success: false, error: (error as Error).message || '图片读取失败' }, 404);
    }
  }

  const root = localBlobRoot();
  const filePath = path.join(root, key);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    if (isCloudBaseConfigured()) {
      try {
        const tempUrl = await getCloudBaseTempUrlForKey(key);
        return new Response(null, {
          status: 302,
          headers: {
            Location: tempUrl,
            'Cache-Control': 'private, max-age=3600',
            ...CORS_HEADERS,
          },
        });
      } catch {
        // fall through to 404
      }
    }
    return jsonResponse({ success: false, error: '图片不存在' }, 404);
  }

  const data = await readFile(filePath);
  const contentType = key.endsWith('.png')
    ? 'image/png'
    : key.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';

  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      ...CORS_HEADERS,
    },
  });
}
