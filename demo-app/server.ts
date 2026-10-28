/**
 * Demo application under test: a small user-administration web UI plus a REST
 * API sharing one in-memory store. Lets UI, API and integration suites run
 * deterministically, locally and in CI, without touching a shared environment.
 *
 *   node dist/demo-app/server.js
 *
 * Environment: DEMO_APP_PORT (3000), API_TOKEN, APP_USERNAME, APP_PASSWORD,
 * DEMO_UI_DELAY_MS (300) - delay before the users table renders.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { loadDotEnv } from '../src/config/configManager.js';
import { createLogger } from '../src/utils/logger.js';
import { loginPage, newUserPage, notFoundPage, userDetailPage, usersPage } from './pages.js';
import { DuplicateEmailError, ROLES, UserStore, validateUserInput, type Role, type UserInput } from './userStore.js';

loadDotEnv();
const logger = createLogger('demo-app', (process.env.LOG_LEVEL as 'info') ?? 'info');

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    process.stderr.write(`[CONFIGURATION] ${name} is required to start the demo app\n`);
    process.exit(1);
  }
  return value;
}

const PORT = Number(process.env.DEMO_APP_PORT ?? 3000);
const HOST = '127.0.0.1';
const API_TOKEN = requireEnv('API_TOKEN');
const APP_USERNAME = requireEnv('APP_USERNAME');
const APP_PASSWORD = requireEnv('APP_PASSWORD');
const UI_DELAY_MS = Number(process.env.DEMO_UI_DELAY_MS ?? 300);
const MAX_BODY_BYTES = 100 * 1024;
const MAX_FIXTURE_DELAY_MS = 30_000;

const store = new UserStore();
store.create({ name: 'Ada Lovelace', email: 'ada@example.test', role: 'admin', active: true });
store.create({ name: 'Grace Hopper', email: 'grace@example.test', role: 'editor', active: true });

const sessions = new Set<string>();

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookies(req: http.IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) result[name] = decodeURIComponent(rest.join('='));
  }
  return result;
}

function sessionId(req: http.IncomingMessage): string | undefined {
  const sid = cookies(req).sid;
  return sid && sessions.has(sid) ? sid : undefined;
}

function hasApiAccess(req: http.IncomingMessage): boolean {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ') && safeEqual(auth.slice(7), API_TOKEN)) return true;
  return sessionId(req) !== undefined;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: string[]) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const text = await readBody(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendHtml(res: http.ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(html);
}

function redirect(res: http.ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

function safeNext(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/users';
}

// ---------------------------------------------------------------- API

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/health' && method === 'GET') return sendJson(res, 200, { status: 'ok' });
  if (!hasApiAccess(req)) throw new HttpError(401, 'Missing or invalid bearer token');

  // Deterministic failure fixtures for testing the framework's error handling.
  if (path === '/api/test-fixtures/slow' && method === 'GET') {
    const delay = Math.min(Number(url.searchParams.get('delayMs') ?? 1000) || 0, MAX_FIXTURE_DELAY_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return sendJson(res, 200, { delayedMs: delay });
  }
  if (path === '/api/test-fixtures/invalid-json' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return void res.end('{"status": "ok", truncated');
  }
  if (path === '/api/test-fixtures/server-error' && method === 'GET') {
    return sendJson(res, 500, { error: 'Simulated internal server error' });
  }

  if (path === '/api/users') {
    if (method === 'GET') return sendJson(res, 200, store.list({ email: url.searchParams.get('email') ?? undefined }));
    if (method === 'POST') {
      const { errors, value } = validateUserInput(await readJson(req), false);
      if (errors.length) throw new HttpError(400, 'Validation failed', errors);
      const user = store.create(value as UserInput);
      return sendJson(res, 201, user, { Location: `/api/users/${user.id}` });
    }
    throw new HttpError(405, `Method ${method} not allowed`);
  }

  const match = /^\/api\/users\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]!);
    const existing = store.get(id);
    if (!existing) throw new HttpError(404, `User ${id} not found`);
    if (method === 'GET') return sendJson(res, 200, existing);
    if (method === 'PUT' || method === 'PATCH') {
      const { errors, value } = validateUserInput(await readJson(req), method === 'PATCH');
      if (errors.length) throw new HttpError(400, 'Validation failed', errors);
      return sendJson(res, 200, store.update(id, value));
    }
    if (method === 'DELETE') {
      store.delete(id);
      res.writeHead(204).end();
      return;
    }
    throw new HttpError(405, `Method ${method} not allowed`);
  }
  throw new HttpError(404, `No API route for ${method} ${path}`);
}

// ---------------------------------------------------------------- UI

async function handleUi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const signedIn = sessionId(req) !== undefined;

  if (path === '/' && method === 'GET') return redirect(res, signedIn ? '/users' : '/login');

  if (path === '/login') {
    if (method === 'GET') {
      const notice = url.searchParams.get('loggedOut') ? 'You have been signed out.' : undefined;
      return sendHtml(res, 200, loginPage({ notice, next: safeNext(url.searchParams.get('next')) }));
    }
    if (method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const username = form.get('username')?.trim() ?? '';
      const password = form.get('password') ?? '';
      const next = safeNext(form.get('next'));
      if (!username || !password) {
        return sendHtml(res, 400, loginPage({ error: 'Username and password are required.', next, username }));
      }
      if (!safeEqual(username, APP_USERNAME) || !safeEqual(password, APP_PASSWORD)) {
        logger.info('Failed login', { username });
        return sendHtml(res, 401, loginPage({ error: 'Invalid username or password.', next, username }));
      }
      const sid = randomBytes(24).toString('hex');
      sessions.add(sid);
      return redirect(res, next, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Lax; Path=/` });
    }
  }

  if (path === '/logout' && method === 'POST') {
    const sid = sessionId(req);
    if (sid) sessions.delete(sid);
    return redirect(res, '/login?loggedOut=1', { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (!signedIn) return redirect(res, `/login?next=${encodeURIComponent(path)}`);

  if (path === '/users' && method === 'GET') return sendHtml(res, 200, usersPage(UI_DELAY_MS));

  if (path === '/users/new') {
    if (method === 'GET') return sendHtml(res, 200, newUserPage());
    if (method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const values = {
        name: form.get('name') ?? '',
        email: form.get('email') ?? '',
        role: form.get('role') ?? 'viewer',
        status: form.get('status') ?? 'active',
      };
      const { errors, value } = validateUserInput({
        name: values.name,
        email: values.email,
        role: ROLES.includes(values.role as Role) ? values.role : '?',
        active: values.status === 'active',
      }, false);
      if (form.get('confirm') !== 'yes') errors.push('Please confirm this is test data');
      if (!errors.length) {
        try {
          const user = store.create(value as UserInput);
          return redirect(res, `/users/${encodeURIComponent(user.id)}?created=1`);
        } catch (error) {
          if (!(error instanceof DuplicateEmailError)) throw error;
          errors.push(error.message);
        }
      }
      return sendHtml(res, 400, newUserPage(values, errors));
    }
  }

  const match = /^\/users\/([^/]+)$/.exec(path);
  if (match && method === 'GET') {
    const user = store.get(decodeURIComponent(match[1]!));
    if (!user) return sendHtml(res, 404, notFoundPage('User not found.', true));
    return sendHtml(res, 200, userDetailPage(user, url.searchParams.get('created') ? 'User created.' : undefined));
  }

  return sendHtml(res, 404, notFoundPage('Page not found.', signedIn));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const handler = url.pathname.startsWith('/api/') || url.pathname === '/api' ? handleApi : handleUi;
  handler(req, res, url).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) logger.error('Unhandled error', { error: (error as Error).stack });
    const message = error instanceof HttpError ? error.message : 'Internal server error';
    if (res.headersSent) return void res.end();
    if (handler === handleApi) sendJson(res, status, { error: message, ...(error instanceof HttpError && error.details ? { details: error.details } : {}) });
    else sendHtml(res, status, notFoundPage(message, false));
  });
});

server.listen(PORT, HOST, () => logger.info('Demo app listening', { url: `http://${HOST}:${PORT}` }));
const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
