import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlobAdapter } from './interface.js';

/**
 * EdgeOne Blob 适配器：
 * - 生产：通过 EO_BLOB_UPLOAD_URL 上传到 EdgeOne Pages Blob 网关
 * - 降级：写入本地目录并返回 BLOB_PUBLIC_BASE_URL 公开地址
 */
export class EdgeOneBlobAdapter implements BlobAdapter {
  private publicBaseUrl: string;
  private uploadUrl?: string;
  private uploadToken?: string;
  private fallbackDir: string;

  constructor(params: {
    publicBaseUrl: string;
    uploadUrl?: string;
    uploadToken?: string;
    fallbackDir?: string;
  }) {
    this.publicBaseUrl = params.publicBaseUrl.replace(/\/$/, '');
    this.uploadUrl = params.uploadUrl;
    this.uploadToken = params.uploadToken;
    this.fallbackDir = params.fallbackDir ?? './data/blobs';
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async upload(key: string, data: Buffer, contentType = 'image/png'): Promise<string> {
    if (this.uploadUrl) {
      try {
        const res = await fetch(this.uploadUrl.replace(/\/$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/'), {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            ...(this.uploadToken ? { Authorization: `Bearer ${this.uploadToken}` } : {}),
          },
          body: data,
        });
        if (res.ok) return this.getPublicUrl(key);
        throw new Error(`EdgeOne Blob 上传失败 (${res.status})`);
      } catch (error) {
        const message = (error as Error).message;
        if (process.env.SCF_NAMESPACE || process.env.TENCENTCLOUD_RUNENV) {
          throw new Error(`EdgeOne Blob 上传失败（SCF 无法写入本地）：${message}`);
        }
        console.warn('[Blob] EdgeOne upload error, fallback to local:', message);
      }
    } else if (process.env.SCF_NAMESPACE || process.env.TENCENTCLOUD_RUNENV) {
      throw new Error('SCF 环境需配置 EO_BLOB_UPLOAD_URL 或改用 BLOB_ADAPTER=cloudbase');
    }

    const filePath = path.join(this.fallbackDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return this.getPublicUrl(key);
  }
}
