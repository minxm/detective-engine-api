import type { CaseData } from '../types/index.js';
import { extractBlobKey, refreshCloudBaseUrls, toBlobProxyPath } from './blob-access.js';

/**
 * 返回案件数据前，把其中所有图片地址刷新为新鲜的临时直连地址；
 * 刷新失败但仍能解析出 blob key 时，回退为 /api/blobs 同源代理路径，
 * 避免库存/历史案件因临时链接过期或旧代理路径导致图片加载失败。
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
