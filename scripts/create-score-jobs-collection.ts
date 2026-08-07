/**
 * 仅创建 score_jobs 集合（走 TCB 管理 API，比 node-sdk addCollection 更稳定）。
 * 用法：DB_ADAPTER=cloudbase tsx scripts/create-score-jobs-collection.ts
 */
import 'dotenv/config';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import { getCloudBaseDb } from '../src/db/cloudbase-client.js';

const TcbClient = tencentcloud.tcb.v20180608.Client;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createViaManagementApi(tableName: string): Promise<'created' | 'exists'> {
  const envId = process.env.TCB_ENV_ID;
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;
  const region = process.env.TCB_REGION ?? 'ap-shanghai';
  if (!envId || !secretId || !secretKey) {
    throw new Error('需要 TCB_ENV_ID、TCB_SECRET_ID、TCB_SECRET_KEY');
  }

  const client = new TcbClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } },
  });

  try {
    await client.CreateTable({ EnvId: envId, TableName: tableName });
    return 'created';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/exist|已存在|ResourceInUse|Duplicate|ALREADY/i.test(message)) return 'exists';
    throw error;
  }
}

async function createViaNodeSdk(tableName: string): Promise<'created' | 'exists'> {
  try {
    await getCloudBaseDb().createCollection(tableName);
    return 'created';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/exist|已存在|ResourceInUse/i.test(message)) return 'exists';
    throw error;
  }
}

async function main() {
  const tableName = 'score_jobs';
  const attempts = 5;

  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await createViaManagementApi(tableName);
      console.log(`[ok] ${tableName} ${result === 'created' ? 'created' : 'already exists'} (management API, attempt ${i})`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] management API attempt ${i}: ${message}`);
      await sleep(3000 * i);
    }
  }

  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await createViaNodeSdk(tableName);
      console.log(`[ok] ${tableName} ${result === 'created' ? 'created' : 'already exists'} (node-sdk, attempt ${i})`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] node-sdk attempt ${i}: ${message}`);
      await sleep(3000 * i);
    }
  }

  throw new Error(`Failed to create ${tableName} after ${attempts} attempts on both APIs`);
}

main().catch((error) => {
  console.error('[create-score-jobs-collection]', error instanceof Error ? error.message : error);
  process.exit(1);
});
