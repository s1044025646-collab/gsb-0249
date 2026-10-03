import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AppError, errorBody } from './errors';
import {
  deleteCase,
  getCase,
  getReport,
  getVersion,
  listCases,
  listReports,
  listVersions,
  openDatabase,
} from './db';
import {
  analyzeAndReport,
  enumerateAndReport,
  importCase,
  importVersion,
  rangeAndReport,
  verifyAndReport,
} from './service';

const dataDir = process.env.CRT_DATA_DIR ?? join(process.cwd(), 'data');
const db = openDatabase(join(dataDir, 'congruence.sqlite'));

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError('INVALID_JSON', '请求体必须是合法 JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('INVALID_JSON', '请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

async function router(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/health') return send(res, 200, { ok: true });

  if (method === 'POST' && (path === '/api/solve' || path === '/api/merge')) {
    const body = asObject(await readJson(req));
    return send(res, 200, analyzeAndReport(db, body.constraints, body.limits));
  }

  if (method === 'POST' && path === '/api/verify') {
    const body = asObject(await readJson(req));
    return send(res, 200, verifyAndReport(db, body.constraints, body.candidates, body.limits));
  }

  if (method === 'POST' && path === '/api/range') {
    const body = asObject(await readJson(req));
    const result = rangeAndReport(db, body.constraints, body.lower, body.upper, body.limits);
    return send(res, 200, result);
  }

  if (method === 'POST' && path === '/api/enumerate') {
    const body = asObject(await readJson(req));
    return send(res, 200, enumerateAndReport(db, body.constraints, body.limits));
  }

  if (method === 'POST' && path === '/api/import') {
    const body = asObject(await readJson(req));
    return send(res, 201, importCase(db, body.name, body.constraints, body.limits));
  }

  if (method === 'GET' && path === '/api/cases') {
    return send(res, 200, { cases: listCases(db, url.searchParams.get('includeDeleted') === 'true') });
  }

  const caseMatch = path.match(/^\/api\/cases\/(\d+)$/);
  if (caseMatch && method === 'GET') {
    return send(res, 200, getCase(db, Number(caseMatch[1])));
  }
  if (caseMatch && method === 'DELETE') {
    deleteCase(db, Number(caseMatch[1]));
    return send(res, 200, { deleted: true });
  }

  const versionsMatch = path.match(/^\/api\/cases\/(\d+)\/versions$/);
  if (versionsMatch && method === 'GET') {
    return send(res, 200, { versions: listVersions(db, Number(versionsMatch[1])) });
  }
  if (versionsMatch && method === 'POST') {
    const body = asObject(await readJson(req));
    return send(
      res,
      201,
      importVersion(db, Number(versionsMatch[1]), body.constraints, body.limits),
    );
  }

  const versionMatch = path.match(/^\/api\/cases\/(\d+)\/versions\/(\d+)$/);
  if (versionMatch && method === 'GET') {
    return send(res, 200, getVersion(db, Number(versionMatch[1]), Number(versionMatch[2])));
  }

  if (method === 'GET' && path === '/api/reports') {
    return send(res, 200, { reports: listReports(db, Number(url.searchParams.get('limit') ?? 50)) });
  }
  const reportMatch = path.match(/^\/api\/reports\/(\d+)$/);
  if (reportMatch && method === 'GET') {
    return send(res, 200, getReport(db, Number(reportMatch[1])));
  }

  return send(res, 404, errorBody('INVALID_ARGUMENT', '接口不存在', { method, path }));
}

export function createAppServer(): Server {
  const server = createServer((req, res) => {
    router(req, res).catch((error: unknown) => {
      if (error instanceof AppError) return send(res, 400, errorBody(error.code, error.message, error.details));
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('INVALID_ARGUMENT:')) {
        return send(res, 400, errorBody('INVALID_ARGUMENT', message.slice('INVALID_ARGUMENT:'.length)));
      }
      return send(res, 500, errorBody('INVALID_ARGUMENT', '服务器内部错误', message));
    });
  });
  return server;
}

export function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

if (require.main === module) {
  const requestedPort = Number(process.env.PORT ?? 0);
  const server = createAppServer();
  listen(server, Number.isFinite(requestedPort) ? requestedPort : 0).then((port) => {
    console.log(`同余分析服务已启动：http://127.0.0.1:${port}`);
    console.log(`数据目录：${dataDir}`);
  });
}
