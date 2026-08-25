import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {
  ActionClassification,
  CommandResult,
  CommandSubmitRequest,
  FilterRule,
  InspectKind,
  InspectRequest,
  PgsqlSubmitRequest,
} from '../src/shared/types.js';
import { openBrowser } from './browser.js';
import { bridgePath, clientDirectory, configDirectory } from './paths.js';
import {
  DoubleConfirmationRequiredError,
  ProxyService,
  SensitiveOutputConfirmationRequiredError,
} from './service.js';

const port = Number(process.env.PROXYDIABLO_PORT ?? 17871);
const host = '127.0.0.1';
const browserUrl = process.env.PROXYDIABLO_URL ?? `http://localhost:${port}/`;
const token = crypto.randomBytes(24).toString('hex');
const cookieName = 'proxydiablo_session';
const service = new ProxyService();
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, 'localhost:5173', '127.0.0.1:5173']);
const allowedOrigins = new Set([
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${port}`}`);
    if (!allowedHosts.has(request.headers.host ?? '')) throw new HttpError(403, 'invalid_host');

    if (url.pathname === '/health' && request.method === 'GET') {
      sendJson(response, 200, { ok: true, mode: 'web', app: 'proxydiablo' });
      return;
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      setSessionCookie(response);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleUiRequest(request, response, url);
      return;
    }

    if (url.pathname === '/open' && request.method === 'POST') {
      requireCliAuthorization(request);
      openBrowser(browserUrl);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname === '/pgsql/profiles' && request.method === 'GET') {
      requireCliAuthorization(request);
      await service.refreshProfiles();
      sendJson(response, 200, { ok: true, data: { profiles: service.snapshot().profiles } });
      return;
    }
    if (url.pathname === '/pgsql/inspect' && request.method === 'POST') {
      requireCliAuthorization(request);
      const result = await service.inspect(parseInspectRequest(await readBody(request)));
      sendJson(response, 200, { ok: true, data: result });
      return;
    }
    if (url.pathname === '/pgsql/submit' && request.method === 'POST') {
      requireCliAuthorization(request);
      const pending = service.submitPgsql(parsePgsqlRequest(await readBody(request)));
      if (!service.hasUiClients()) openBrowser(browserUrl);
      sendJson(response, 200, { ok: true, data: await pending });
      return;
    }
    if (url.pathname === '/command/submit' && request.method === 'POST') {
      requireCliAuthorization(request);
      const tab = service.createCommandTab(parseCommandRequest(await readBody(request)));
      if (!service.hasUiClients()) openBrowser(browserUrl);
      sendJson(response, 200, { ok: true, data: { tabId: tab.id } });
      return;
    }

    const commandMatch = url.pathname.match(/^\/command\/([^/]+)\/(instruction|result)$/);
    if (commandMatch) {
      requireCliAuthorization(request);
      const tabId = decodeURIComponent(commandMatch[1]);
      if (commandMatch[2] === 'instruction' && request.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0);
        sendJson(response, 200, { ok: true, data: service.commandInstruction(tabId, after) ?? null });
        return;
      }
      if (commandMatch[2] === 'result' && request.method === 'POST') {
        service.storeCommandResult(tabId, parseCommandResult(await readBody(request, 12 * 1024 * 1024)));
        sendJson(response, 200, { ok: true });
        return;
      }
    }

    await serveClient(response, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError
      ? error.status
      : error instanceof DoubleConfirmationRequiredError || error instanceof SensitiveOutputConfirmationRequiredError
        ? 409
        : 500;
    sendJson(response, status, { ok: false, error: safeError(error) });
  }
});

