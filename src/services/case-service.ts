import type { CaseData, CaseRecord, InventoryRecord, Suspect, Evidence } from '../types/index.js';
import { generateId, now } from '../utils/index.js';
// ─── ID 规范化辅助函数 ────────────────────────────────────────────────────────

function normalizeSuspectId(id: unknown, index: number): string {
  if (id === undefined || id === null || id === '') return `s${index + 1}`;
  const str = String(id).trim();
  if (/^s\d+$/i.test(str)) return str.toLowerCase();
  if (/^\d+$/.test(str)) return `s${str}`;
  return str;
}

function normalizeEvidenceId(id: unknown, index: number): string {
  if (id === undefined || id === null || id === '') return `e${index + 1}`;
  const str = String(id).trim();
  if (/^e\d+$/i.test(str)) return str.toLowerCase();
  if (/^\d+$/.test(str)) return `e${str}`;
  return str;
}

function normalizeRelatedSuspects(related: unknown, suspects: Suspect[]): string[] {
  if (!Array.isArray(related)) return [];
  return related.map((ref) => {
    const str = String(ref).trim();
    const idx = suspects.findIndex((s, i) => {
      const sid = normalizeSuspectId(s.id, i);
      return sid === str || String(s.id) === str || s.name === str;
    });
    if (idx >= 0) return normalizeSuspectId(suspects[idx].id, idx);
    if (/^\d+$/.test(str)) return `s${str}`;
    return str;
  });
}

// ─── 嫌疑人心理档案默认值（AI未生成时的安全填充）────────────────────────────
function ensurePsychProfile(suspect: Suspect, index: number): Suspect {
  if (suspect.psychProfile) return suspect;
  const isGuilty = suspect.isGuilty;
  return {
    ...suspect,
    psychProfile: {
      mentalState: isGuilty ? '表面镇定，内心紧张' : '配合调查，略感不安',
      stressLevel: isGuilty ? 75 : 35,
      lyingProbability: isGuilty ? 80 : 20,
      confidenceLevel: isGuilty ? 40 : 70,
      heartbeatBPM: isGuilty ? 115 : 88,
      responseStyle: isGuilty ? '绕弯，转移话题' : '直接配合',
      speakingSpeed: isGuilty ? '急促' : '正常',
      isEvasive: isGuilty,
      microExpressions: isGuilty
        ? ['目光不自然偏移', '回答关键问题时有停顿']
        : ['表情自然', '眼神对视稳定'],
      interrogationNotes: `第${index + 1}号嫌疑人，需进一步审讯核实。`,
    },
    interrogationScript: suspect.interrogationScript ?? [],
  };
}

// ─── 证据字段默认值填充 ────────────────────────────────────────────────────────
function ensureEvidenceFields(evidence: Evidence): Evidence {
  return {
    ...evidence,
    credibility: evidence.credibility ?? 75,
    analysisResult: evidence.analysisResult ?? evidence.significance ?? '待进一步分析',
    canFormEvidenceChain: evidence.canFormEvidenceChain ?? false,
    category: evidence.category ?? 'physical',
    discoveredAt: evidence.discoveredAt ?? '待确认',
  };
}

// ─── 主规范化函数 ──────────────────────────────────────────────────────────────
export function normalizeCaseData(caseData: CaseData): CaseData {
  const suspects = caseData.suspects.map((s, i) =>
    ensurePsychProfile({ ...s, id: normalizeSuspectId(s.id, i) }, i)
  );

  const evidence = caseData.evidence.map((e, i) =>
    ensureEvidenceFields({
      ...e,
      id: normalizeEvidenceId(e.id, i),
      relatedSuspects: normalizeRelatedSuspects(e.relatedSuspects, suspects),
    })
  );

  // 规范化推理链节点中对证据/嫌疑人的引用
  const reasoningChain = caseData.reasoningChain
    ? {
        ...caseData.reasoningChain,
        nodes: caseData.reasoningChain.nodes?.map(node => ({
          ...node,
          relatedEvidence: node.relatedEvidence?.map(ref =>
            normalizeEvidenceId(ref, 0)
          ) ?? [],
          relatedSuspects: node.relatedSuspects?.map(ref =>
            normalizeRelatedSuspects([ref], suspects)[0] ?? ref
          ) ?? [],
        })) ?? [],
      }
    : undefined;

  // 同步 legacy 字段（保持 API 兼容）
  const setting = caseData.setting || caseData.crimeScene?.setting || '';
  const deathMethod = caseData.deathMethod
    || caseData.forensicReport?.causeOfDeath
    || caseData.truth?.method
    || '';
  const sceneDescription = caseData.sceneDescription
    || caseData.crimeScene?.description
    || '';

  return {
    ...caseData,
    suspects,
    evidence,
    ...(reasoningChain ? { reasoningChain } : {}),
    setting,
    deathMethod,
    sceneDescription,
  };
}

