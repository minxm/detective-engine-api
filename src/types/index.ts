export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

// ─── Module 0: 行动指挥 Briefing（开场简报）───────────────────────────────
export interface BriefingRevealItem {
  /** 简报朗读到第几秒时该条目出现（前端打字机动画用） */
  atSecond: number;
  label: string;   // 如 "死亡时间" / "案件等级" / "当前状态"
  value: string;   // 如 "20:10 - 20:35" / "★★★★☆" / "OPEN"
}

export interface MissionBriefing {
  /** AI局长姓名（与 intelligence.responsibleAI 一致） */
  directorName: string;
  directorTitle: string;        // 如 "首席调查AI · NOAH"

  /** 开场一句话（大字显示，营造氛围） */
  openingLine: string;

  /** 完整简报文本（供 TTS / 打字机逐字播放，约 80-150 字） */
  script: string;

  /**
   * 简报播放过程中，在屏幕右侧/底部依次打出的关键数据条目。
   * 前端根据 atSecond 字段控制出现时机，形成「数据流动」效果。
   */
  revealedFacts: BriefingRevealItem[];

  /** 结尾行动指令（引导玩家点击"开始调查"） */
  missionOrder: string;

  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 建议播放时长（秒），20-40 */
  durationSeconds: number;
}

// ─── Module 1: 情报局 ───────────────────────────────────────────────────────
export interface IntelligenceBureau {
  caseLevel: string;            // ★★★★★
  securityLevel: string;        // TOP SECRET / CONFIDENTIAL / RESTRICTED
  riskLevel: string;            // A / B / C / D
  investigationPermission: string; // Level 1-5
  caseNumber: string;           // CASE-2026-XXXX
  responsibleAI: string;        // NOAH / ATLAS / CIPHER
  estimatedTime: number;        // minutes
  briefing: string;             // 任务简报（1-2句）
}

// ─── Module 2: 案件卷宗（FBI档案风格）──────────────────────────────────────
export interface CaseDossier {
  caseNumber: string;
  coverTitle: string;
  dangerLevel: string;          // EXTREME / HIGH / MODERATE / LOW
  caseStatus: string;           // OPEN / COLD / CLASSIFIED
  department: string;           // 调查部门
  filingDate: string;           // 立案时间，格式 YYYY-MM-DD HH:mm
  summary: string;              // 案件摘要（3-5句）
  confidentialityClause: string; // 保密协议
  investigationObjectives: string[]; // 调查目标（3-5条）
  caseBackground: string;       // 背景说明
}

// ─── Module 3: 法医报告（Detroit风格）──────────────────────────────────────
export interface ForensicReport {
  reportId: string;
  examinedBy: string;           // 法医姓名
  examinationDate: string;
  deathTime: string;            // 死亡时间（区间）
  bodyTemperature: string;      // 尸温
  lividityMarks: string;        // 尸斑（颜色/位置/分布）
  rigorMortis: string;          // 尸僵（程度/阶段）
  bloodAnalysis: string;        // 血液分析
  dna: string;                  // DNA 鉴定结果
  wounds: Array<{
    location: string;
    type: string;
    description: string;
    weaponType?: string;
  }>;
  toxicology: string;           // 毒物筛查
  pathology: string;            // 病理分析
  stomachContents: string;      // 胃内容物
  causeOfDeath: string;         // 死因（官方结论）
  forensicConclusion: string;   // 法医意见（综合判断）
  additionalNotes?: string;
}

// ─── Module 4: 案发现场 ─────────────────────────────────────────────────────
export interface CrimeScene {
  setting: string;
  address: string;
  discoveryTime: string;
  reportedBy: string;
  weatherCondition: string;     // 天气/环境
  description: string;          // 现场描述（电影感）
  keyAreas: Array<{
    name: string;
    description: string;
    cluesFound: string[];
  }>;
  physicalEvidence: string[];   // 现场物证清单
  bloodSplatterPattern?: string;
  entryExitPoints: string[];    // 进出入口
  imageUrl?: string;
  mapImageUrl?: string;
}

