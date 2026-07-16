import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
  port: number
) {
  let detail = await client.DescribeCloudRunServerDetail({
    EnvId: envId,
    ServerName: serverName,
  });

  const imageDeadline = Date.now() + 120_000;
  while (!detail.OnlineVersionInfos?.[0]?.ImageUrl?.trim() && Date.now() < imageDeadline) {
    console.log('Waiting for online version image URL...');
    await sleep(10_000);
    detail = await client.DescribeCloudRunServerDetail({ EnvId: envId, ServerName: serverName });
  }

  const online = detail.OnlineVersionInfos?.[0];
  const imageUrl = online?.ImageUrl?.trim();
  if (!imageUrl) {
    console.warn('[deploy-cloudrun] 未找到在线版本镜像，跳过环境变量同步（请在控制台手动配置）');
    return detail;
  }

  const envMap = buildEnvMap();
  console.log(`Syncing ${Object.keys(envMap).length} environment variables...`);

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

async function main() {
  const secretId = requireEnv('TENCENT_SECRET_ID');
  const secretKey = requireEnv('TENCENT_SECRET_KEY');
  const envId = requireEnv('TCB_ENV_ID');
  const serverName = process.env.CLOUDRUN_SERVICE_NAME?.trim() || 'detective-engine-api';
  const port = Number(process.env.CLOUDRUN_PORT ?? 9000);

  validateDeployEnvironment();

  console.log(`Deploying to Cloud Run: env=${envId}, service=${serverName}, port=${port}`);
  writeCloudbaserc(envId, serverName);

  runCli(['login', '--apiKeyId', secretId, '--apiKey', secretKey]);
  runCli(['cloudrun', 'deploy', '-e', envId, '-s', serverName, '--port', String(port), '--force']);

  const client = new TcbrClient({
    credential: { secretId, secretKey },
    region: 'ap-shanghai',
  });

  await waitForServerReady(client, envId, serverName);
  const detail = await syncServerConfig(client, envId, serverName, port);

  const domain = detail.BaseInfo?.DefaultDomainName;
  if (domain) {
    console.log(`Cloud Run URL: ${domain}`);
    console.log(`API base (set VITE_API_BASE): ${domain}/api`);
  } else {
    console.log('Deploy complete. Check CloudBase console for DefaultDomainName.');
  }
}

main().catch((error) => {
  console.error('[deploy-cloudrun]', error instanceof Error ? error.message : error);
  process.exit(1);
});
