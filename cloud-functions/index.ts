import { handleRequest } from '../src/router/index.js';

/** EdgeOne Cloud Functions 入口 */
export async function main(event: {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  queryString?: Record<string, string>;
  body?: string;
}) {
  const method = event.httpMethod ?? 'GET';
  const path = event.path ?? '/';
  let body: unknown = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      body = {};
    }
  }

  return handleRequest({
    method,
    path,
    headers: event.headers ?? {},
    body,
    query: event.queryString ?? {},
  });
}

export default main;
