import { getCloudBaseApp } from '../db/cloudbase-client.js';

const TEMP_URL_MAX_AGE = 60 * 60 * 24 * 30;
const CLOUDBASE_HOST_SUFFIX = 'tcb.qcloud.la';

/** 判断是否为 CloudBase 云存储直连地址 */
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

/**
 * 批量把已存（可能已过期）的 CloudBase 图片地址刷新为新鲜的临时直连地址。
 * 非 CloudBase 地址（如本地开发 /blobs、localhost）原样返回。
 */
export async function refreshCloudBaseUrls(urls: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(urls.filter((u) => u && isCloudBaseUrl(u)))];
  if (unique.length === 0) return result;

  const fileIdByUrl = new Map<string, string>();
  for (const url of unique) {
    const fileId = buildFileIdFromStoredUrl(url);
    if (fileId) fileIdByUrl.set(url, fileId);
  }
  if (fileIdByUrl.size === 0) return result;

  try {
    const app = getCloudBaseApp();
    const entries = [...fileIdByUrl.entries()];
    const res = await app.getTempFileURL({
      fileList: entries.map(([, fileId]) => ({ fileID: fileId, maxAge: TEMP_URL_MAX_AGE })),
    });
    const list = res.fileList ?? [];
    entries.forEach(([url], index) => {
      const item = list[index];
      if (item?.code === 'SUCCESS' && item.tempFileURL) {
        result.set(url, item.tempFileURL);
      }
    });
  } catch (error) {
    console.warn('[blob-access] 刷新图片地址失败:', (error as Error).message);
  }

  return result;
}
