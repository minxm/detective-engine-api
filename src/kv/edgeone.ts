import tencentcloud from 'tencentcloud-sdk-nodejs';
import type { KvAdapter } from './interface.js';

const TeoClient = tencentcloud.teo.v20220901.Client;

export class EdgeOneKvAdapter implements KvAdapter {
  private client: InstanceType<typeof TeoClient>;
  private zoneId: string;
  private namespace: string;

  constructor(params: {
    secretId: string;
    secretKey: string;
    zoneId: string;
    namespace: string;
    region?: string;
  }) {
    this.zoneId = params.zoneId;
    this.namespace = params.namespace;
    this.client = new TeoClient({
      credential: { secretId: params.secretId, secretKey: params.secretKey },
      region: params.region ?? '',
      profile: { httpProfile: { endpoint: 'teo.tencentcloudapi.com' } },
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      const res = await this.client.EdgeKVGet({
        ZoneId: this.zoneId,
        Namespace: this.namespace,
        Keys: [key],
      });
      const value = res.Data?.[0]?.Value;
      return value ? value : null;
    } catch (error) {
      const msg = (error as Error).message ?? '';
      if (msg.includes('NotFound') || msg.includes('not exist')) return null;
      throw error;
    }
  }

  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.client.EdgeKVPut({
      ZoneId: this.zoneId,
      Namespace: this.namespace,
      Key: key,
      Value: value,
      ...(ttlSeconds ? { ExpirationTTL: ttlSeconds } : {}),
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.EdgeKVDelete({
      ZoneId: this.zoneId,
      Namespace: this.namespace,
      Keys: [key],
    });
  }

  async increment(key: string, delta = 1): Promise<number> {
    const current = Number((await this.get(key)) ?? '0');
    const next = current + delta;
    await this.put(key, String(next));
    return next;
  }
}
