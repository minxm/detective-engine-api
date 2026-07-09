import cloudbase from '@cloudbase/node-sdk';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import type { Db } from '@cloudbase/database';

const TcbClient = tencentcloud.tcb.v20180608.Client;

let appInstance: ReturnType<typeof cloudbase.init> | null = null;
let dbInstance: Db | null = null;

export function getCloudBaseApp() {
  if (appInstance) return appInstance;

  const env = process.env.TCB_ENV_ID;
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;
  if (!env || !secretId || !secretKey) {
    throw new Error('DB_ADAPTER=cloudbase 需要配置 TCB_ENV_ID、TCB_SECRET_ID、TCB_SECRET_KEY');
  }

  appInstance = cloudbase.init({
    env,
    secretId,
    secretKey,
    region: process.env.TCB_REGION ?? 'ap-shanghai',
  });

  return appInstance;
}

export function getCloudBaseDb(): Db {
  if (dbInstance) return dbInstance;
  dbInstance = getCloudBaseApp().database();
  return dbInstance;
}

/** 通过 TCB 管理 API 删除文档型数据库集合 */
export async function deleteCloudBaseCollection(collectionName: string): Promise<{ missing: boolean }> {
  const envId = process.env.TCB_ENV_ID;
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;
  const region = process.env.TCB_REGION ?? 'ap-shanghai';
  if (!envId || !secretId || !secretKey) {
    throw new Error('删除集合需要 TCB_ENV_ID、TCB_SECRET_ID、TCB_SECRET_KEY');
  }

  const client = new TcbClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } },
  });

  try {
    await client.DeleteTable({ EnvId: envId, TableName: collectionName });
    return { missing: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not exist|不存在|NOT_EXIST|ResourceNotFound|NoSuchTable/i.test(message)) {
      return { missing: true };
    }
    throw error;
  }
}
