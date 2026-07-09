import { AI_CONFIG, generateId, getAiConfigError, now } from '../utils/index.js';
import { getBlob } from '../blob/index.js';
import { getDatabase } from '../db/index.js';
import { isTransientNetworkError, sleep } from '../utils/retry.js';
import type { CaseData, Suspect } from '../types/index.js';

type ImageGenerationItem = {
  url?: string;
  b64_json?: string;
};

type ImageGenerationResponse = {
  data?: ImageGenerationItem[];
  images?: ImageGenerationItem[];
};

/** SiliconFlow 图像模型默认约 2 IPM，并发请求会 429 导致失败 */
const IMAGES_PER_MINUTE = Math.max(1, Number(process.env.AI_IMAGE_IPM ?? 2) || 2);
const IMAGE_RETRY_MAX = Math.max(3, Number(process.env.AI_IMAGE_RETRY_MAX ?? 5) || 5);
const IMAGE_RETRY_BASE_MS = 12_000;
const IMAGE_API_TIMEOUT_MS = Math.max(60_000, Number(process.env.AI_IMAGE_TIMEOUT_MS ?? 180_000) || 180_000);
const IMAGE_DOWNLOAD_TIMEOUT_MS = 90_000;

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

const SCENE_STYLE =
  `${BASE_STYLE}, wide establishing shot, environmental storytelling, ` +
  'moody atmospheric haze, neon reflections on wet surfaces, crime scene tape glow';

const PORTRAIT_STYLE =
  `${BASE_STYLE}, half-body portrait, cold cyan rim light on edges, ` +
  'dark vignette background, intelligence dossier style, tense expression';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 滑动窗口限流，避免触发 IPM 429 */
class ImageRateLimiter {
  private timestamps: number[] = [];

  async acquire(): Promise<void> {
    const windowMs = 60_000;
    while (true) {
      const nowMs = Date.now();
      this.timestamps = this.timestamps.filter((t) => nowMs - t < windowMs);
      if (this.timestamps.length < IMAGES_PER_MINUTE) {
        this.timestamps.push(nowMs);
        return;
      }
      const waitMs = windowMs - (nowMs - this.timestamps[0]) + 500;
      console.info(`[Image] 生图限流等待 ${Math.ceil(waitMs / 1000)}s（${IMAGES_PER_MINUTE} IPM）`);
      await sleep(waitMs);
    }
  }
}

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
  const sceneDesc = (caseData.sceneDescription ?? '').slice(0, 120);
  return [
    SCENE_STYLE,
    `crime scene: ${caseData.setting || '案发现场'}`,
    sceneDesc,
    'abandoned or isolated location, evidence markers with faint cyan glow, deep shadows',
    'ultra-wide angle, oppressive tension, intricate environmental details',
  ].join(', ');
}

function buildVictimPrompt(victim: CaseData['victim']): string {
  const gender = genderLabel(victim.gender);
  const background = (victim.background ?? '身份背景待查').slice(0, 80);
  const age = victim.age ?? 35;
  const occupation = victim.occupation ?? '未知职业';
  return [
    PORTRAIT_STYLE,
    `victim character: ${victim.name}`,
    `${gender}, age ${age}, occupation: ${occupation}`,
    background,
    'pale cold lighting suggesting tragedy, muted desaturated tones, sorrowful undertone',
  ].join(', ');
}

function buildSuspectPrompt(suspect: Suspect): string {
  const gender = genderLabel(suspect.gender);
  const age = suspect.age ?? 30;
  const occupation = suspect.occupation ?? '未知职业';
  const personality = suspect.personality ?? '神情难测';
  return [
    PORTRAIT_STYLE,
    `suspect character: ${suspect.name}`,
    `${gender}, age ${age}, occupation: ${occupation}`,
    `personality: ${personality}`,
    'guarded expression, subtle red accent light from one side suggesting guilt, sharp jawline shadows',
  ].join(', ');
}

function pickImageItem(json: ImageGenerationResponse): ImageGenerationItem | undefined {
  return json.data?.[0] ?? json.images?.[0];
}

function isRateLimitError(message: string): boolean {
  return /429|rate limit|TPM|IPM|too many/i.test(message);
}

function isRetryableImageError(message: string): boolean {
  if (isRateLimitError(message) || isTransientNetworkError(message)) return true;
  return /5\d{2}|下载生图|未返回图片|请求超时|timeout|aborted|fetch failed|empty/i.test(message);
}