server.requestTimeout = 0;
server.listen(port, host, () => {
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDirectory, 0o700);
  fs.writeFileSync(
    bridgePath,
    JSON.stringify({ port, token, pid: process.pid, mode: 'web', app: 'proxydiablo', updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  fs.chmodSync(bridgePath, 0o600);
  console.log(`proxydiablo web listening on ${browserUrl}`);
  void service.refreshProfiles();
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Proxy Diablo server error.');
  process.exitCode = 1;
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return process.exit(1);
    shuttingDown = true;
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

process.on('exit', () => {
  try {
    const current = JSON.parse(fs.readFileSync(bridgePath, 'utf8')) as { token?: string };
    if (current.token === token) fs.rmSync(bridgePath, { force: true });
  } catch {
    // Nothing to clean up.
  }
});

async function handleUiRequest(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  requireUiAuthorization(request);

  if (url.pathname === '/api/state' && request.method === 'GET') {
    sendJson(response, 200, { ok: true, data: service.snapshot() });
    return;
  }
  if (url.pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const disconnectUi = service.connectUi();
    const unsubscribe = service.subscribe((state) => response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`));
    const keepAlive = setInterval(() => response.write(': keepalive\n\n'), 20000);
    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      disconnectUi();
    });
    return;
  }

  requireMutationOrigin(request);
  const body = request.method === 'GET' || request.method === 'DELETE' ? {} : await readBody(request);

  if (url.pathname === '/api/tabs/pgsql' && request.method === 'POST') {
    service.createPgsqlTab();
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === '/api/filters' && request.method === 'PUT') {
    service.saveFilters(parseFilters(body));
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === '/api/filters/quick' && request.method === 'POST') {
    const columnName = String(body.columnName ?? '').trim();
    if (!columnName) throw new HttpError(400, 'columnName is required');
    service.quickFilter(columnName);
    sendJson(response, 200, { ok: true });
    return;
  }

  const tabMatch = url.pathname.match(
    /^\/api\/tabs\/([^/]+)(?:\/(active|pgsql|connection|command|classification|run|cancel|revise|release|filter-exemption))?$/,
  );
  if (!tabMatch) throw new HttpError(404, 'not_found');

  const tabId = decodeURIComponent(tabMatch[1]);
  const action = tabMatch[2];
  if (!action && request.method === 'DELETE') service.closeTab(tabId);
  else if (action === 'active' && request.method === 'POST') service.setActiveTab(tabId);
  else if (action === 'pgsql' && request.method === 'PATCH') service.updatePgsql(tabId, String(body.sql ?? ''));
  else if (action === 'connection' && request.method === 'PATCH') {
    service.updateConnection(tabId, String(body.profile ?? ''), String(body.database ?? ''));
  } else if (action === 'command' && request.method === 'PATCH') {
    service.updateCommand(tabId, String(body.command ?? ''), String(body.cwd ?? ''));
  } else if (action === 'classification' && request.method === 'PATCH') {
    service.updateClassification(tabId, parseClassification(body.classification));
  } else if (action === 'run' && request.method === 'POST') {
    await service.approveTab(tabId, body.doubleConfirmed === true);
  } else if (action === 'cancel' && request.method === 'POST') service.cancelTab(tabId);
  else if (action === 'revise' && request.method === 'POST') service.requestRevision(tabId, String(body.explanation ?? ''));
  else if (action === 'release' && request.method === 'POST') {
    service.releaseTab(tabId, body.sensitiveDataConfirmed === true);
  } else if (action === 'filter-exemption' && request.method === 'POST') {
    service.toggleTabFilterExemption(tabId, String(body.columnName ?? ''));
  } else throw new HttpError(404, 'not_found');

  sendJson(response, 200, { ok: true });
}

function parsePgsqlRequest(body: Record<string, unknown>): PgsqlSubmitRequest {
  const request = {
    profile: String(body.profile ?? '').trim(),
    database: String(body.database ?? '').trim(),
    sql: String(body.sql ?? ''),
    description: String(body.description ?? '').trim(),
    classification: parseClassification(body.classification),
  };
  if (!request.profile || !request.database || !request.sql || !request.description) {
    throw new HttpError(400, 'profile, database, sql and description are required');
  }
  return request;
}

function parseCommandRequest(body: Record<string, unknown>): CommandSubmitRequest {
  const request = {
    command: String(body.command ?? ''),
    cwd: String(body.cwd ?? '').trim(),
    description: String(body.description ?? '').trim(),
    classification: parseClassification(body.classification),
  };
  if (!request.command.trim() || !request.cwd || !request.description) {
    throw new HttpError(400, 'command, cwd and description are required');
  }
  return request;
}

function parseClassification(value: unknown): ActionClassification {
  if (value !== 'read' && value !== 'write') throw new HttpError(400, 'classification must be read or write');
  return value;
}

function parseInspectRequest(body: Record<string, unknown>): InspectRequest {
  const profile = String(body.profile ?? '').trim();
  const database = String(body.database ?? '').trim();
  const rawKinds = Array.isArray(body.kinds) ? body.kinds : ['all'];
  const allowed = new Set<InspectKind>(['schemas', 'tables', 'views', 'columns', 'all']);
  const kinds = rawKinds.map(String).filter((kind): kind is InspectKind => allowed.has(kind as InspectKind));
  const schema = body.schema === undefined || body.schema === null ? undefined : String(body.schema).trim();
  if (!profile || !database) throw new HttpError(400, 'profile and database are required');
  return { profile, database, kinds: kinds.length ? kinds : ['all'], schema: schema || undefined };
}

function parseCommandResult(body: Record<string, unknown>): CommandResult {
  return {
    stdout: String(body.stdout ?? ''),
    stderr: String(body.stderr ?? ''),
    exitCode: typeof body.exitCode === 'number' ? body.exitCode : null,
    signal: typeof body.signal === 'string' ? body.signal : null,
    durationMs: Math.max(0, Number(body.durationMs ?? 0)),
    stdoutTruncated: body.stdoutTruncated === true,
    stderrTruncated: body.stderrTruncated === true,
    outputKind: 'text',
  };
}

function parseFilters(body: Record<string, unknown>): FilterRule[] {
  if (!Array.isArray(body.filters)) throw new HttpError(400, 'filters must be an array');
  return body.filters.map((value, index) => {
    if (!value || typeof value !== 'object') throw new HttpError(400, `invalid filter at index ${index}`);
    const filter = value as Record<string, unknown>;
    const mode = filter.mode === 'exact' ? 'exact' : filter.mode === 'glob' ? 'glob' : undefined;
    const pattern = String(filter.pattern ?? '').trim();
    if (!mode || !pattern) throw new HttpError(400, `invalid filter at index ${index}`);
    return {
      id: String(filter.id ?? `rule:${Date.now()}:${index}`),
      pattern,
      mode,
      enabled: filter.enabled !== false,
      createdAt: String(filter.createdAt ?? new Date().toISOString()),
    };
  });
}

async function serveClient(response: http.ServerResponse, pathname: string): Promise<void> {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(clientDirectory, relativePath);
  if (!filePath.startsWith(`${path.resolve(clientDirectory)}${path.sep}`) && filePath !== path.join(clientDirectory, 'index.html')) {
    throw new HttpError(403, 'invalid_path');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new HttpError(404, 'not_found');
  setSessionCookie(response);
  response.writeHead(200, {
    'content-type': contentType(filePath),
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(response);
}

function requireCliAuthorization(request: http.IncomingMessage): void {
  if (request.headers.authorization !== `Bearer ${token}` && request.headers['x-proxydiablo-token'] !== token) {
    throw new HttpError(401, 'unauthorized');
  }
}

function requireUiAuthorization(request: http.IncomingMessage): void {
  const cookies = Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, value.join('=')];
  }));
  if (cookies[cookieName] !== token) throw new HttpError(401, 'unauthorized');
}

function requireMutationOrigin(request: http.IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) throw new HttpError(403, 'invalid_origin');
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'application/json required');
  }
}

function setSessionCookie(response: http.ServerResponse): void {
  response.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
}

function readBody(request: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        reject(new HttpError(413, 'request_too_large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) as Record<string, unknown> : {});
      } catch {
        reject(new HttpError(400, 'invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function contentType(filePath: string): string {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

process.on('unhandledRejection', () => console.error('Unhandled Proxy Diablo server error.'));
