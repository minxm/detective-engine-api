import OpenAI from 'openai';
import { AI_CONFIG, getAiConfigError, generateId, now } from '../utils/index.js';
import { withRetry } from '../utils/retry.js';
import { getDatabase } from '../db/index.js';
import type { CaseData, CaseEvaluation, Difficulty } from '../types/index.js';
import { createFallbackCase } from './fallback-case.js';
import { enrichGeneratedCase, extractCaseMetaFromPrompt } from './case-enrich.js';
import { normalizeCaseData } from '../services/case-service.js';

const client = new OpenAI({
  apiKey: AI_CONFIG.apiKey,
  baseURL: AI_CONFIG.baseURL,
  timeout: 180000,
  maxRetries: 0,
});

/** 案件生成专用客户端：更长超时，避免大 JSON 未完成就回退固定模板 */
const caseClient = new OpenAI({
  apiKey: AI_CONFIG.apiKey,
  baseURL: AI_CONFIG.baseURL,
  timeout: 360000,
  maxRetries: 0,
});

function extractJson(content: string): string {
  let text = content.trim();
  // Qwen3 / DeepSeek 等推理模型的思考块
  text = text.replace(/[\s\S]*?<\/think>/gi, '').trim();
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) return block[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function getCaseRandomization() {
  const settings = [
    '豪华游轮', '雪山民宿', '艺术画廊', '私人诊所', '电视台演播厅',
    '古董拍卖行', '大学实验室', '地下酒吧', '高档公寓', '郊野露营地',
    '私人博物馆', '律所办公室', '录音棚', '马术俱乐部', '温泉度假村',
  ];
  const conflicts = [
    '遗产争夺', '商业背叛', '情感纠葛', '学术造假', '政治丑闻',
    '艺术品赝品', '医疗事故', '家族秘密', '勒索敲诈', '职场霸凌',
  ];
  const eras = ['当代都市', '90年代怀旧', '近未来科技社会', '海滨小城'];
  return {
    seed: generateId(),
    setting: settings[Math.floor(Math.random() * settings.length)]!,
    conflict: conflicts[Math.floor(Math.random() * conflicts.length)]!,
    era: eras[Math.floor(Math.random() * eras.length)]!,
  };
}

function buildCaseCompletionParams(prompt: string): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
    enable_thinking?: boolean;
  } = {
    model: AI_CONFIG.caseModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.92,
    max_tokens: 8192,
  };
  if (/qwen3|deepseek-r1|deepseek-v3\.2|glm-z1/i.test(AI_CONFIG.caseModel)) {
    params.enable_thinking = false;
  }
  return params;
}

async function logAiCall(params: {
  type: 'case' | 'interrogate' | 'evaluate' | 'image';
  model: string;
  userId?: string;
  caseId?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  durationMs: number;
}) {
  if (!params.userId) return;
  try {
    const db = getDatabase();
    await withRetry(
      () =>
        db.aiLogs.add({
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
        }),
      { retries: 2, delayMs: 300 },
    );
  } catch (err) {
    console.warn('[AI] aiLogs 写入失败，不影响生成:', (err as Error).message);
  }
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
  const aiNames = ['NOAH', 'ATLAS', 'CIPHER', 'LYRA', 'ORION', 'VEGA', 'NIX', 'SAGE'];
  const aiName = aiNames[Math.floor(Math.random() * aiNames.length)]!;
  const rand = getCaseRandomization();

  return `你是「案件世界生成器」——一个专为推理游戏创造完整叙事宇宙的AI。
你的任务不是简单生成案件，而是生成一个拥有电影质感的、可交互的、内部逻辑自洽的「案件世界」。

【唯一性要求 — 最高优先级】
- 创作种子：${rand.seed}
- 本次场景类型：${rand.setting}
- 核心矛盾：${rand.conflict}
- 时代氛围：${rand.era}
- 所有人物姓名、地点、作案手法必须原创，禁止复用常见模板（如：废弃仓库、林雪峰、王建国、陈美玲等）
- 即使难度相同，也必须与任何已有案件完全不同

难度：${difficulty}（${cfg.stars}）
嫌疑人数量：${cfg.suspectCount}，其中仅1人 isGuilty:true
案件编号：${caseNum}
负责AI：${aiName}

请输出单个合法 JSON 对象（禁止 markdown 代码块，禁止任何解释文字）。

必须包含以下核心字段（嵌套结构合理即可，missionBriefing/intelligence/dossier/scoringCriteria 可省略，系统会自动补全）：

- title：原创悬疑标题（5-10字）
- crimeScene：{ setting, address, discoveryTime, description(5-8句), keyAreas[≥2], physicalEvidence, entryExitPoints }
- victim：{ name, gender, age, occupation, background, relationships[≥2], secrets[≥1] }
- suspects：${cfg.suspectCount} 人，仅 1 人 isGuilty:true；每人含 id,name,relationship,alibi,motive,personality,secrets,isGuilty,psychProfile,interrogationScript[≥1]
- evidence：${cfg.evidenceCount} 条；含 id,name,description,location,relatedSuspects,credibility,analysisResult,canFormEvidenceChain,significance,category
- timeline：≥6 条 { time, event, location, significance }
- forensicReport：{ deathTime, causeOfDeath, forensicConclusion, wounds[≥1], toxicology, pathology }
- reasoningChain：{ nodes[≥4], logicRelations, keyBreakthrough, finalConclusion }
- reconstruction：≥5 个电影分镜 { sceneNumber, time, location, characters, action, narration, cameraAngle, emotion }
- truth：{ killer, method, motive, process[≥3], keyClues[≥3], twist, moralConclusion, motiveEvidenceChain }
- wrongReasonings：≥2 条（针对易误判嫌疑人）
- redHerrings：≥2 条
- easterEggs：≥2 条；achievements：≥4 条（含 1 条 legendary）

【motiveEvidenceChain 必须字段说明（置于 truth 内）】
motiveEvidenceChain 是本游戏的核心设计：玩家必须能从三个独立层次推导出动机，缺一不可。
{
  motiveCategory: "财产|复仇|掩盖秘密|情感|权力|其他（选一）",
  motiveTrigger: "触发事件——为什么凶手在此时此刻必须动手（如：遗嘱即将生效、秘密即将败露、勒索期限到期）",
  discoveryClues: [
    // ≥2条：调查现场或审讯时能发现的入口线索，引发玩家怀疑
    { evidenceId: "对应证据id", description: "线索内容", howToFind: "如何发现（场景调查/追问某嫌疑人/组合证据）" }
  ],
  verificationClues: [
    // ≥1条：可与其他记录/时间戳/第三方交叉比对来验证
    { evidenceId: "对应证据id", description: "验证内容", crossRef: "与哪条证据或事实形成比对" }
  ],
  corroborationClues: [
    // ≥2条：来自不同信源，独立指向同一动机结论（印证闭环）
    { source: "suspect|victim_item|third_party|physical_evidence|digital", evidenceId: "对应证据id", description: "内容", logicLink: "如何独立指向动机" }
  ]
}
设计原则：
- discoveryClues 的 evidenceId 必须存在于 evidence 数组中
- corroborationClues 的两条来源必须不同（不能都是 suspect）
- 动机结论不能只靠一人的陈述，必须有物证或第三方印证

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
10. 只输出JSON，不要解释${/qwen3/i.test(AI_CONFIG.caseModel) ? '\n/no_think' : ''}`;
}