function isFatalImageError(message: string): boolean {
  return /401|403|invalid api key|余额|quota|insufficient/i.test(message);
}

async function downloadImageBuffer(url: string): Promise<Buffer> {
  let lastError = '';
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, IMAGE_DOWNLOAD_TIMEOUT_MS);
      if (!res.ok) {
        throw new Error(`下载生图结果失败 (${res.status})`);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < 2 && isRetryableImageError(lastError)) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error(lastError || '下载生图结果失败');
}

async function generateImageBuffer(prompt: string): Promise<Buffer> {
  const res = await fetchWithTimeout(
    `${AI_CONFIG.baseURL}/images/generations`,
    {
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
    },
    IMAGE_API_TIMEOUT_MS,
  );

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

type ImageUploadResult = { url?: string; error?: string };

async function tryGenerateAndUpload(
  key: string,
  prompt: string,
  blob: ReturnType<typeof getBlob>,
  limiter: ImageRateLimiter,
): Promise<ImageUploadResult> {
  let lastError = '未知错误';

  for (let attempt = 0; attempt <= IMAGE_RETRY_MAX; attempt++) {
    await limiter.acquire();
    try {
      const buf = await generateImageBuffer(prompt);
      const url = await blob.upload(key, buf, 'image/png');
      console.info(`[Image] 生图成功: ${key}`);
      return { url };
    } catch (err) {
      lastError = (err as Error).message || '未知错误';
      if (isFatalImageError(lastError)) {
        console.warn(`[Image] 生图致命错误，放弃 ${key}:`, lastError);
        return { error: lastError };
      }
      if (isRetryableImageError(lastError) && attempt < IMAGE_RETRY_MAX) {
        const waitMs = IMAGE_RETRY_BASE_MS * (attempt + 1);
        console.warn(
          `[Image] 生图失败，${Math.ceil(waitMs / 1000)}s 后重试 ${key} (${attempt + 1}/${IMAGE_RETRY_MAX}): ${lastError}`,
        );
        await sleep(waitMs);
        continue;
      }
      console.warn(`[Image] 生图放弃 ${key}:`, lastError);
      return { error: lastError };
    }
  }

  return { error: lastError };
}

export async function enrichCaseWithBlobImages(caseData: CaseData): Promise<CaseData> {
  assertImageApiConfigured();

  const blob = getBlob();
  const caseId = caseData.id;
  const started = Date.now();
  const limiter = new ImageRateLimiter();

  const sceneResult = await tryGenerateAndUpload(
    `cases/${caseId}/scene.png`,
    buildScenePrompt(caseData),
    blob,
    limiter,
  );

  const victimResult = await tryGenerateAndUpload(
    `cases/${caseId}/victim.png`,
    buildVictimPrompt(caseData.victim),
    blob,
    limiter,
  );

  const suspects: Suspect[] = [];
  const suspectResults: ImageUploadResult[] = [];
  for (const [index, suspect] of caseData.suspects.entries()) {
    const result = await tryGenerateAndUpload(
      `cases/${caseId}/suspects/${suspect.id || `s${index + 1}`}.png`,
      buildSuspectPrompt(suspect),
      blob,
      limiter,
    );
    suspectResults.push(result);
    suspects.push(result.url ? { ...suspect, imageUrl: result.url } : suspect);
  }

  const failures: string[] = [];
  if (!sceneResult.url) {
    failures.push(`场景图${sceneResult.error ? `：${sceneResult.error}` : ''}`);
  }
  if (!victimResult.url) {
    failures.push(`受害人（${caseData.victim.name}）${victimResult.error ? `：${victimResult.error}` : ''}`);
  }
  for (const [index, suspect] of caseData.suspects.entries()) {
    const result = suspectResults[index];
    if (!result?.url) {
      failures.push(`嫌疑人（${suspect.name}）${result?.error ? `：${result.error}` : ''}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`生图未完成，案件未入库：${failures.join('；')}。请稍后重新生成。`);
  }

  console.info(
    `[Image] 案件 ${caseId} 生图全部完成（${2 + caseData.suspects.length} 张），耗时 ${Date.now() - started}ms`
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
    sceneImageUrl: sceneResult.url!,
    victim: { ...caseData.victim, imageUrl: victimResult.url! },
    suspects,
  };
}
