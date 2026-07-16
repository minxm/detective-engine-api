import type { BlobAdapter } from './interface.js';
import { getCloudBaseApp } from '../db/cloudbase-client.js';

const CLOUD_PREFIX = 'case-images';

/**
 * CloudBase 云存储：适用于 SCF 等无本地磁盘的环境。
 * upload 返回 cloud:// fileID，由 withFreshCaseImageUrls 在出站时签发临时访问链。
 */
export class CloudBaseBlobAdapter implements BlobAdapter {
  getPublicUrl(key: string): string {
    const env = process.env.TCB_ENV_ID ?? '';
    const cloudPath = `${CLOUD_PREFIX}/${key}`;
    return `cloud://${env}/${cloudPath}`;
  }

  async upload(key: string, data: Buffer, _contentType = 'image/png'): Promise<string> {
    const app = getCloudBaseApp();
    const cloudPath = `${CLOUD_PREFIX}/${key}`;
    const uploaded = await app.uploadFile({ cloudPath, fileContent: data });
    const fileID = uploaded.fileID;
    if (!fileID) {
      throw new Error('CloudBase 上传成功但未返回 fileID');
    }
    return fileID;
  }
}
