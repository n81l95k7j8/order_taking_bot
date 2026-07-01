export interface StringKeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface StoredValue {
  value: string;
  expiresAt?: number;
}

const STATE_PATH = '/state';
const TTL_HEADER = 'x-expiration-ttl';

export class BotStateDurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== STATE_PATH) {
      return new Response('Not found', { status: 404 });
    }

    const key = url.searchParams.get('key');
    if (!key) {
      return new Response('Missing key', { status: 400 });
    }

    if (request.method === 'GET') {
      const record = await this.getRecord(key);
      return record ? new Response(record.value) : new Response('Not found', { status: 404 });
    }

    if (request.method === 'PUT') {
      const value = await request.text();
      const ttlSeconds = parseTtl(request.headers.get(TTL_HEADER));
      const record: StoredValue = {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      };
      await this.state.storage.put(key, record);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'DELETE') {
      await this.state.storage.delete(key);
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  }

  private async getRecord(key: string): Promise<StoredValue | null> {
    const record = await this.state.storage.get<StoredValue>(key);
    if (!record) return null;

    if (record.expiresAt && record.expiresAt <= Date.now()) {
      await this.state.storage.delete(key);
      return null;
    }

    return record;
  }
}

export function createDurableObjectKeyValueStore(
  namespace: DurableObjectNamespace,
  objectName: string,
): StringKeyValueStore {
  const getStub = () => namespace.get(namespace.idFromName(objectName));

  async function requestObject(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    value?: string,
    options?: { expirationTtl?: number },
  ): Promise<Response> {
    const url = new URL(`https://bot-state.local${STATE_PATH}`);
    url.searchParams.set('key', key);
    const headers = new Headers();
    if (options?.expirationTtl) {
      headers.set(TTL_HEADER, String(options.expirationTtl));
    }

    return getStub().fetch(new Request(url, { method, headers, body: value }));
  }

  return {
    async get(key) {
      const response = await requestObject('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`State read failed for ${key}: ${response.status}`);
      return response.text();
    },
    async put(key, value, options) {
      const response = await requestObject('PUT', key, value, options);
      if (!response.ok) throw new Error(`State write failed for ${key}: ${response.status}`);
    },
    async delete(key) {
      const response = await requestObject('DELETE', key);
      if (!response.ok) throw new Error(`State delete failed for ${key}: ${response.status}`);
    },
  };
}

export function createDurableObjectStoreFactory(
  namespace: DurableObjectNamespace,
  objectPrefix: string,
): (key: string) => StringKeyValueStore {
  return (key) => createDurableObjectKeyValueStore(namespace, `${objectPrefix}:${key}`);
}

function parseTtl(value: string | null): number | undefined {
  if (!value) return undefined;

  const ttl = Number(value);
  if (!Number.isFinite(ttl) || ttl <= 0) return undefined;

  return ttl;
}