// ─── Module 5: 受害者（增强版）─────────────────────────────────────────────
export interface Victim {
  name: string;
  gender?: 'male' | 'female';
  age: number;
  occupation: string;
  background: string;
  lastKnownLocation: string;   // 死前最后位置
  lastSeenTime: string;
  relationships: Array<{
    name: string;
    relation: string;
    notes: string;
  }>;
  secrets: string[];           // 受害者秘密（可能是动机线索）
  digitalFootprint: string;    // 手机/社交/邮件线索
  imageUrl?: string;
}

// ─── Module 6+7: 嫌疑人 + 审讯数据 ────────────────────────────────────────
export interface SuspectPsychProfile {
  mentalState: string;         // 紧张 / 冷静 / 恐慌 / 愤怒
  stressLevel: number;         // 0-100
  lyingProbability: number;    // 0-100
  confidenceLevel: number;     // 0-100（Confidence）
  heartbeatBPM: number;        // 心率
  responseStyle: string;       // 简洁/绕弯/防御性/攻击性
  speakingSpeed: string;       // 缓慢/正常/急促
  isEvasive: boolean;
  microExpressions: string[];  // 微表情特征
  interrogationNotes: string;  // 审讯员备注
}

export interface Suspect {
  id: string;
  name: string;
  gender?: 'male' | 'female';
  age: number;
  occupation: string;
  relationship: string;
  alibi: string;
  motive: string;
  personality: string;
  secrets: string[];
  imageUrl?: string;
  isGuilty: boolean;
  psychProfile: SuspectPsychProfile;
  interrogationScript: Array<{
    question: string;
    answer: string;
    isLie: boolean;
    clueHidden?: string;
  }>;
}

// ─── Module 8: 证据（增强版 HUD 风格）──────────────────────────────────────
export interface Evidence {
  id: string;
  name: string;
  description: string;
  location: string;
  discoveredAt: string;        // 发现时间
  dna?: string;                // DNA 结果
  fingerprints?: string;       // 指纹分析
  relatedSuspects: string[];
  credibility: number;         // 可信度 0-100
  analysisResult: string;      // 分析结论
  canFormEvidenceChain: boolean;
  evidenceChainNote?: string;  // 如何组成证据链
  significance: string;
  category: 'physical' | 'digital' | 'biological' | 'documentary' | 'testimonial';
  imageUrl?: string;
}

// ─── Module 9: AI 推理链（逻辑图谱）────────────────────────────────────────
export interface ReasoningNode {
  id: string;
  step: number;
  content: string;
  type: 'clue' | 'deduction' | 'contradiction' | 'conclusion';
  relatedEvidence?: string[];
  relatedSuspects?: string[];
  confidence: number;          // 推理置信度 0-100
}

export interface ReasoningChain {
  nodes: ReasoningNode[];
  logicRelations: Array<{
    fromNodeId: string;
    toNodeId: string;
    relation: string;          // "A导致B" / "A排除B" / "A支持B"
    description: string;
  }>;
  keyBreakthrough: string;     // 关键突破口
  finalConclusion: string;
}

// ─── Module 10: 案件重建（电影分镜）────────────────────────────────────────
export interface ReconstructionScene {
  sceneNumber: number;
  time: string;                // HH:mm
  location: string;
  characters: string[];
  action: string;              // 动作描述
  cameraAngle: string;         // 远景/近景/特写/俯拍/仰拍/跟拍
  narration: string;           // 旁白（电影感）
  environment: string;         // 环境描述
  lighting: string;            // 灯光描述
  emotion: string;             // 情绪/氛围
  soundscape?: string;         // 音效/背景音
}

// ─── Legacy: Timeline（保持兼容）────────────────────────────────────────────
export interface TimelineEvent {
  time: string;
  event: string;
  location: string;
  witness?: string;
  significance: 'low' | 'medium' | 'high' | 'critical';
}

// ─── Module 11: 最终真相 ─────────────────────────────────────────────────────

/**
 * 动机可推导证据链——确保玩家有足够线索从三个层次独立推出动机。
 *
 * - discoveryClues  : 入口层，玩家调查场景/审讯时能发现的线索（引发怀疑）
 * - verificationClues : 核实层，可与其他证据/记录交叉比对的线索（确认事实）
 * - corroborationClues : 印证层，来自不同来源、独立指向同一结论的线索（闭环推理）
 */
