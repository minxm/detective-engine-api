import { execSync } from 'node:child_process';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import {
  buildEnvMap,
  requireEnv,
  validateDeployEnvironment,
} from './deploy-env.js';

const TcbrClient = tencentcloud.tcbr.v20220217.Client;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCli(args: string) {
  execSync(`npx --yes @cloudbase/cli@latest ${args}`, {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
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
    const status = detail.BaseInfo?.Status ?? 'unknown';
    console.log(`Cloud Run status: ${status}`);
    if (status === 'running') return detail;
    if (status === 'failed' || status === 'error') {
      throw new Error(`Cloud Run deploy failed: ${status}`);
    }
    await sleep(10_000);
  }
  throw new Error('Timed out waiting for Cloud Run service to become running');
}

async function syncServerConfig(
  client: InstanceType<typeof TcbrClient>,
  envId: string,
  serverName: string,
  port: number
) {
  const detail = await client.DescribeCloudRunServerDetail({
    EnvId: envId,
    ServerName: serverName,
  });
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

  runCli(`login --apiKeyId ${secretId} --apiKey ${secretKey}`);
  runCli(`cloudrun deploy -e ${envId} -s ${serverName} --port ${port} --force`);

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
