import { handleRequest } from '../src/router/index.js';

type ScfEvent = {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  queryString?: Record<string, string>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string;
  isBase64Encoded?: boolean;
  rawPath?: string;
  version?: string;
  requestContext?: {
    http?: { method?: string; path?: string };
    httpMethod?: string;
    path?: string;
  };
};

function normalizeQuery(
  queryString?: Record<string, string>,
  queryStringParameters?: Record<string, string | undefined> | null
): Record<string, string> {
  const query: Record<string, string> = { ...(queryString ?? {}) };
  if (queryStringParameters) {
    for (const [key, value] of Object.entries(queryStringParameters)) {
      if (value !== undefined) query[key] = value;
    }
  }
  return query;
}

function parseScfEvent(event: ScfEvent) {
  const method =
    event.requestContext?.http?.method ??
    event.requestContext?.httpMethod ??
    event.httpMethod ??
    'GET';

  const path =
    event.rawPath ??
    event.requestContext?.http?.path ??
    event.requestContext?.path ??
    event.path ??
    '/';

  let body: unknown = {};
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }

  return {
    method,
    path,
    headers: event.headers ?? {},
    body,
    query: normalizeQuery(event.queryString, event.queryStringParameters),
  };
}

async function responseToScf(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false,
  };
}

/** 腾讯云 SCF Web 函数 / API 网关入口 */
export async function main(event: ScfEvent, _context?: unknown) {
  const ctx = parseScfEvent(event);
  const response = await handleRequest(ctx);
  return responseToScf(response);
}

export default main;
