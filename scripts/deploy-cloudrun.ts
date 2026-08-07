import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import {
  buildEnvMap,
  requireEnv,
  validateDeployEnvironment,
} from './deploy-env.js';

const TcbrClient = tencentcloud.tcbr.v20220217.Client;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeCloudbaserc(envId: string, serverName: string) {
  const config = {
    envId,
    cloudrun: {
      name: serverName,
    },
  };
  const target = path.join(ROOT, 'cloudbaserc.json');
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${target} with envId=${envId}`);
}

function shellQuote(arg: string): string {
  if (process.platform === 'win32') {
    return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
  }
  return /[^A-Za-z0-9_\/:=+.,@%-]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}

function runTcb(argv: string[]): number {
  const env = { ...process.env, CI: 'true', FORCE_COLOR: '0' };
  const onGitHub = Boolean(process.env.GITHUB_ACTIONS);
  const safeArgs = argv.map((a) => (/^AKID/.test(a) ? '***' : a)).join(' ');

  // GitHub Actions 无 TTY：直接 inherit，避免管道 EOF 干扰上传
  if (onGitHub) {
    let result = spawnSync('tcb', argv, { stdio: 'inherit', env, shell: true });
    if (result.status === 0) return 0;
    result = spawnSync('npx', ['--yes', '-p', '@cloudbase/cli', 'tcb', ...argv], {
      stdio: 'inherit',
      env,
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`tcb ${safeArgs} failed with exit code ${result.status ?? 'unknown'}`);
    }
    return 0;
  }

  // 本地 Windows：--force 仍可能弹出灰度确认，用 echo.| 选默认「否」
  const args = argv.map(shellQuote).join(' ');
  const command =
    process.platform === 'win32' ? `echo.| tcb ${args}` : `printf '\\n' | tcb ${args}`;
  let result = spawnSync(command, { stdio: 'inherit', env, shell: true });
  if (result.status === 0) return 0;

  const npxCmd =
    process.platform === 'win32'
      ? `echo.| npx --yes -p @cloudbase/cli tcb ${args}`
      : `printf '\\n' | npx --yes -p @cloudbase/cli tcb ${args}`;
  result = spawnSync(npxCmd, { stdio: 'inherit', env, shell: true });
  if (result.status !== 0) {
    throw new Error(`tcb ${safeArgs} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return 0;
}

function runCli(argv: string[]) {
  runTcb(argv);
}

const READY_STATUSES = new Set(['normal', 'running']);
const FAILED_STATUSES = new Set([
  'create_failed',
  'freeze_fail',
  'delete_failed',
  'abnormal',
  'failed',
  'error',
]);

type OnlineVersion = {
  VersionName?: string;
  ImageUrl?: string;
  FlowRatio?: string;
};

function pickPrimaryOnlineVersion(versions: OnlineVersion[] | undefined): OnlineVersion | undefined {
  if (!versions?.length) return undefined;
  return [...versions].sort((a, b) => Number(b.FlowRatio ?? 0) - Number(a.FlowRatio ?? 0))[0];
}

async function getPrimaryOnlineVersion(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
): Promise<OnlineVersion | undefined> {
  const detail = await client.DescribeCloudRunServerDetail({ EnvId: envId, ServerName: serverName });
  return pickPrimaryOnlineVersion(detail.OnlineVersionInfos);
}

async function waitForNewOnlineVersion(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  previous: OnlineVersion | undefined,
  maxWaitMs = 300_000,
): Promise<OnlineVersion> {
  const previousKey = `${previous?.VersionName ?? ''}|${previous?.ImageUrl ?? ''}`;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const current = await getPrimaryOnlineVersion(client, envId, serverName);
    const currentKey = `${current?.VersionName ?? ''}|${current?.ImageUrl ?? ''}`;
    if (current?.ImageUrl?.trim() && currentKey !== previousKey) {
      console.log(
        `Online version switched: ${previous?.VersionName ?? '(none)'} -> ${current?.VersionName ?? '(unknown)'}`,
      );
      return current;
    }
    await sleep(10_000);
  }

  const fallback = await getPrimaryOnlineVersion(client, envId, serverName);
  if (fallback?.ImageUrl?.trim()) {
    console.warn('[deploy-cloudrun] Online version did not change after deploy; continuing with current online version');
    return fallback;
  }
  throw new Error('Timed out waiting for online Cloud Run version after deploy');
}

