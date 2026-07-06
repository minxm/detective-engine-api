import type { BlobAdapter } from './interface.js';
import { LocalBlobAdapter } from './local.js';
import { EdgeOneBlobAdapter } from './edgeone.js';

let blobInstance: BlobAdapter | null = null;

export function getBlob(): BlobAdapter {
  if (blobInstance) return blobInstance;

  const adapter = process.env.BLOB_ADAPTER ?? 'local';
  const publicBase = process.env.BLOB_PUBLIC_BASE_URL ?? 'http://localhost:8787/blobs';

  if (adapter === 'edgeone') {
    blobInstance = new EdgeOneBlobAdapter({
      publicBaseUrl: publicBase,
      uploadUrl: process.env.EO_BLOB_UPLOAD_URL,
      uploadToken: process.env.EO_BLOB_UPLOAD_TOKEN,
    });
  } else {
    blobInstance = new LocalBlobAdapter('./data/blobs', publicBase);
  }

  return blobInstance;
}

export function resetBlobForTests() {
  blobInstance = null;
}

export type { BlobAdapter };
