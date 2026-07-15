import type { CaseData } from '../types/index.js';
import { extractBlobKey, toBlobProxyPath } from './blob-access.js';

function resolveImageUrl(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  const key = extractBlobKey(url.trim());
  if (key) return toBlobProxyPath(key);
  return url.trim();
}

/** 将案件内图片地址统一为可经由 /api/blobs 访问的同源代理路径 */
export function withResolvedCaseAssetUrls(caseData: CaseData): CaseData {
  return {
    ...caseData,
    sceneImageUrl: resolveImageUrl(caseData.sceneImageUrl),
    victim: {
      ...caseData.victim,
      imageUrl: resolveImageUrl(caseData.victim.imageUrl),
    },
    suspects: caseData.suspects.map((suspect) => ({
      ...suspect,
      imageUrl: resolveImageUrl(suspect.imageUrl),
    })),
    evidence: caseData.evidence.map((item) => ({
      ...item,
      imageUrl: resolveImageUrl(item.imageUrl),
    })),
  };
}
