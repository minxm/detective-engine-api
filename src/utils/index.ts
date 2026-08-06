export const AI_CONFIG = {
  apiKey: process.env.SILICONFLOW_API_KEY ?? '',
  baseURL: process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1',
  chatModel: process.env.AI_CHAT_MODEL ?? 'THUDM/GLM-4-9B-0414',
  caseModel: process.env.AI_CASE_MODEL ?? 'Qwen/Qwen3-8B',
  // 结案评分走网关，禁止默认用 R1 等慢速推理模型
  evaluateModel: process.env.AI_EVALUATE_MODEL ?? 'THUDM/GLM-4-9B-0414',
  imageModel: process.env.AI_IMAGE_MODEL ?? 'Kwai-Kolors/Kolors',
};

export function getAiConfigError(): string | null {
  if (!AI_CONFIG.apiKey) return 'SILICONFLOW_API_KEY 未配置';
  return null;
}

export function generateId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function now(): number {
  return Date.now();
}

export function getScoreRating(score: number): string {
  if (score >= 95) return '神探';
  if (score >= 85) return '资深侦探';
  if (score >= 70) return '优秀推理';
  if (score >= 55) return '合格侦探';
  if (score >= 40) return '需要练习';
  return '推理新手';
}

export function parseAuthUserId(headers: Record<string, string | undefined>): string | null {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token || token === 'anonymous') return null;
  return token;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function applyCorsHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    next.set(key, value);
  }
  return next;
}

export function withCors(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: applyCorsHeaders(response.headers),
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