// ─── CaseRecord ↔ CaseData 转换 ───────────────────────────────────────────────

export function caseRecordToCaseData(record: CaseRecord): CaseData {
  const scene = record.scene ?? {
    setting: '',
    deathMethod: '',
    sceneDescription: '',
    sceneImageUrl: undefined,
  };
  return normalizeCaseData({
    id: record._id,
    title: record.title ?? '未命名案件',
    difficulty: record.difficulty,
    setting: scene.setting,
    victim: record.victim,
    deathMethod: scene.deathMethod,
    sceneDescription: scene.sceneDescription,
    sceneImageUrl: scene.sceneImageUrl,
    suspects: record.suspects ?? [],
    evidence: record.evidence ?? [],
    timeline: record.timeline ?? [],
    truth: record.answer,
    redHerrings: record.redHerrings,
    createdAt: record.createdAt,
    // 新模块字段（若存在则复原）
    missionBriefing: record.missionBriefing!,
    intelligence: record.intelligence!,
    dossier: record.dossier!,
    forensicReport: record.forensicReport!,
    crimeScene: record.crimeScene!,
    reasoningChain: record.reasoningChain!,
    reconstruction: record.reconstruction!,
    scoringCriteria: record.scoringCriteria!,
    wrongReasonings: record.wrongReasonings!,
    easterEggs: record.easterEggs!,
    achievements: record.achievements!,
  } as CaseData);
}

export function caseDataToRecord(caseData: CaseData): CaseRecord {
  const normalized = normalizeCaseData(caseData);
  return {
    _id: normalized.id,
    difficulty: normalized.difficulty,
    status: 'ready',
    title: normalized.title,
    victim: normalized.victim,
    suspects: normalized.suspects,
    scene: {
      setting: normalized.setting,
      deathMethod: normalized.deathMethod,
      sceneDescription: normalized.sceneDescription,
      sceneImageUrl: normalized.sceneImageUrl,
    },
    evidence: normalized.evidence,
    timeline: normalized.timeline,
    answer: normalized.truth,
    redHerrings: normalized.redHerrings,
    createdAt: normalized.createdAt,
    // 新模块字段
    missionBriefing: normalized.missionBriefing,
    intelligence: normalized.intelligence,
    dossier: normalized.dossier,
    forensicReport: normalized.forensicReport,
    crimeScene: normalized.crimeScene,
    reasoningChain: normalized.reasoningChain,
    reconstruction: normalized.reconstruction,
    scoringCriteria: normalized.scoringCriteria,
    wrongReasonings: normalized.wrongReasonings,
    easterEggs: normalized.easterEggs,
    achievements: normalized.achievements,
  };
}

export function caseDataToInventory(caseData: CaseData): InventoryRecord {
  const normalized = normalizeCaseData(caseData);
  return {
    _id: generateId(),
    difficulty: normalized.difficulty,
    caseId: normalized.id,
    caseData: normalized,
    status: 'available',
    createdAt: now(),
  };
}

export async function updateLeaderboard(userId: string, displayName: string, score: number) {
  const { getDatabase } = await import('../db/index.js');
  const { withRetry } = await import('../utils/retry.js');
  const db = getDatabase();
  const existing = await withRetry(() => db.leaderboard.findByUser(userId), { retries: 3, delayMs: 500 });
  const casesCompleted = (existing?.casesCompleted ?? 0) + 1;
  const totalScore = (existing?.totalScore ?? 0) + score;
  const avgScore = Math.round(totalScore / casesCompleted);
  const perfectSolves = (existing?.perfectSolves ?? 0) + (score >= 95 ? 1 : 0);

  await withRetry(
    () =>
      db.leaderboard.upsert({
        _id: existing?._id ?? generateId(),
        userId,
        displayName,
        avatarUrl: existing?.avatarUrl,
        totalScore,
        casesCompleted,
        avgScore,
        perfectSolves,
        updatedAt: now(),
      }),
    { retries: 3, delayMs: 500 },
  );
}
