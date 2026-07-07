import http from 'node:http';
import { URL } from 'node:url';
import { handleRequest, readJsonBody, writeWebResponse } from '../src/router/index.js';

const PORT = Number(process.env.PORT ?? 9000);
const HOST = '0.0.0.0';

const server = http.createServer(async (req, res) => {
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
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: (error as Error).message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[detective-engine-api] web server listening on ${HOST}:${PORT}`);
});
