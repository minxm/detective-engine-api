import { AI_CONFIG, generateId, getAiConfigError, now } from '../utils/index.js';
import { getBlob } from '../blob/index.js';
import { getDatabase } from '../db/index.js';
import type { CaseData, Suspect } from '../types/index.js';

type ImageGenerationItem = {
  url?: string;
  b64_json?: string;
};

type ImageGenerationResponse = {
  data?: ImageGenerationItem[];
  images?: ImageGenerationItem[];
};

/**
 * 视觉风格：暗色赛博朋克·黑色电影·情报局插画
 * 与页面整体设计语言一致：深黑背景，青色/红色霓虹冷光，科幻 HUD 感，电影级构图
 */
const BASE_STYLE =
  'cinematic digital illustration, dark cyberpunk noir, deep black background (#0B0F14), ' +
  'cold cyan and teal neon rim light, high contrast chiaroscuro, ' +
  'futuristic intelligence bureau aesthetic, film noir atmosphere, ' +
  'semi-realistic concept art, sharp details, dramatic lighting, ' +
  'no text, no watermark, no logo';

const NEGATIVE_PROMPT =
  'anime, cartoon, cel shading, flat color, 3D render, photorealistic photo, ' +
  'bright cheerful colors, low quality, blurry, deformed, extra limbs, ' +
  'text, watermark, logo, signature, border, frame';

/** 场景专用风格修饰词 */
const SCENE_STYLE =
  `${BASE_STYLE}, wide establishing shot, environmental storytelling, ` +
  'moody atmospheric haze, neon reflections on wet surfaces, crime scene tape glow';

/** 人物立绘专用风格修饰词 */
const PORTRAIT_STYLE =
  `${BASE_STYLE}, half-body portrait, cold cyan rim light on edges, ` +
  'dark vignette background, intelligence dossier style, tense expression';

function assertImageApiConfigured() {
  const error = getAiConfigError();
  if (error) throw new Error(`${error}，案件生图必须配置 SILICONFLOW_API_KEY`);
}

function genderLabel(gender?: 'male' | 'female'): string {
  if (gender === 'female') return '女性';
  if (gender === 'male') return '男性';
  return '';
}

function buildScenePrompt(caseData: CaseData): string {
  const sceneDesc = caseData.sceneDescription.slice(0, 120);
  return [
    SCENE_STYLE,
    `crime scene: ${caseData.setting}`,
    sceneDesc,
    'abandoned or isolated location, evidence markers with faint cyan glow, deep shadows',
    'ultra-wide angle, oppressive tension, intricate environmental details',
  ].join(', ');
}

function buildVictimPrompt(victim: CaseData['victim']): string {
  const gender = genderLabel(victim.gender);
  return [
    PORTRAIT_STYLE,
    `victim character: ${victim.name}`,
    `${gender}, age ${victim.age}, occupation: ${victim.occupation}`,
    victim.background.slice(0, 80),
    'pale cold lighting suggesting tragedy, muted desaturated tones, sorrowful undertone',
  ].join(', ');
}

function buildSuspectPrompt(suspect: Suspect): string {
  const gender = genderLabel(suspect.gender);
  return [
    PORTRAIT_STYLE,
    `suspect character: ${suspect.name}`,
    `${gender}, age ${suspect.age}, occupation: ${suspect.occupation}`,
    `personality: ${suspect.personality}`,
    'guarded expression, subtle red accent light from one side suggesting guilt, sharp jawline shadows',
  ].join(', ');
}

function pickImageItem(json: ImageGenerationResponse): ImageGenerationItem | undefined {
  return json.data?.[0] ?? json.images?.[0];
}

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载生图结果失败 (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function generateImageBuffer(prompt: string): Promise<Buffer> {
  const res = await fetch(`${AI_CONFIG.baseURL}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AI_CONFIG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_CONFIG.imageModel,
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      image_size: '1024x1024',
      batch_size: 1,
      num_inference_steps: 20,
      guidance_scale: 7.5,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`生图 API 请求失败 (${res.status}): ${raw.slice(0, 300)}`);
  }

  let json: ImageGenerationResponse;
  try {
    json = JSON.parse(raw) as ImageGenerationResponse;
  } catch {
    throw new Error(`生图 API 返回非 JSON: ${raw.slice(0, 200)}`);
  }

  const item = pickImageItem(json);
  if (item?.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item?.url) {
    return downloadImageBuffer(item.url);
  }

  throw new Error('生图 API 未返回图片数据');
}

async function tryGenerateAndUpload(
  key: string,
  prompt: string,
  blob: ReturnType<typeof getBlob>,
): Promise<string | undefined> {
  try {
    const buf = await generateImageBuffer(prompt);
    return await blob.upload(key, buf, 'image/png');
  } catch (err) {
    console.warn(`[Image] 生图失败，跳过 ${key}:`, (err as Error).message);
    return undefined;
  }
}

export async function enrichCaseWithBlobImages(caseData: CaseData): Promise<CaseData> {
  try {
    assertImageApiConfigured();
  } catch (err) {
    console.warn('[Image] 未配置图片 API，跳过生图:', (err as Error).message);
    return caseData;
  }

  const blob = getBlob();
  const caseId = caseData.id;
  const started = Date.now();

  const [sceneImageUrl, victimImageUrl] = await Promise.all([
    tryGenerateAndUpload(`cases/${caseId}/scene.png`, buildScenePrompt(caseData), blob),
    tryGenerateAndUpload(`cases/${caseId}/victim.png`, buildVictimPrompt(caseData.victim), blob),
  ]);

  const suspects = await Promise.all(
    caseData.suspects.map(async (suspect, index) => {
      const url = await tryGenerateAndUpload(
        `cases/${caseId}/suspects/${suspect.id || `s${index + 1}`}.png`,
        buildSuspectPrompt(suspect),
        blob,
      );
      return url ? { ...suspect, imageUrl: url } : suspect;
    })
  );

  try {
    const db = getDatabase();
    await db.aiLogs.add({
      _id: generateId(),
      type: 'image',
      caseId,
      model: AI_CONFIG.imageModel,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: Date.now() - started,
      createdAt: now(),
    });
  } catch {
    // 日志写入失败不影响案件数据
  }

  return {
    ...caseData,
    ...(sceneImageUrl ? { sceneImageUrl } : {}),
    victim: victimImageUrl
      ? { ...caseData.victim, imageUrl: victimImageUrl }
      : caseData.victim,
    suspects,
  };
}
