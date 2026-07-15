import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCloudBaseApp } from '../db/cloudbase-client.js';
import { resolveBlobAdapterName } from '../blob/index.js';
import { CORS_HEADERS, jsonResponse } from '../utils/index.js';

const CLOUD_PREFIX = 'case-images';
const TEMP_URL_MAX_AGE = 60 * 60 * 24 * 30;

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

function isCloudBaseConfigured(): boolean {
  return Boolean(process.env.TCB_ENV_ID && process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY);
}

async function getCloudBaseTempUrlForKey(key: string): Promise<string> {
  const app = getCloudBaseApp();
  const env = process.env.TCB_ENV_ID ?? '';
  const cloudPath = `${CLOUD_PREFIX}/${key}`;
  const fileID = `cloud://${env}/${cloudPath}`;
  const urlRes = await app.getTempFileURL({
    fileList: [{ fileID, maxAge: TEMP_URL_MAX_AGE }],
  });
  const item = urlRes.fileList?.[0];
  const tempUrl = item?.tempFileURL;
  if (!tempUrl || item?.code !== 'SUCCESS') {
    throw new Error(item?.code ? `CloudBase 获取图片地址失败：${item.code}` : 'CloudBase 获取图片访问地址失败');
  }
  return tempUrl;
}

function localBlobRoot(): string {
  return path.resolve(process.env.DB_DATA_DIR ?? './data', 'blobs');
}

function isSafeBlobKey(key: string): boolean {
  return /^cases\/[^/]+\/.+\.(png|jpg|jpeg|webp)$/i.test(key);
}

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

export async function resolveBlobAccessUrl(url?: string): Promise<string | undefined> {
  if (!url?.trim()) return undefined;
  const key = extractBlobKey(url.trim());
  if (key) return toBlobProxyPath(key);
  return url.trim();
}
