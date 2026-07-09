import type { CaseData, Difficulty } from '../types/index.js';

const DIFFICULTY_META: Record<Difficulty, {
  stars: string; risk: string; permission: string; timeMin: number;
}> = {
  easy:   { stars: '★★☆☆☆', risk: 'C', permission: 'Level 1', timeMin: 20 },
  medium: { stars: '★★★☆☆', risk: 'B', permission: 'Level 2', timeMin: 30 },
  hard:   { stars: '★★★★☆', risk: 'A', permission: 'Level 3', timeMin: 45 },
  expert: { stars: '★★★★★', risk: 'S', permission: 'Level 5', timeMin: 60 },
};

type GeneratedPartial = Omit<CaseData, 'id' | 'createdAt' | 'difficulty'> & {
  missionBriefing?: CaseData['missionBriefing'];
  intelligence?: CaseData['intelligence'];
  dossier?: CaseData['dossier'];
  scoringCriteria?: CaseData['scoringCriteria'];
};

/** AI 省略的行政/系统模块由代码补全，保证前端可用且与核心剧情一致 */
export function enrichGeneratedCase(
  partial: GeneratedPartial,
  meta: { difficulty: Difficulty; caseNum: string; aiName: string },
): GeneratedPartial {
  const cfg = DIFFICULTY_META[meta.difficulty];
  const setting = partial.crimeScene?.setting ?? partial.setting ?? '案发现场';
  const deathTime = partial.forensicReport?.deathTime ?? '待确认';
  const deathMethod = partial.deathMethod ?? partial.forensicReport?.causeOfDeath ?? partial.truth?.method ?? '';
  const sceneDescription = partial.sceneDescription ?? partial.crimeScene?.description ?? '';
  const urgency = meta.difficulty === 'hard' || meta.difficulty === 'expert' ? 'critical' : 'high';

  const missionBriefing = partial.missionBriefing ?? {
    directorName: meta.aiName,
    directorTitle: `首席调查AI · ${meta.aiName}`,
    openingLine: `${partial.title}——所有线索都已就位，真相只等你揭开。`,
    script:
      `案件编号 ${meta.caseNum}，保密等级 TOP SECRET。\n` +
      `死者 ${partial.victim.name}，案发地点 ${setting}。\n` +
      `法医推断死亡时间：${deathTime}。\n` +
      `现场已封锁，${partial.suspects.length} 名关联人员待审讯。\n` +
      `预计调查时间 ${cfg.timeMin} 分钟。请立即前往证据分析室。`,
    revealedFacts: [
      { atSecond: 2, label: '案件编号', value: meta.caseNum },
      { atSecond: 5, label: '保密等级', value: 'TOP SECRET' },
      { atSecond: 9, label: '案件等级', value: cfg.stars },
      { atSecond: 13, label: '死亡时间', value: deathTime },
      { atSecond: 17, label: '当前状态', value: 'OPEN · 待侦破' },
      { atSecond: 22, label: '负责特工', value: '你' },
    ],
    missionOrder: '前往证据分析室，立即开始调查。',
    urgencyLevel: urgency,
    durationSeconds: cfg.timeMin >= 45 ? 35 : 25,
  };

  const intelligence = partial.intelligence ?? {
    caseLevel: cfg.stars,
    securityLevel: 'TOP SECRET',
    riskLevel: cfg.risk,
    investigationPermission: cfg.permission,
    caseNumber: meta.caseNum,
    responsibleAI: meta.aiName,
    estimatedTime: cfg.timeMin,
    briefing: `「${partial.title}」已立案。死者 ${partial.victim.name}，${partial.suspects.length} 名嫌疑人各怀鬼胎——找出说谎的人。`,
  };

  const dossier = partial.dossier ?? {
    caseNumber: meta.caseNum,
    coverTitle: `${partial.title} / CASE FILE`,
    dangerLevel: meta.difficulty === 'expert' ? 'EXTREME' : meta.difficulty === 'hard' ? 'HIGH' : 'MODERATE',
    caseStatus: 'OPEN',
    department: '联邦特别调查局·暗罪科',
    filingDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
    summary: sceneDescription.slice(0, 200) || `${partial.victim.name} 于 ${setting} 被发现死亡，案件正在调查中。`,
    confidentialityClause: '本卷宗属绝密级别，未经授权不得复制或传阅。',
    investigationObjectives: [
      '确认死亡时间与死因',
      '梳理嫌疑人行踪与动机',
      '建立完整证据链并锁定真凶',
    ],
    caseBackground: partial.victim.background ?? '',
  };

  const scoringCriteria = partial.scoringCriteria ?? {
    totalMaxPoints: 100,
    timeBonus: `${Math.floor(cfg.timeMin * 0.8)} 分钟内完成可获额外加分`,
    categories: [
      { name: '真凶识别', maxPoints: 40, description: '正确指出真凶', criteria: ['准确指出真凶 +40分'] },
      { name: '手法还原', maxPoints: 25, description: '还原作案手法', criteria: ['完整还原手法 +25分'] },
      { name: '动机分析', maxPoints: 20, description: '正确分析动机', criteria: ['准确说明动机 +20分'] },
      { name: '证据运用', maxPoints: 15, description: '引用关键证据', criteria: ['引用3条以上关键证据 +15分'] },
    ],
    rankThresholds: [
      { minScore: 95, rank: '传奇侦探', badge: '🏆' },
      { minScore: 85, rank: '资深侦探', badge: '🥇' },
      { minScore: 70, rank: '优秀推理', badge: '🥈' },
      { minScore: 55, rank: '合格侦探', badge: '🥉' },
      { minScore: 0, rank: '见习侦探', badge: '📋' },
    ],
  };

  const easterEggs = partial.easterEggs?.length
    ? partial.easterEggs
    : [
        {
          id: 'egg1',
          name: '被忽略的通话',
          description: '死者手机中有一条被删除的通话记录，可能指向关键证人。',
          triggerCondition: '审讯任意嫌疑人时追问案发前联系',
          hiddenIn: '数字取证报告',
          reward: '解锁隐藏对话片段',
          loreHint: '真相往往藏在被刻意抹去的细节里。',
        },
      ];

  const achievements = partial.achievements?.length
    ? partial.achievements
    : [
        {
          id: 'ach1',
          name: '神探直觉',
          description: '正确识别真凶',
          icon: '🔍',
          condition: '真凶判断正确',
          reward: '积分奖励',
          rarity: 'rare' as const,
        },
        {
          id: 'ach2',
          name: '完美推理',
          description: '获得95分以上',
          icon: '🏆',
          condition: '评分 ≥ 95',
          reward: '传奇侦探称号',
          rarity: 'legendary' as const,
        },
      ];

  // 如果 AI 没有生成 motiveEvidenceChain，用现有证据和真相字段推断出最小可用结构
  const truth = partial.truth;
  let motiveEvidenceChain = truth?.motiveEvidenceChain;
  if (!motiveEvidenceChain && truth) {
    const evList = partial.evidence ?? [];
    const chainEvidence = evList.filter((e) => e.canFormEvidenceChain);
    const firstId = chainEvidence[0]?.id ?? evList[0]?.id ?? 'ev1';
    const secondId = chainEvidence[1]?.id ?? evList[1]?.id ?? firstId;
    const thirdId = chainEvidence[2]?.id ?? evList[2]?.id ?? firstId;

    motiveEvidenceChain = {
      motiveCategory: '其他',
      motiveTrigger: `与「${truth.motive}」相关的关键事件迫使凶手在案发当晚采取行动`,
      discoveryClues: [
        {
          evidenceId: firstId,
          description: chainEvidence[0]?.analysisResult ?? `与动机「${truth.motive}」直接相关的物证`,
          howToFind: '调查现场后触发分析',
        },
        {
          evidenceId: secondId,
          description: chainEvidence[1]?.analysisResult ?? '审讯嫌疑人时发现的陈述矛盾',
          howToFind: '审讯真凶时追问不在场证明细节',
        },
      ],
      verificationClues: [
        {
          evidenceId: thirdId,
          description: chainEvidence[2]?.analysisResult ?? '可与案件时间线交叉比对的记录',
          crossRef: '与时间线中案发前关键事件形成比对',
        },
      ],
      corroborationClues: [
        {
          source: 'physical_evidence',
          evidenceId: firstId,
          description: chainEvidence[0]?.significance ?? `物证印证凶手与受害者存在「${truth.motive}」相关纠纷`,
          logicLink: '物证独立证明动机的存在',
        },
        {
          source: 'victim_item',
          evidenceId: secondId,
          description: `受害者遗物中记录了与凶手的「${truth.motive}」矛盾`,
          logicLink: '来自受害者视角的独立记录，与嫌疑人陈述形成闭环',
        },
      ],
    };

    if (truth) {
      (truth as typeof truth & { motiveEvidenceChain: typeof motiveEvidenceChain }).motiveEvidenceChain =
        motiveEvidenceChain;
    }
  }

  return {
    ...partial,
    missionBriefing,
    intelligence,
    dossier,
    scoringCriteria,
    easterEggs,
    achievements,
    setting,
    deathMethod,
    sceneDescription,
    redHerrings: partial.redHerrings ?? [],
    wrongReasonings: partial.wrongReasonings ?? [],
    timeline: partial.timeline ?? [],
    reconstruction: partial.reconstruction ?? [],
    reasoningChain: partial.reasoningChain ?? {
      nodes: [],
      logicRelations: [],
      keyBreakthrough: '',
      finalConclusion: partial.truth?.method ?? '',
    },
    truth: partial.truth
      ? { ...partial.truth, motiveEvidenceChain: partial.truth.motiveEvidenceChain ?? motiveEvidenceChain }
      : partial.truth,
  };
}

export function extractCaseMetaFromPrompt(prompt: string): { caseNum: string; aiName: string } {
  const caseNum = prompt.match(/案件编号：(\S+)/)?.[1] ?? `CASE-${Date.now()}`;
  const aiName = prompt.match(/负责AI：(\S+)/)?.[1] ?? 'NOAH';
  return { caseNum, aiName };
}