// ─── 生成案件主函数 ──────────────────────────────────────────────────────────
export async function generateCaseWithAI(difficulty: Difficulty, userId?: string): Promise<CaseData> {
  const configError = getAiConfigError();
  if (configError) {
    console.warn('[AI] SILICONFLOW_API_KEY 未配置，使用开发用固定模板案件');
    return createFallbackCase(difficulty);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = buildCaseWorldPrompt(difficulty);
    const meta = extractCaseMetaFromPrompt(prompt);
    const started = Date.now();
    try {
      const completion = await caseClient.chat.completions.create(buildCaseCompletionParams(prompt));
      const raw = completion.choices[0]?.message?.content ?? '';
      if (!raw.trim()) throw new Error('AI 返回空内容');

      const parsed = JSON.parse(extractJson(raw)) as Omit<CaseData, 'id' | 'createdAt' | 'difficulty'>;
      if (!parsed.title?.trim()) throw new Error('AI 返回的案件缺少标题');
      if (!parsed.victim?.name) throw new Error('AI 返回的案件缺少受害者信息');
      if (!Array.isArray(parsed.suspects) || parsed.suspects.length === 0) {
        throw new Error('AI 返回的案件缺少嫌疑人');
      }
      if (!parsed.truth?.killer) throw new Error('AI 返回的案件缺少真相');

      await logAiCall({
        type: 'case',
        model: AI_CONFIG.caseModel,
        userId,
        usage: completion.usage,
        durationMs: Date.now() - started,
      });

      const enriched = enrichGeneratedCase(parsed, { difficulty, ...meta });
      const fullCase: CaseData = {
        ...enriched,
        id: generateId(),
        difficulty,
        createdAt: now(),
      };

      return normalizeCaseData(fullCase);
    } catch (error) {
      lastError = error;
      console.error(`[AI] Case world generation attempt ${attempt}/3 failed:`, error);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : '未知错误';
  throw new Error(`案件 AI 生成失败：${detail}`);
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
  const stream = await withRetry(
    () =>
      client.chat.completions.create({
        model: AI_CONFIG.chatModel,
        messages: [{ role: 'system', content: params.systemPrompt }, ...params.messages],
        temperature: 0.8,
        stream: true,
      }),
    { retries: 3, delayMs: 600 },
  );

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
}
只输出 JSON，不要解释。${/qwen3|deepseek-r1/i.test(AI_CONFIG.evaluateModel) ? '\n/no_think' : ''}`;

  const started = Date.now();
  const disableThinking = /deepseek-r1|qwen3/i.test(AI_CONFIG.evaluateModel);
  const completion = await withRetry(
    async () => {
      const res = await client.chat.completions.create({
        model: AI_CONFIG.evaluateModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1200,
        stream: false,
        ...(disableThinking ? { enable_thinking: false } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      return res as Awaited<ReturnType<typeof client.chat.completions.create>> & {
        choices: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
    },
    { retries: 1, delayMs: 800 },
  );
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