async function waitForServerReady(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  maxWaitMs = 300_000
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const detail = await client.DescribeCloudRunServerDetail({
      EnvId: envId,
      ServerName: serverName,
    });
    const status = (detail.BaseInfo?.Status ?? 'unknown').toLowerCase();
    const onlineCount = detail.OnlineVersionInfos?.length ?? 0;
    console.log(`Cloud Run status: ${status} (online versions: ${onlineCount})`);
    if (READY_STATUSES.has(status)) return detail;
    if (FAILED_STATUSES.has(status)) {
      throw new Error(`Cloud Run deploy failed: ${status}`);
    }
    await sleep(10_000);
  }
  throw new Error('Timed out waiting for Cloud Run service to become ready');
}

async function syncServerConfig(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  port: number,
  imageUrl: string,
) {
  const envMap = buildEnvMap();
  console.log(`Syncing ${Object.keys(envMap).length} environment variables to ${imageUrl}`);

  await client.UpdateCloudRunServer({
    EnvId: envId,
    ServerName: serverName,
    Business: 'tcb',
    DeployInfo: {
      DeployType: 'image',
      ImageUrl: imageUrl,
      ReleaseType: 'FULL',
    },
    Items: [
      { Key: 'EnvParam', Value: JSON.stringify(envMap) },
      { Key: 'Port', IntValue: port },
      { Key: 'MemSpecs', FloatValue: 2 },
      { Key: 'CpuSpecs', FloatValue: 1 },
      { Key: 'MinNum', IntValue: 0 },
      { Key: 'MaxNum', IntValue: 5 },
    ],
  });

  return client.DescribeCloudRunServerDetail({ EnvId: envId, ServerName: serverName });
}

async function verifyDeployedService(domain: string, expectedBuildSha?: string) {
  const base = domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain.replace(/\/$/, '')}`;
  const healthRes = await fetch(`${base}/health`);
  if (!healthRes.ok) {
    throw new Error(`Deploy verification failed: /health returned ${healthRes.status}`);
  }
  const health = (await healthRes.json()) as { buildSha?: string | null };
  if (expectedBuildSha && health.buildSha !== expectedBuildSha) {
    throw new Error(
      `Deploy verification failed: expected buildSha ${expectedBuildSha}, got ${health.buildSha ?? 'null'}`,
    );
  }

  const usersRes = await fetch(`${base}/api/admin/users?page=1&limit=1`);
  if (usersRes.status === 404) {
    throw new Error('Deploy verification failed: GET /api/admin/users still returns 404');
  }
  console.log(`Deploy verification ok: buildSha=${health.buildSha ?? 'null'}, admin/users=${usersRes.status}`);
}

async function main() {
  const secretId = requireEnv('TENCENT_SECRET_ID');
  const secretKey = requireEnv('TENCENT_SECRET_KEY');
  const envId = requireEnv('TCB_ENV_ID');
  const serverName = process.env.CLOUDRUN_SERVICE_NAME?.trim() || 'detective-engine-api';
  const port = Number(process.env.CLOUDRUN_PORT ?? 9000);

  validateDeployEnvironment();

  console.log(`Deploying to Cloud Run: env=${envId}, service=${serverName}, port=${port}`);
  writeCloudbaserc(envId, serverName);

  const client = new TcbrClient({
    credential: { secretId, secretKey },
    region: 'ap-shanghai',
  });

  const previousOnline = await getPrimaryOnlineVersion(client, envId, serverName);
  console.log(
    `Previous online version: ${previousOnline?.VersionName ?? '(none)'} image=${previousOnline?.ImageUrl ?? '(none)'}`,
  );

  runCli(['login', '--apiKeyId', secretId, '--apiKey', secretKey]);
  runCli(['cloudrun', 'deploy', '-e', envId, '-s', serverName, '--port', String(port), '--force']);

  await waitForServerReady(client, envId, serverName);
  const online = await waitForNewOnlineVersion(client, envId, serverName, previousOnline);
  const imageUrl = online.ImageUrl?.trim();
  if (!imageUrl) {
    throw new Error('Online version has no image URL after deploy');
  }

  const detail = await syncServerConfig(client, envId, serverName, port, imageUrl);
  await waitForServerReady(client, envId, serverName);

  const domain = detail.BaseInfo?.DefaultDomainName;
  const expectedBuildSha = existsSync(path.join(ROOT, 'dist/BUILD_SHA.txt'))
    ? readFileSync(path.join(ROOT, 'dist/BUILD_SHA.txt'), 'utf8').trim()
    : undefined;

  if (domain) {
    console.log(`Cloud Run URL: ${domain}`);
    console.log(`API base (set VITE_API_BASE): ${domain}/api`);
    await verifyDeployedService(domain, expectedBuildSha);
  } else {
    console.log('Deploy complete. Check CloudBase console for DefaultDomainName.');
  }
}

main().catch((error) => {
  console.error('[deploy-cloudrun]', error instanceof Error ? error.message : error);
  process.exit(1);
});
