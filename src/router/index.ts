import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsPreflightResponse, jsonResponse } from '../utils/index.js';
import { handleCaseCreate } from '../../cloud-functions/case/create.js';
import { handleCaseStatus } from '../../cloud-functions/case/status.js';
import { handleCaseGet } from '../../cloud-functions/case/get.js';
import { handleInterrogate } from '../../cloud-functions/ai/interrogate.js';
import { handleScore } from '../../cloud-functions/ai/score.js';
import { handleHistoryList } from '../../cloud-functions/history/list.js';
import { handleRankList } from '../../cloud-functions/rank/list.js';
import { handleUserStats } from '../../cloud-functions/auth/stats.js';
import { handleUserProfile } from '../../cloud-functions/auth/profile.js';
import { handleAuthConfig, handleAuthHeartbeat } from '../../cloud-functions/auth/config.js';
import { handleAdminStatus } from '../../cloud-functions/admin/status.js';
import { handleAdminDashboard } from '../../cloud-functions/admin/dashboard.js';
import { handleInventoryRefill } from '../../cloud-functions/admin/inventory-refill.js';

export type CloudContext = {
  headers: Record<string, string | undefined>;
  body: unknown;
  query: Record<string, string>;
  path: string;
  method: string;
};

type RouteHandler = (ctx: CloudContext) => Promise<Response>;

const routes: Record<string, RouteHandler> = {
  'POST /api/case/create': handleCaseCreate,
  'GET /api/case/status': handleCaseStatus,
  'GET /api/case/:id': handleCaseGet,
  'POST /api/interrogate': handleInterrogate,
  'POST /api/score': handleScore,
  'GET /api/history': handleHistoryList,
  'GET /api/rank': handleRankList,
  'GET /api/user/stats': handleUserStats,
  'GET /api/user/profile': handleUserProfile,
  'POST /api/user/profile': handleUserProfile,
  'GET /api/auth/config': handleAuthConfig,
  'POST /api/auth/heartbeat': handleAuthHeartbeat,
  'GET /api/admin/status': handleAdminStatus,
  'GET /api/admin/dashboard': handleAdminDashboard,
  'POST /api/admin/inventory/refill': handleInventoryRefill,
};

function matchRoute(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
  for (const [key, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = key.split(' ');
    if (routeMethod !== method) continue;
    const routeParts = routePath.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler, params };
  }
  return null;
}

export async function handleRequest(ctx: CloudContext): Promise<Response> {
  if (ctx.method === 'OPTIONS') return corsPreflightResponse();

  if (ctx.method === 'GET' && (ctx.path === '/' || ctx.path === '/health')) {
    return jsonResponse({
      success: true,
      service: 'detective-engine-api',
      status: 'ok',
      docs: 'All business APIs are under /api/*',
      examples: [
        'GET /api/auth/config',
        'GET /api/rank',
        'POST /api/case/create',
      ],
    });
  }

  const matched = matchRoute(ctx.method, ctx.path);
  if (!matched) {
    return jsonResponse({ success: false, error: 'Not Found' }, 404);
  }

  ctx.query = { ...ctx.query, ...matched.params };
  return matched.handler(ctx);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

export function writeWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  void response.text().then((text) => {
    res.end(text);
  });
}