export interface MotiveEvidenceChain {
  /** 动机类型：财产 / 复仇 / 掩盖秘密 / 情感 / 权力 / 其他 */
  motiveCategory: string;
  /** 触发事件：为什么凶手在此时此刻必须动手（时间压力/催化剂） */
  motiveTrigger: string;
  /** 入口层：至少 2 条，来自物证或嫌疑人陈述中的矛盾 */
  discoveryClues: Array<{
    evidenceId: string;
    description: string;
    /** 玩家应如何发现此线索（场景调查/审讯追问/证据组合） */
    howToFind: string;
  }>;
  /** 核实层：至少 1 条，可通过记录/时间戳/第三方比对验证 */
  verificationClues: Array<{
    evidenceId: string;
    description: string;
    /** 与哪个已有证据/事实形成比对 */
    crossRef: string;
  }>;
  /** 印证层：至少 2 条，来自不同信源，独立指向动机结论 */
  corroborationClues: Array<{
    source: 'suspect' | 'victim_item' | 'third_party' | 'physical_evidence' | 'digital';
    evidenceId: string;
    description: string;
    /** 该线索如何独立指向动机 */
    logicLink: string;
  }>;
}

export interface FinalTruth {
  killer: string;
  method: string;
  motive: string;
  process: string[];
  keyClues: string[];
  twist?: string;              // 剧情反转点
  hiddenContext: string;       // 深层背景（玩家不易发现的信息）
  moralConclusion: string;     // 案件道德/哲学结论（1句话）
  /** 动机三层证据链（保证玩家有完整推导路径） */
  motiveEvidenceChain?: MotiveEvidenceChain;
}

// ─── Module 12: AI 评分标准 ─────────────────────────────────────────────────
export interface ScoringCategory {
  name: string;
  maxPoints: number;
  description: string;
  criteria: string[];
}

export interface ScoringCriteria {
  totalMaxPoints: number;
  timeBonus: string;           // 时间加分规则
  categories: ScoringCategory[];
  rankThresholds: Array<{
    minScore: number;
    rank: string;
    badge: string;
  }>;
}

// ─── Module 13: 玩家可能错误推理 ────────────────────────────────────────────
export interface WrongReasoning {
  suspectName: string;
  falseClues: string[];        // 误导性证据
  reasoningPath: string;       // 错误推理路径
  whyItSeemsPossible: string;  // 为什么容易误判
  correctingClue: string;      // 纠偏关键线索
}

// ─── Module 14: 隐藏彩蛋 ────────────────────────────────────────────────────
export interface EasterEgg {
  id: string;
  name: string;
  description: string;
  triggerCondition: string;    // 触发条件
  hiddenIn: string;            // 藏在哪个模块/证据
  reward: string;
  loreHint: string;            // 世界观提示
}

// ─── Module 15: 成就 ────────────────────────────────────────────────────────
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;                // emoji icon
  condition: string;
  reward: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

// ─── 主案件数据（全量）──────────────────────────────────────────────────────
export interface CaseData {
  id: string;
  title: string;
  difficulty: Difficulty;
  createdAt: number;

  // M0
  missionBriefing: MissionBriefing;
  // M1
  intelligence: IntelligenceBureau;
  // M2
  dossier: CaseDossier;
  // M3
  forensicReport: ForensicReport;
  // M4
  crimeScene: CrimeScene;
  // M5 (victim is also part of crimeScene)
  victim: Victim;
  // M6+M7
  suspects: Suspect[];
  // M8
  evidence: Evidence[];
  // Legacy timeline
  timeline: TimelineEvent[];
  // M9
  reasoningChain: ReasoningChain;
  // M10
  reconstruction: ReconstructionScene[];
  // M11
  truth: FinalTruth;
  // M12
  scoringCriteria: ScoringCriteria;
  // M13
  wrongReasonings: WrongReasoning[];
  // Legacy red herrings
  redHerrings: string[];
  // M14
  easterEggs: EasterEgg[];
  // M15
  achievements: Achievement[];

  // Legacy flat fields (backward compat with DB/API routes)
  setting: string;
  deathMethod: string;
  sceneDescription: string;
  sceneImageUrl?: string;
  mapImageUrl?: string;
}

// ─── 其余记录类型（保持不变）────────────────────────────────────────────────
export type UserRole = 'user' | 'admin';

