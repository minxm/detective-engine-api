export const AI_CONFIG = {
  apiKey: process.env.SILICONFLOW_API_KEY ?? '',
  baseURL: process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1',
  chatModel: process.env.AI_CHAT_MODEL ?? 'THUDM/GLM-4-9B-0414',
  caseModel: process.env.AI_CASE_MODEL ?? 'Qwen/Qwen3-8B',
  evaluateModel: process.env.AI_EVALUATE_MODEL ?? 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

export function verifyAdminSecret(headers: Record<string, string | undefined>): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const provided = headers['x-admin-secret'] ?? headers['X-Admin-Secret'];
  return provided === secret;
}
