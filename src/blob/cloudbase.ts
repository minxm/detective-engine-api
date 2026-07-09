import type { BlobAdapter } from './interface.js';
import { getCloudBaseApp } from '../db/cloudbase-client.js';

const CLOUD_PREFIX = 'case-images';
/** 临时链接最长 30 天（秒） */
const TEMP_URL_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * CloudBase 云存储：适用于 SCF 等无本地磁盘的环境。
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

    const urlRes = await app.getTempFileURL({
      fileList: [{ fileID, maxAge: TEMP_URL_MAX_AGE }],
    });
    const item = urlRes.fileList?.[0];
    const tempUrl = item?.tempFileURL;
    if (!tempUrl || item?.code !== 'SUCCESS') {
      throw new Error(item?.code ? `CloudBase 获取图片地址失败：${item.code}` : 'CloudBase 获取图片访问地址失败');
    }
    return tempUrl;
  }
}
