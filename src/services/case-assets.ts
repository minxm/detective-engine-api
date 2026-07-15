import type { CaseData } from '../types/index.js';
import { refreshCloudBaseUrls } from './blob-access.js';

/**
 * 返回案件数据前，把其中所有 CloudBase 图片地址刷新为新鲜的临时直连地址，
 * 避免库存/历史案件因临时链接过期导致图片加载失败（403）。
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
  if (fresh.size === 0) return caseData;

  const pick = (url?: string) => (url && fresh.get(url)) || url;

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
