import 'dotenv/config';
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { handleRequest, readJsonBody, writeWebResponse } from '../src/router/index.js';
import { warmupDatabase } from '../src/db/warmup.js';

const PORT = Number(process.env.PORT ?? 8787);
const BLOB_DIR = path.resolve(process.env.DB_DATA_DIR ?? './data', 'blobs');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/blobs/') && req.method === 'GET') {
      const rel = decodeURIComponent(url.pathname.slice('/blobs/'.length));
      const filePath = path.join(BLOB_DIR, rel);
      if (!filePath.startsWith(BLOB_DIR) || !existsSync(filePath)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', rel.endsWith('.png') ? 'image/png' : 'application/octet-stream');
      createReadStream(filePath).pipe(res);
      return;
    }

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

server.listen(PORT, () => {
  console.log(`[detective-engine-api] dev server listening on http://localhost:${PORT}`);
  console.log(`[detective-engine-api] DB_ADAPTER=${process.env.DB_ADAPTER ?? 'memory'} KV=${process.env.KV_ADAPTER ?? 'memory'} BLOB=${process.env.BLOB_ADAPTER ?? 'local'}`);
  void warmupDatabase();
});
