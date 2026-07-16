import type { BlobAdapter } from './interface.js';
import { LocalBlobAdapter } from './local.js';
import { EdgeOneBlobAdapter } from './edgeone.js';
import { CloudBaseBlobAdapter } from './cloudbase.js';

let blobInstance: BlobAdapter | null = null;

function isCloudBaseConfigured(): boolean {
  return Boolean(process.env.TCB_ENV_ID && process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY);
}

function resolveBlobAdapter(): string {
  const raw = process.env.BLOB_ADAPTER?.trim();
  if (raw === 'local' && isCloudBaseConfigured() && (process.env.SCF_NAMESPACE || process.env.TENCENTCLOUD_RUNENV)) {
    console.warn('[Blob] SCF 环境不支持 local 存储，自动改用 cloudbase');
    return 'cloudbase';
  }
  if (raw) return raw;
  if (isCloudBaseConfigured()) return 'cloudbase';
  return 'local';
}

export function getBlob(): BlobAdapter {
  if (blobInstance) return blobInstance;

  const adapter = resolveBlobAdapter();
  const publicBase = process.env.BLOB_PUBLIC_BASE_URL ?? 'http://localhost:8787/blobs';

  switch (adapter) {
    case 'cloudbase':
      blobInstance = new CloudBaseBlobAdapter();
      break;
    case 'edgeone':
      blobInstance = new EdgeOneBlobAdapter({
        publicBaseUrl: publicBase,
        uploadUrl: process.env.EO_BLOB_UPLOAD_URL,
        uploadToken: process.env.EO_BLOB_UPLOAD_TOKEN,
        fallbackDir: process.env.SCF_NAMESPACE || process.env.TENCENTCLOUD_RUNENV ? '/tmp/blobs' : undefined,
      });
      break;
    case 'local':
    default:
      blobInstance = new LocalBlobAdapter('./data/blobs', publicBase);
      break;
  }

  return blobInstance;
}

export function resolveBlobAdapterName(): string {
  return resolveBlobAdapter();
}

export function resetBlobForTests() {
  blobInstance = null;
}

export type { BlobAdapter };
