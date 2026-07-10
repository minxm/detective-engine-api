export const ENV_KEYS = [
  'SILICONFLOW_API_KEY',
  'SILICONFLOW_BASE_URL',
  'AI_CHAT_MODEL',
  'AI_CASE_MODEL',
  'AI_EVALUATE_MODEL',
  'AI_IMAGE_MODEL',
  'TCB_ENV_ID',
  'TCB_PUBLIC_ENV_ID',
  'TCB_REGION',
  'TCB_SECRET_ID',
  'TCB_SECRET_KEY',
  'DB_ADAPTER',
  'MONGODB_URI',
  'MONGODB_DB',
  'KV_ADAPTER',
  'EO_SECRET_ID',
  'EO_SECRET_KEY',
  'EO_ZONE_ID',
  'KV_NAMESPACE',
  'BLOB_ADAPTER',
  'BLOB_PUBLIC_BASE_URL',
  'EO_BLOB_UPLOAD_URL',
  'EO_BLOB_UPLOAD_TOKEN',
] as const;

const DEFAULTS: Record<string, string> = {
  SILICONFLOW_BASE_URL: 'https://api.siliconflow.cn/v1',
  AI_CHAT_MODEL: 'THUDM/GLM-4-9B-0414',
  AI_CASE_MODEL: 'Qwen/Qwen3-8B',
  AI_EVALUATE_MODEL: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
  AI_IMAGE_MODEL: 'Kwai-Kolors/Kolors',
  TCB_REGION: 'ap-shanghai',
  DB_ADAPTER: 'cloudbase',
  KV_ADAPTER: 'memory',
  BLOB_ADAPTER: 'cloudbase',
};

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function resolveDbAdapter(): string {
  const raw = process.env.DB_ADAPTER?.trim();
  if (raw === 'mongodb' && !process.env.MONGODB_URI?.trim()) {
    console.warn('[deploy] DB_ADAPTER=mongodb 但未配置 MONGODB_URI，改用 cloudbase');
    return 'cloudbase';
  }
  return raw || DEFAULTS.DB_ADAPTER;
}

export function resolveBlobAdapter(): string {
  const raw = process.env.BLOB_ADAPTER?.trim();
  if (raw === 'local' && resolveDbAdapter() === 'cloudbase') {
    console.warn('[deploy] BLOB_ADAPTER=local 在 CloudBase 生产环境不适用，改用 cloudbase');
    return 'cloudbase';
  }
  if (raw) return raw;
  if (resolveDbAdapter() === 'cloudbase') return 'cloudbase';
  return DEFAULTS.BLOB_ADAPTER;
}

export function validateDeployEnvironment() {
  const dbAdapter = resolveDbAdapter();
  if (dbAdapter === 'cloudbase') {
    requireEnv('TCB_ENV_ID');
    requireEnv('TCB_SECRET_ID');
    requireEnv('TCB_SECRET_KEY');
  }
  if (dbAdapter === 'mongodb') {
    requireEnv('MONGODB_URI');
  }
  const blobAdapter = resolveBlobAdapter();
  if (blobAdapter === 'local') {
    throw new Error('生产部署不能使用 BLOB_ADAPTER=local，请使用 cloudbase 或 edgeone');
  }
}

export function buildEnvMap(): Record<string, string> {
  const dbAdapter = resolveDbAdapter();
  const blobAdapter = resolveBlobAdapter();
  const map: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: process.env.CLOUDRUN_PORT?.trim() || process.env.PORT?.trim() || '9000',
  };

  for (const key of ENV_KEYS) {
    if (key === 'DB_ADAPTER') {
      map[key] = dbAdapter;
      continue;
    }
    if (key === 'BLOB_ADAPTER') {
      map[key] = blobAdapter;
      continue;
    }
    const value = process.env[key]?.trim() || DEFAULTS[key];
    if (value) map[key] = value;
  }

  return map;
}

export function buildScfEnvironment() {
  const variables = Object.entries(buildEnvMap())
    .filter(([key]) => key !== 'NODE_ENV' && key !== 'PORT')
    .map(([Key, Value]) => ({ Key, Value }));
  return { Variables: variables };
}
