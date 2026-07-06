import OpenAI from 'openai';
import { AI_CONFIG, getAiConfigError, generateId, now } from '../utils/index.js';
import { getDatabase } from '../db/index.js';
import type { CaseData, CaseEvaluation, Difficulty } from '../types/index.js';
import { createFallbackCase } from './fallback-case.js';
import { normalizeCaseData } from '../services/case-service.js';

const client = new OpenAI({
  apiKey: AI_CONFIG.apiKey,
  baseURL: AI_CONFIG.baseURL,
  timeout: 180000,
  maxRetries: 0,
});

function extractJson(content: string): string {
  const withoutThink = content.replace(/[\s\S]*?<\/think>/g, '').trim();
  const block = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) return block[1].trim();
  const start = withoutThink.indexOf('{');
  const end = withoutThink.lastIndexOf('}');
  if (start >= 0 && end > start) return withoutThink.slice(start, end + 1);
  return withoutThink;
}

async function logAiCall(params: {
  type: 'case' | 'interrogate' | 'evaluate' | 'image';
  model: string;
  userId?: string;
  caseId?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  durationMs: number;
}) {
  const db = getDatabase();
  await db.aiLogs.add({
    _id: generateId(),
    type: params.type,
    userId: params.userId,
    caseId: params.caseId,
    model: params.model,
    promptTokens: params.usage?.prompt_tokens ?? 0,
    completionTokens: params.usage?.completion_tokens ?? 0,
    totalTokens: params.usage?.total_tokens ?? 0,
    durationMs: params.durationMs,
    createdAt: now(),
  });
}

// ─── 难度配置映射 ────────────────────────────────────────────────────────────
const DIFFICULTY_CONFIG: Record<Difficulty, {
  stars: string; risk: string; permission: string;
  suspectCount: number; evidenceCount: number; timeMin: number;
}> = {
  easy:   { stars: '★★☆☆☆', risk: 'C', permission: 'Level 1', suspectCount: 2, evidenceCount: 4, timeMin: 20 },
  medium: { stars: '★★★☆☆', risk: 'B', permission: 'Level 2', suspectCount: 3, evidenceCount: 5, timeMin: 30 },
  hard:   { stars: '★★★★☆', risk: 'A', permission: 'Level 3', suspectCount: 4, evidenceCount: 6, timeMin: 45 },
  expert: { stars: '★★★★★', risk: 'S', permission: 'Level 5', suspectCount: 5, evidenceCount: 8, timeMin: 60 },
};

