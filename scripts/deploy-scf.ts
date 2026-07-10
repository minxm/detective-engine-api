import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import { buildScfEnvironment, requireEnv, validateDeployEnvironment } from './deploy-env.js';

const ScfClient = tencentcloud.scf.v20180416.Client;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDeployFailure(res: Awaited<ReturnType<InstanceType<typeof ScfClient>['GetFunction']>>) {
  const parts = [
    res.StatusDesc,
    res.CodeError,
    res.CodeResult,
    res.StatusReasons?.map((item) => item.ErrorMessage || item.ErrorCode).filter(Boolean).join('; '),
  ].filter(Boolean);
  return parts.join(' | ') || res.Status || 'Unknown error';
}

async function waitForFunctionReady(
  client: InstanceType<typeof ScfClient>,
  functionName: string,
  namespace: string,
  maxWaitMs = 180_000
) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await client.GetFunction({ FunctionName: functionName, Namespace: namespace });
    const status = res.Status ?? 'Unknown';
    console.log(`Function status: ${status}`);
    if (status === 'Active') return;
    if (status === 'Failed' || status === 'CreateFailed' || status === 'UpdateFailed') {
      throw new Error(`Function deploy failed (${status}): ${formatDeployFailure(res)}`);
    }
    await sleep(5000);
  }
  throw new Error('Timed out waiting for function to become Active');
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 6,
  delayMs = 10_000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes('Updating') || message.includes('更新');
      if (!retryable || attempt === attempts) throw error;
      console.log(`${label} retry ${attempt}/${attempts - 1} in ${delayMs / 1000}s: ${message}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function main() {
  const secretId = requireEnv('TENCENT_SECRET_ID');
  const secretKey = requireEnv('TENCENT_SECRET_KEY');
  const region = requireEnv('SCF_REGION');
  const functionName = requireEnv('SCF_FUNCTION_NAME');
  const namespace = process.env.SCF_NAMESPACE?.trim() || 'default';
  validateDeployEnvironment();

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const zipPath = path.join(root, 'function.zip');
  const zipBuffer = readFileSync(zipPath);
  const zipMb = zipBuffer.byteLength / 1024 / 1024;
  console.log(`Package: ${zipPath} (${zipMb.toFixed(2)} MB)`);

  if (zipMb > 20) {
    throw new Error(
      `function.zip is ${zipMb.toFixed(2)} MB, exceeds SCF inline limit (20 MB). ` +
        'Reduce dependencies or configure COS upload.'
    );
  }

  const client = new ScfClient({
    credential: { secretId, secretKey },
    region,
  });

  console.log('Uploading function code (Web 函数 + scf_bootstrap)...');
  await client.UpdateFunctionCode({
    FunctionName: functionName,
    Namespace: namespace,
    ZipFile: zipBuffer.toString('base64'),
    Publish: 'TRUE',
  });

  console.log('Waiting for function code update to finish...');
  await waitForFunctionReady(client, functionName, namespace);

  console.log('Updating function configuration...');
  await withRetry('UpdateFunctionConfiguration', () =>
    client.UpdateFunctionConfiguration({
      FunctionName: functionName,
      Namespace: namespace,
      Timeout: 600,
      MemorySize: 1024,
      Environment: buildScfEnvironment(),
    })
  );

  console.log('Deploy complete.');
}

main().catch((error) => {
  console.error('[deploy-scf]', error instanceof Error ? error.message : error);
  process.exit(1);
});
