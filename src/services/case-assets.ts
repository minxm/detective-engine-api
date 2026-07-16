import type { CaseData } from '../types/index.js';
import {
  extractBlobKey,
  isUsableDirectImageUrl,
  refreshCloudBaseUrls,
  toBlobProxyPath,
} from './blob-access.js';

/**
 * 返回案件数据前，把其中所有图片地址刷新为新鲜的临时直连地址。
 *
 * 刷新失败时的策略：
 * - 已是可直连的 http(s)（非 localhost）→ 原样保留，避免把仍可用的库内 URL 改坏
 * - localhost / /blobs / cloud:// 等无法给浏览器直接用的形态 → 回退 /api/blobs 同源代理
 */
export async function withFreshCaseImageUrls(caseData: CaseData): Promise<CaseData> {
  const urls: string[] = [];
  if (caseData.sceneImageUrl) urls.push(caseData.sceneImageUrl);
  if (caseData.victim?.imageUrl) urls.push(caseData.victim.imageUrl);
  for (const suspect of caseData.suspects ?? []) {
    if (suspect.imageUrl) urls.push(suspect.imageUrl);
  }
  for (const item of caseData.evidence ?? []) {
    if (item.imageUrl) urls.push(item.imageUrl);
  }

  if (urls.length === 0) return caseData;

  const fresh = await refreshCloudBaseUrls(urls);

  const pick = (url?: string) => {
    if (!url) return url;
    const refreshed = fresh.get(url);
    if (refreshed) return refreshed;
    if (isUsableDirectImageUrl(url)) return url;
    const key = extractBlobKey(url);
    if (key) return toBlobProxyPath(key);
    return url;
  };

  return {
    ...caseData,
    sceneImageUrl: pick(caseData.sceneImageUrl),
    victim: {
      ...caseData.victim,
      imageUrl: pick(caseData.victim?.imageUrl),
    },
    suspects: (caseData.suspects ?? []).map((suspect) => ({
      ...suspect,
      imageUrl: pick(suspect.imageUrl),
    })),
    evidence: (caseData.evidence ?? []).map((item) => ({
      ...item,
      imageUrl: pick(item.imageUrl),
    })),
  };
}