// ─── 主案件世界生成提示词 ────────────────────────────────────────────────────
function buildCaseWorldPrompt(difficulty: Difficulty): string {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const caseYear = new Date().getFullYear();
  const caseNum = `CASE-${caseYear}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const aiNames = ['NOAH', 'ATLAS', 'CIPHER', 'LYRA', 'ORION'];
  const aiName = aiNames[Math.floor(Math.random() * aiNames.length)];

  return `你是「案件世界生成器」——一个专为推理游戏创造完整叙事宇宙的AI。
你的任务不是简单生成案件，而是生成一个拥有电影质感的、可交互的、内部逻辑自洽的「案件世界」。
难度：${difficulty}（${cfg.stars}）
嫌疑人数量：${cfg.suspectCount}，其中仅1人 isGuilty:true
案件编号：${caseNum}
负责AI：${aiName}

请严格按照以下JSON结构输出，字段一个不能少。仅输出JSON，不要任何其他文字。

{
  "title": "案件标题（悬疑感强，5-10字）",

  "missionBriefing": {
    "directorName": "${aiName}",
    "directorTitle": "首席调查AI · ${aiName}",
    "openingLine": "一句开场白，冷静且充满压迫感，奠定整个案件的基调（15-20字）",
    "script": "完整简报文本，80-150字，第一人称AI局长口吻，须包含：案件编号、保密等级、死亡时间窗口、案发地点概述、当前调查状态、最后一句指令玩家开始行动。语气：冷静、专业、带压迫感，类似电影开场旁白。",
    "revealedFacts": [
      { "atSecond": 2,  "label": "案件编号",  "value": "${caseNum}" },
      { "atSecond": 5,  "label": "保密等级",  "value": "TOP SECRET" },
      { "atSecond": 9,  "label": "案件等级",  "value": "${cfg.stars}" },
      { "atSecond": 13, "label": "死亡时间",  "value": "根据法医报告填写具体时间窗口" },
      { "atSecond": 17, "label": "当前状态",  "value": "OPEN · 待侦破" },
      { "atSecond": 22, "label": "负责特工",  "value": "你" }
    ],
    "missionOrder": "行动指令，1句话，命令语气，指引玩家点击开始调查（如：前往证据分析室，立即开始。）",
    "urgencyLevel": "high | critical（与难度匹配，easy/medium=high，hard/expert=critical）",
    "durationSeconds": ${cfg.timeMin >= 45 ? 35 : 25}
  },

  "intelligence": {
    "caseLevel": "${cfg.stars}",
    "securityLevel": "TOP SECRET",
    "riskLevel": "${cfg.risk}",
    "investigationPermission": "${cfg.permission}",
    "caseNumber": "${caseNum}",
    "responsibleAI": "${aiName}",
    "estimatedTime": ${cfg.timeMin},
    "briefing": "给玩家的任务简报，1-2句，有代入感，像特工接受任务"
  },

  "dossier": {
    "caseNumber": "${caseNum}",
    "coverTitle": "卷宗封面标题，FBI档案风格",
    "dangerLevel": "EXTREME | HIGH | MODERATE 之一，与难度匹配",
    "caseStatus": "OPEN",
    "department": "调查部门名称（如：联邦特别调查局·暗罪科）",
    "filingDate": "YYYY-MM-DD HH:mm（合理的立案时间）",
    "summary": "案件摘要，3-5句，如FBI正式报告语气",
    "confidentialityClause": "保密协议条款（1-2句，正式法律语气）",
    "investigationObjectives": ["目标1", "目标2", "目标3（共3-4条）"],
    "caseBackground": "案件背景说明（4-6句，交代社会/人际背景）"
  },

  "forensicReport": {
    "reportId": "FR-${caseNum}-001",
    "examinedBy": "法医姓名（英文或中文）",
    "examinationDate": "YYYY-MM-DD",
    "deathTime": "死亡时间区间（如：23:00-01:00之间）",
    "bodyTemperature": "尸温（如：32.4°C，低于正常体温37°C）",
    "lividityMarks": "尸斑描述（颜色、位置、是否固定，推断翻动）",
    "rigorMortis": "尸僵描述（程度：全身/局部，阶段：发展/完全/解除）",
    "bloodAnalysis": "血液分析（血型、凝血状态、有无异常成分）",
    "dna": "DNA鉴定结论（样本来源、匹配结果）",
    "wounds": [
      {
        "location": "伤口位置",
        "type": "伤口类型（刺伤/钝伤/勒痕/枪伤等）",
        "description": "详细描述",
        "weaponType": "推断凶器类型"
      }
    ],
    "toxicology": "毒物筛查结果（阳性/阴性，具体毒物名称）",
    "pathology": "病理分析（器官损伤、死亡机制）",
    "stomachContents": "胃内容物（最后进食内容、时间推算）",
    "causeOfDeath": "正式死因（官方一句话结论）",
    "forensicConclusion": "法医综合意见（2-3句，包含时间线推断和关键发现）",
    "additionalNotes": "补充备注（可选，特殊发现或存疑点）"
  },

  "crimeScene": {
    "setting": "案发地点（简短）",
    "address": "具体地址（虚构但合理）",
    "discoveryTime": "发现尸体时间",
    "reportedBy": "报案人",
    "weatherCondition": "天气状况（对案件有影响）",
    "description": "现场描述（电影感，5-8句，像导演说明书）",
    "keyAreas": [
      {
        "name": "区域名称（如：主卧室/储物间）",
        "description": "该区域描述",
        "cluesFound": ["在此发现的线索1", "线索2"]
      }
    ],
    "physicalEvidence": ["物证1", "物证2", "物证3"],
    "bloodSplatterPattern": "血迹分布描述（如果有）",
    "entryExitPoints": ["进出口1描述", "进出口2描述"]
  },

  "victim": {
    "name": "受害者姓名",
    "gender": "male | female",
    "age": 受害者年龄（数字）,
    "occupation": "职业",
    "background": "背景故事（3-4句）",
    "lastKnownLocation": "死前最后确认位置",
    "lastSeenTime": "最后被目击时间",
    "relationships": [
      { "name": "关联人姓名", "relation": "关系", "notes": "关联备注" }
    ],
    "secrets": ["受害者秘密1（可能引发杀机）", "秘密2"],
    "digitalFootprint": "数字痕迹（手机记录/邮件/社交媒体线索）"
  },

  "suspects": [
    {
      "id": "s1",
      "name": "嫌疑人姓名",
      "gender": "male | female",
      "age": 年龄,
      "occupation": "职业",
      "relationship": "与受害者关系",
      "alibi": "不在场证明（可能有漏洞）",
      "motive": "作案动机",
      "personality": "性格特征（2-3个词）",
      "secrets": ["隐藏秘密1", "秘密2"],
      "isGuilty": false,
      "psychProfile": {
        "mentalState": "审讯时心理状态（如：表面冷静，内心紧张）",
        "stressLevel": 45,
        "lyingProbability": 30,
        "confidenceLevel": 72,
        "heartbeatBPM": 95,
        "responseStyle": "回答风格（如：防御性、主动配合、转移话题）",
        "speakingSpeed": "缓慢 | 正常 | 急促",
        "isEvasive": false,
        "microExpressions": ["微表情特征1", "特征2"],
        "interrogationNotes": "审讯员观察备注（1-2句）"
      },
      "interrogationScript": [
        {
          "question": "审讯问题（关键问题）",
          "answer": "嫌疑人回答（符合其性格和是否有罪）",
          "isLie": false,
          "clueHidden": "这个回答中隐藏的线索（可选）"
        }
      ]
    }
  ],

  "evidence": [
    {
      "id": "e1",
      "name": "证据名称",
      "description": "证据描述（详细）",
      "location": "发现地点",
      "discoveredAt": "发现时间",
      "dna": "DNA检测结果（如适用）",
      "fingerprints": "指纹分析结果（如适用）",
      "relatedSuspects": ["s1"],
      "credibility": 85,
      "analysisResult": "分析结论（2-3句）",
      "canFormEvidenceChain": true,
      "evidenceChainNote": "如何与其他证据组成证据链",
      "significance": "此证据的关键意义",
      "category": "physical | digital | biological | documentary | testimonial"
    }
  ],

  "timeline": [
    { "time": "HH:mm", "event": "事件", "location": "地点", "witness": "目击者（可选）", "significance": "low | medium | high | critical" }
  ],

  "reasoningChain": {
    "nodes": [
      {
        "id": "n1",
        "step": 1,
        "content": "推理节点内容（1-2句）",
        "type": "clue | deduction | contradiction | conclusion",
        "relatedEvidence": ["e1"],
        "relatedSuspects": ["s1"],
        "confidence": 90
      }
    ],
    "logicRelations": [
      {
        "fromNodeId": "n1",
        "toNodeId": "n2",
        "relation": "A导致B | A排除B | A支持B | A矛盾B",
        "description": "逻辑关系说明"
      }
    ],
    "keyBreakthrough": "案件关键突破口（1句话）",
    "finalConclusion": "推理链最终结论（2-3句）"
  },

  "reconstruction": [
    {
      "sceneNumber": 1,
      "time": "HH:mm",
      "location": "地点",
      "characters": ["人物1", "人物2"],
      "action": "动作描述（电影感，现在时态）",
      "cameraAngle": "远景 | 近景 | 特写 | 俯拍 | 仰拍 | 跟拍 | 过肩镜头",
      "narration": "旁白（冷静、电影感、第三人称）",
      "environment": "环境描述（空间感、细节）",
      "lighting": "灯光描述（氛围感）",
      "emotion": "场景情绪/氛围",
      "soundscape": "音效描述（可选）"
    }
  ],

  "truth": {
    "killer": "真凶姓名",
    "method": "杀人手法（详细）",
    "motive": "最终动机（深层原因）",
    "process": ["步骤1", "步骤2", "步骤3", "步骤4"],
    "keyClues": ["关键线索1", "线索2", "线索3"],
    "twist": "剧情反转点（出乎玩家意料的信息）",
    "hiddenContext": "隐藏背景（玩家难以发现的深层信息）",
    "moralConclusion": "案件的道德/哲学结论（一句话，有深度）"
  },

  "scoringCriteria": {
    "totalMaxPoints": 100,
    "timeBonus": "时间加分规则（如：20分钟内完成额外+10分）",
    "categories": [
      {
        "name": "真凶识别",
        "maxPoints": 40,
        "description": "正确指出真凶",
        "criteria": ["准确指出真凶姓名 +40分", "指出错误嫌疑人 +0分"]
      },
      {
        "name": "手法还原",
        "maxPoints": 25,
        "description": "还原作案手法",
        "criteria": ["完整还原手法 +25分", "部分还原 +10-20分"]
      },
      {
        "name": "动机分析",
        "maxPoints": 20,
        "description": "正确分析作案动机",
        "criteria": ["准确说明动机 +20分", "方向正确但不完整 +10分"]
      },
      {
        "name": "证据运用",
        "maxPoints": 15,
        "description": "引用关键证据",
        "criteria": ["引用3条以上关键证据 +15分", "引用1-2条 +5-10分"]
      }
    ],
    "rankThresholds": [
      { "minScore": 95, "rank": "传奇侦探", "badge": "🏆" },
      { "minScore": 85, "rank": "资深侦探", "badge": "🥇" },
      { "minScore": 70, "rank": "优秀推理", "badge": "🥈" },
      { "minScore": 55, "rank": "合格侦探", "badge": "🥉" },
      { "minScore": 0,  "rank": "见习侦探", "badge": "📋" }
    ]
  },

  "wrongReasonings": [
    {
      "suspectName": "容易被误判的嫌疑人姓名",
      "falseClues": ["误导玩家的证据1", "证据2"],
      "reasoningPath": "玩家可能的错误推理路径（2-3句）",
      "whyItSeemsPossible": "为什么这个错误推断看起来合理",
      "correctingClue": "纠正这个错误推断的关键线索"
    }
  ],

  "redHerrings": ["红鲱鱼1（简短描述）", "红鲱鱼2"],

  "easterEggs": [
    {
      "id": "egg1",
      "name": "彩蛋名称",
      "description": "彩蛋内容描述",
      "triggerCondition": "触发条件（如：审讯时问某个特定问题）",
      "hiddenIn": "藏在哪个模块（如：法医报告附注）",
      "reward": "发现后的奖励或额外信息",
      "loreHint": "这个彩蛋暗示的世界观或更大背景"
    }
  ],

  "achievements": [
    {
      "id": "ach1",
      "name": "成就名称",
      "description": "成就描述",
      "icon": "emoji",
      "condition": "解锁条件",
      "reward": "奖励内容",
      "rarity": "common | rare | epic | legendary"
    }
  ]
}

要求：
1. 整个案件必须内部逻辑自洽，时间线不能矛盾
2. 法医报告中的死亡时间必须与时间线一致
3. missionBriefing.script 中提到的死亡时间必须与 forensicReport.deathTime 一致
4. missionBriefing.revealedFacts 中 "死亡时间" 的 value 必须与 forensicReport.deathTime 一致
5. 每个嫌疑人的 psychProfile 数值要符合其是否有罪（真凶压力更高、撒谎概率更高）
6. 案件重建(reconstruction)至少5个分镜场景，从案发前铺垫到案发后离场
7. 推理链(reasoningChain)至少4个节点，逻辑关系清晰
8. 成就(achievements)至少4个，包含1个legendary稀有度
9. 彩蛋(easterEggs)至少2个，内容有趣且与案件有深层联系
10. 只输出JSON，不要解释`;
}

// ─── 生成案件主函数 ──────────────────────────────────────────────────────────
export async function generateCaseWithAI(difficulty: Difficulty, userId?: string): Promise<CaseData> {
  const configError = getAiConfigError();
  if (configError) return createFallbackCase(difficulty);

  const prompt = buildCaseWorldPrompt(difficulty);
  const started = Date.now();

  try {
    const completion = await client.chat.completions.create({
      model: AI_CONFIG.caseModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(extractJson(raw)) as Omit<CaseData, 'id' | 'createdAt' | 'difficulty'>;

    await logAiCall({
      type: 'case',
      model: AI_CONFIG.caseModel,
      userId,
      usage: completion.usage,
      durationMs: Date.now() - started,
    });

    // 从新结构中同步 legacy 字段
    const crimeScene = parsed.crimeScene;
    const fullCase: CaseData = {
      ...parsed,
      id: generateId(),
      difficulty,
      createdAt: now(),
      // legacy 字段兼容
      setting: parsed.setting ?? crimeScene?.setting ?? '',
      deathMethod: parsed.deathMethod ?? parsed.forensicReport?.causeOfDeath ?? '',
      sceneDescription: parsed.sceneDescription ?? crimeScene?.description ?? '',
    };

    return normalizeCaseData(fullCase);
  } catch (error) {
    console.error('[AI] Case world generation failed:', error);
    return createFallbackCase(difficulty);
  }
}

// ─── 嫌疑人审讯流式对话 ──────────────────────────────────────────────────────
export async function createSuspectChatStream(params: {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId?: string;
  caseId?: string;
}) {
  const configError = getAiConfigError();
  if (configError) throw new Error(configError);

  const started = Date.now();
  const stream = await client.chat.completions.create({
    model: AI_CONFIG.chatModel,
    messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
    temperature: 0.8,
    stream: true,
  });

  return {
    async *iterate() {
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) yield delta;
        if (chunk.usage) usage = chunk.usage;
      }
      await logAiCall({
        type: 'interrogate',
        model: AI_CONFIG.chatModel,
        userId: params.userId,
        caseId: params.caseId,
        usage,
        durationMs: Date.now() - started,
      });
    },
  };
}

// ─── 推理评分 ─────────────────────────────────────────────────────────────────
export async function evaluateDeduction(
  caseData: CaseData,
  userDeduction: string,
  userId?: string
): Promise<CaseEvaluation> {
  const configError = getAiConfigError();
  if (configError) {
    const killerCorrect = userDeduction.includes(caseData.truth.killer);
    const score = killerCorrect ? 72 : 45;
    return {
      score,
      breakdown: { logic: score, evidence: score - 5, deduction: score + 2 },
      feedback: killerCorrect ? '推理方向正确，但细节仍可加强。' : '真凶判断有误，请重新梳理线索。',
      rating: killerCorrect ? '合格侦探' : '需要练习',
      killerCorrect,
      missedClues: caseData.truth.keyClues.slice(0, 1),
      userDeduction,
    };
  }

  const criteria = caseData.scoringCriteria?.categories
    .map(c => `${c.name}(满分${c.maxPoints})：${c.criteria.join('；')}`)
    .join('\n') ?? '真凶识别40分，手法还原25分，动机分析20分，证据运用15分';

  const prompt = `你是推理评分官。根据案件真相和评分标准评估玩家推理。
案件标题：${caseData.title}
真凶：${caseData.truth.killer}
手法：${caseData.truth.method}
动机：${caseData.truth.motive}
关键线索：${caseData.truth.keyClues.join('、')}
玩家推理：${userDeduction}

评分标准：
${criteria}

输出JSON：{
  "score": 0-100,
  "breakdown": {"真凶识别":0-40,"手法还原":0-25,"动机分析":0-20,"证据运用":0-15},
  "feedback": "详细评语（2-3句，肯定优点+指出不足）",
  "rating": "评级称号",
  "killerCorrect": true/false,
  "missedClues": ["遗漏的关键线索"]
}`;

  const started = Date.now();
  const completion = await client.chat.completions.create({
    model: AI_CONFIG.evaluateModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });
  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(extractJson(raw)) as CaseEvaluation;

  await logAiCall({
    type: 'evaluate',
    model: AI_CONFIG.evaluateModel,
    userId,
    caseId: caseData.id,
    usage: completion.usage,
    durationMs: Date.now() - started,
  });

  const thresholds = caseData.scoringCriteria?.rankThresholds ?? [
    { minScore: 95, rank: '传奇侦探' },
    { minScore: 85, rank: '资深侦探' },
    { minScore: 70, rank: '优秀推理' },
    { minScore: 55, rank: '合格侦探' },
    { minScore: 0, rank: '见习侦探' },
  ];
  const defaultRating = thresholds.find(t => (parsed.score ?? 0) >= t.minScore)?.rank ?? '合格侦探';

  return {
    ...parsed,
    rating: parsed.rating || defaultRating,
    userDeduction,
  };
}

// ─── 构建审讯系统提示词（利用心理档案数据）────────────────────────────────
export function buildInterrogationPrompt(
  suspect: {
    id: string;
    name: string;
    isGuilty?: boolean;
    psychProfile?: {
      mentalState: string;
      responseStyle: string;
      speakingSpeed: string;
      isEvasive: boolean;
      microExpressions: string[];
    };
    personality?: string;
    secrets?: string[];
  },
  evidence: string[],
  caseSummary: string
): string {
  const role = suspect.isGuilty
    ? '你是真凶，内心极度紧张，必须隐瞒罪行，但表面尽量保持镇定'
    : '你是无辜嫌疑人，配合调查但可保留个人隐私';

  const psych = suspect.psychProfile;
  const styleGuide = psych
    ? `回答风格：${psych.responseStyle}。语速：${psych.speakingSpeed}。${psych.isEvasive ? '倾向于回避直接回答。' : ''}`
    : '';

  const microExp = psych?.microExpressions?.length
    ? `你的微表情特征（隐含在措辞中，不直接说出）：${psych.microExpressions.join('、')}`
    : '';

  return `${role}。你扮演嫌疑人「${suspect.name}」。
性格：${suspect.personality ?? '正常'}
${styleGuide}
${microExp}
已知案件摘要：${caseSummary}
侦探已掌握证据：${evidence.length ? evidence.join('；') : '暂无'}
规则：中文口语，120字以内，不跳出角色，不直接承认或否认是真凶，回答中可植入细微矛盾。`;
}

export function serializeCaseSummary(caseData: CaseData): string {
  const scene = caseData.crimeScene?.setting ?? caseData.setting;
  return `${caseData.title} · ${scene} · 死者${caseData.victim.name} · ${caseData.truth.method ?? caseData.deathMethod}`;
}
