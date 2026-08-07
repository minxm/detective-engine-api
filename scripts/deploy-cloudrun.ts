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

function runTcb(argv: string[], opts?: { stdinNewlines?: boolean }) {
  const env = { ...process.env, CI: 'true', FORCE_COLOR: '0' };
  const onGitHub = Boolean(process.env.GITHUB_ACTIONS);
  const safeArgs = argv.map((a) => (/^AKID/.test(a) ? '***' : a)).join(' ');
  const stdio: ['pipe' | 'inherit', 'inherit', 'inherit'] = opts?.stdinNewlines
    ? ['pipe', 'inherit', 'inherit']
    : ['inherit', 'inherit', 'inherit'];
  const input = opts?.stdinNewlines ? Buffer.from('\n\n') : undefined;

  if (onGitHub) {
    let result = spawnSync('tcb', argv, { stdio, env, shell: true, input });
    if (result.status === 0) return 0;
    result = spawnSync('npx', ['--yes', '-p', '@cloudbase/cli', 'tcb', ...argv], {
      stdio,
      env,
      shell: true,
      input,
    });
    if (result.status !== 0) {
      throw new Error(`tcb ${safeArgs} failed with exit code ${result.status ?? 'unknown'}`);
    }
    return 0;
  }

  const quoted = argv.map(shellQuote).join(' ');
  const command =
    process.platform === 'win32' ? `echo.| tcb ${quoted}` : `printf '\\n' | tcb ${quoted}`;
  let result = spawnSync(command, { stdio: 'inherit', env, shell: true });
  if (result.status === 0) return 0;

  const npxCmd =
    process.platform === 'win32'
      ? `echo.| npx --yes -p @cloudbase/cli tcb ${quoted}`
      : `printf '\\n' | npx --yes -p @cloudbase/cli tcb ${quoted}`;
  result = spawnSync(npxCmd, { stdio: 'inherit', env, shell: true });
  if (result.status !== 0) {
    throw new Error(`tcb ${safeArgs} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return 0;
}

function runCli(argv: string[], opts?: { yes?: boolean; stdinNewlines?: boolean }) {
  const args = opts?.yes ? ['--yes', ...argv] : argv;
  runTcb(args, { stdinNewlines: opts?.stdinNewlines });
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

async function waitForServerReady(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  maxWaitMs = 300_000,
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

async function syncServerEnv(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  port: number,
  imageUrl: string,
) {
  const envMap = buildEnvMap();
  console.log(`Syncing ${Object.keys(envMap).length} environment variables onto ${imageUrl}`);

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
}

function serviceBaseUrl(domain: string): string {
  return domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain.replace(/\/$/, '')}`;
}

async function waitForLiveBuild(domain: string, expectedBuildSha: string | undefined, maxWaitMs = 600_000) {
  const base = serviceBaseUrl(domain);
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const healthRes = await fetch(`${base}/health`);
      if (!healthRes.ok) {
        console.log(`Waiting for /health (${healthRes.status})...`);
        await sleep(15_000);
        continue;
      }
      const health = (await healthRes.json()) as { buildSha?: string | null };
      const usersRes = await fetch(`${base}/api/admin/users?page=1&limit=1`);
      const buildOk = !expectedBuildSha || health.buildSha === expectedBuildSha;
      const routeOk = usersRes.status !== 404;
      console.log(
        `Probe: buildSha=${health.buildSha ?? 'null'} admin/users=${usersRes.status} buildOk=${buildOk} routeOk=${routeOk}`,
      );
      if (buildOk && routeOk) {
        console.log('Deploy verification ok');
        return;
      }
    } catch (error) {
      console.log(`Probe failed: ${(error as Error).message}`);
    }
    await sleep(15_000);
  }

  throw new Error(
    expectedBuildSha
      ? `Deploy verification timed out: expected buildSha ${expectedBuildSha}`
      : 'Deploy verification timed out: /api/admin/users still unavailable',
  );
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

  runCli(
    [
      'cloudrun',
      'deploy',
      '-e',
      envId,
      '-s',
      serverName,
      '--port',
      String(port),
      '--source',
      '.',
      '--force',
    ],
    { yes: true, stdinNewlines: true },
  );

  await waitForServerReady(client, envId, serverName, 600_000);

  const detail = await client.DescribeCloudRunServerDetail({ EnvId: envId, ServerName: serverName });
  const domain = detail.BaseInfo?.DefaultDomainName;
  const expectedBuildSha = existsSync(path.join(ROOT, 'dist/BUILD_SHA.txt'))
    ? readFileSync(path.join(ROOT, 'dist/BUILD_SHA.txt'), 'utf8').trim()
    : process.env.GITHUB_SHA?.trim();

  if (!domain) {
    throw new Error('Deploy finished but DefaultDomainName is missing');
  }

  console.log(`Cloud Run URL: ${domain}`);
  console.log(`API base (set VITE_API_BASE): ${domain}/api`);
  try {
    await waitForLiveBuild(domain, expectedBuildSha, 180_000);
  } catch (error) {
    console.warn('[deploy-cloudrun] Post-deploy verification warning:', (error as Error).message);
  }
}

main().catch((error) => {
  console.error('[deploy-cloudrun]', error instanceof Error ? error.message : error);
  process.exit(1);
});