export interface UserRecord {
  _id: string;
  /** 本地账号用户名（用于本地认证模式） */
  username?: string;
  /** 本地账号密码哈希（scrypt，格式：{salt}:{hash}） */
  passwordHash?: string;
  nickname: string;
  avatar?: string;
  role: UserRole;
  score: number;
  casesCompleted?: number;
  averageScore?: number;
  perfectSolves?: number;
  streak?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CaseRecord {
  _id: string;
  difficulty: Difficulty;
  status: 'pending' | 'generating' | 'ready' | 'claimed';
  victim: CaseData['victim'];
  suspects: Suspect[];
  scene: {
    setting: string;
    deathMethod: string;
    sceneDescription: string;
    sceneImageUrl?: string;
  };
  evidence: Evidence[];
  timeline: TimelineEvent[];
  answer: CaseData['truth'];
  redHerrings: string[];
  title: string;
  createdAt: number;
  // New full data
  missionBriefing?: MissionBriefing;
  intelligence?: IntelligenceBureau;
  dossier?: CaseDossier;
  forensicReport?: ForensicReport;
  crimeScene?: CrimeScene;
  reasoningChain?: ReasoningChain;
  reconstruction?: ReconstructionScene[];
  scoringCriteria?: ScoringCriteria;
  wrongReasonings?: WrongReasoning[];
  easterEggs?: EasterEgg[];
  achievements?: Achievement[];
}

export interface SessionRecord {
  _id: string;
  userId: string;
  caseId: string;
  messages: Array<{
    suspectId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  progress?: {
    discoveredEvidence: string[];
    interrogatedSuspects: string[];
    notes: string;
    startTime: number;
    endTime?: number;
    score?: number;
    flowStep?: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface HistoryRecord {
  _id: string;
  userId: string;
  caseId: string;
  caseTitle: string;
  score: number | null;
  rating: string;
  killerCorrect: boolean | null;
  status: 'in_progress' | 'completed';
  createdAt: number;
  updatedAt: number;
}

/** 历史列表接口返回的精简字段（与 HistoryRecord 一致，用于显式投影） */
export type HistoryListItem = HistoryRecord;

export interface LeaderboardRecord {
  _id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  totalScore: number;
  casesCompleted: number;
  avgScore: number;
  perfectSolves: number;
  updatedAt: number;
}

export interface InventoryRecord {
  _id: string;
  difficulty: Difficulty;
  caseId: string;
  caseData: CaseData;
  status: 'available' | 'claimed';
  claimedBy?: string;
  createdAt: number;
}

export interface GenerationJob {
  _id: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  stage: string;
  difficulty: Difficulty;
  userId?: string;
  caseId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type RefillJobStage = 'pending' | 'generating' | 'images' | 'persisting' | 'ready' | 'failed';

export interface RefillJob {
  _id: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  stage: RefillJobStage;
  difficulty: Difficulty;
  total: number;
  /** 当前正在生成的序号（0-based） */
  current: number;
  created: string[];
  errors: string[];
  error?: string;
  inventoryCounts?: Record<string, number>;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

/** 结案评分异步任务（避免网关同步等待慢速模型超时） */
export interface ScoreJob {
  _id: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  userId?: string;
  caseId: string;
  evaluation?: CaseEvaluation;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 预生成案例领取记录（同一用户对同一案件仅记录一次） */
export interface ClaimRecord {
  _id: string;
  /** 来源库存 ID */
  inventoryId: string;
  /** 案件 ID */
  caseId: string;
  userId: string;
  nickname: string;
  claimedAt: number;
}

export interface AiLogRecord {
  _id: string;
  type: 'case' | 'interrogate' | 'evaluate' | 'image';
  userId?: string;
  caseId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  createdAt: number;
}

/** 实时在线状态（心跳写入，用于管理后台在线人数） */
export interface OnlinePresenceRecord {
  _id: string;
  userId: string;
  nickname?: string;
  role: UserRole;
  lastSeen: number;
}

/** 用户登录/注册审计记录 */
export interface LoginAuditRecord {
  _id: string;
  userId: string;
  username?: string;
  nickname: string;
  source: 'login' | 'register';
  createdAt: number;
}

export interface CaseEvaluation {
  score: number;
  breakdown: Record<string, number>;
  feedback: string;
  rating: string;
  killerCorrect?: boolean;
  missedClues: string[];
  userDeduction?: string;
}

export interface InterrogationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: unknown;
}
