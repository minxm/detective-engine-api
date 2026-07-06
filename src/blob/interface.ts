export interface BlobAdapter {
  upload(key: string, data: Buffer, contentType?: string): Promise<string>;
  getPublicUrl(key: string): string;
}
