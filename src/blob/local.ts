import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlobAdapter } from './interface.js';

export class LocalBlobAdapter implements BlobAdapter {
  private rootDir: string;
  private publicBaseUrl: string;

  constructor(rootDir = './data/blobs', publicBaseUrl = 'http://localhost:8787/blobs') {
    this.rootDir = rootDir;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
  }

  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async upload(key: string, data: Buffer, _contentType = 'image/png'): Promise<string> {
    const filePath = path.join(this.rootDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return this.getPublicUrl(key);
  }
}
