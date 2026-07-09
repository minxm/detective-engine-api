import http from 'node:http';
import { URL } from 'node:url';
import 'dotenv/config';
import { handleRequest, readJsonBody, writeWebResponse } from '../src/router/index.js';
import { CORS_HEADERS } from '../src/utils/index.js';
import { warmupDatabase } from '../src/db/warmup.js';

const PORT = Number(process.env.PORT ?? 9000);
const HOST = '0.0.0.0';

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }

    const body = req.method === 'POST' || req.method === 'PUT' ? await readJsonBody(req) : {};
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const response = await handleRequest({
      method: req.method ?? 'GET',
      path: url.pathname,
      headers,
      body,
      query,
    });

    writeWebResponse(res, response);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ success: false, error: (error as Error).message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[detective-engine-api] web server listening on ${HOST}:${PORT}`);
  void warmupDatabase();
});
