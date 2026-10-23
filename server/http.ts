import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { OrderError } from '../src/domain.ts';
import { get, type ShopDb } from './db.ts';
import type { Shop } from './shop.ts';

const COOKIE = 'esoterica_admin';
const JSON_LIMIT = 64 * 1024;
const WEBHOOK_LIMIT = 256 * 1024;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

type Next = (req: IncomingMessage, res: ServerResponse) => void;

export type AppDeps = {
  shop: Shop;
  db: ShopDb;
  adminPassword: string;
  next: Next;
  now?: () => Date;
};

const loginAttempts = new Map<string, { fails: number; lockedUntil: number }>();

export function clearLoginAttempts(): void {
  loginAttempts.clear();
}

export function createHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const now = deps.now ?? (() => new Date());
  return (req, res) => {
    void handle(deps, now, req, res).catch((error) => {
      if (res.headersSent) return;
      const mapped = mapError(error);
      sendJson(res, mapped.status, { error: mapped.message, code: mapped.code });
    });
  };
}

async function handle(deps: AppDeps, now: () => Date, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/api/')) {
    await route(deps, now, req, res, path, url);
    return;
  }
  if (path.startsWith('/data') || path.includes('..') || path.endsWith('.sqlite') || path.split('/').includes('.env')) {
    sendText(res, 404, 'Not found');
    return;
  }
  deps.next(req, res);
}

async function route(
  deps: AppDeps,
  now: () => Date,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
): Promise<void> {
  if (path === '/api/stripe/webhook' && req.method === 'POST') {
    const payload = (await readBody(req, WEBHOOK_LIMIT)).toString('utf8');
    const signature = header(req, 'stripe-signature');
    if (!signature) throw new OrderError('invalid', 'Missing Stripe signature.');
    const event = deps.shop.constructWebhook(payload, signature);
    await deps.shop.handleStripeEvent(event);
    sendJson(res, 200, { received: true });
    return;
  }

  if (req.method === 'POST') assertSameOrigin(req);

  if (path === '/api/quote' && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, deps.shop.quote(body.lines));
    return;
  }
  if (path === '/api/checkout' && req.method === 'POST') {
    const body = await readJson(req);
    const result = await deps.shop.startCheckout(body.lines, String(body.idempotencyKey ?? ''), publicOrigin(req));
    sendJson(res, 200, result);
    return;
  }
  if (path === '/api/checkout/cancel' && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, await deps.shop.cancel(String(body.reservationId ?? '')));
    return;
  }
  if (path === '/api/checkout/result' && req.method === 'GET') {
    sendJson(res, 200, await deps.shop.paymentResult(url.searchParams.get('session_id') ?? ''));
    return;
  }
  if (path === '/api/admin/login' && req.method === 'POST') {
    login(deps, now, req, res, await readJson(req));
    return;
  }
  if (path === '/api/admin/logout' && req.method === 'POST') {
    const token = readCookie(req);
    if (token) deps.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
    res.setHeader('set-cookie', cookie('', secureRequest(req), 0));
    sendJson(res, 200, { ok: true });
    return;
  }
  if (path === '/api/admin/orders' && req.method === 'GET') {
    requireAdmin(deps, req, now);
    sendJson(res, 200, { ...deps.shop.listOrders(), testMode: deps.shop.testMode() });
    return;
  }
  const fulfil = path.match(/^\/api\/admin\/orders\/(ES-\d+)\/fulfilment$/);
  if (fulfil && req.method === 'POST') {
    requireAdmin(deps, req, now);
    const body = await readJson(req);
    const status = body.status === 'fulfilled' || body.status === 'unfulfilled' ? body.status : null;
    if (!status) throw new OrderError('invalid', 'Choose fulfilled or unfulfilled.');
    const note = typeof body.note === 'string' ? body.note : null;
    sendJson(res, 200, { order: deps.shop.setFulfilment(fulfil[1], status, note) });
    return;
  }
  sendJson(res, 404, { error: 'Not found', code: 'not_found' });
}

function login(deps: AppDeps, now: () => Date, req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
  if (!deps.adminPassword) throw new OrderError('payments', 'The orders page isn’t configured yet.');
  const ip = req.socket.remoteAddress ?? 'unknown';
  const attempt = loginAttempts.get(ip);
  const time = now().getTime();
  if (attempt && attempt.lockedUntil > time) throw new OrderError('forbidden', 'Too many attempts. Wait a few minutes and try again.');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!passwordOk(password, deps.adminPassword)) {
    const fails = (attempt && attempt.lockedUntil > 0 && attempt.lockedUntil <= time ? 0 : attempt?.fails ?? 0) + 1;
    loginAttempts.set(ip, { fails, lockedUntil: fails >= 8 ? time + 15 * 60_000 : 0 });
    throw new OrderError('forbidden', 'That password isn’t right.');
  }
  loginAttempts.delete(ip);
  const token = randomBytes(32).toString('base64url');
  deps.db
    .prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
    .run(hashToken(token), new Date(time + SESSION_MS).toISOString());
  res.setHeader('set-cookie', cookie(token, secureRequest(req), SESSION_MS / 1000));
  sendJson(res, 200, { ok: true });
}

function requireAdmin(deps: AppDeps, req: IncomingMessage, now: () => Date): void {
  const token = readCookie(req);
  if (!token) throw new OrderError('forbidden', 'Sign in to view orders.');
  const row = get<{ expires_at: string }>(
    deps.db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?'),
    hashToken(token),
  );
  if (!row || row.expires_at <= now().toISOString()) throw new OrderError('forbidden', 'Sign in to view orders.');
}

function passwordOk(input: string, expected: string): boolean {
  const salt = 'esoterica-admin-login';
  const a = scryptSync(input, salt, 32);
  const b = scryptSync(expected, salt, 32);
  return timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookie(value: string, secure: boolean, maxAge: number): string {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function readCookie(req: IncomingMessage): string | null {
  const headerValue = header(req, 'cookie');
  if (!headerValue) return null;
  for (const part of headerValue.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

function secureRequest(req: IncomingMessage): boolean {
  const proto = header(req, 'x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto) return proto === 'https';
  return (process.env.PUBLIC_URL ?? '').startsWith('https://');
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = header(req, 'origin');
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new OrderError('forbidden', 'Request was rejected.');
  }
  const expected = header(req, 'x-forwarded-host')?.split(',')[0]?.trim() || header(req, 'host');
  if (!expected || host !== expected) throw new OrderError('forbidden', 'Request was rejected.');
}

export function publicOrigin(req: IncomingMessage): string {
  const configured = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const proto = header(req, 'x-forwarded-proto')?.split(',')[0]?.trim() || 'http';
  const host = header(req, 'x-forwarded-host')?.split(',')[0]?.trim() || header(req, 'host');
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new OrderError('invalid', 'Could not determine the site address.');
  return `${proto}://${host}`;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(req, JSON_LIMIT)).toString('utf8');
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new OrderError('invalid', 'The request could not be read.');
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new OrderError('too_large', 'Request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function mapError(error: unknown): { status: number; message: string; code: string } {
  if (error instanceof OrderError) {
    const status =
      error.code === 'capacity' || error.code === 'in_progress'
        ? 409
        : error.code === 'payments'
          ? 503
          : error.code === 'forbidden'
            ? 403
            : error.code === 'not_found'
              ? 404
              : error.code === 'too_large'
                ? 413
                : 400;
    return { status, message: error.message, code: error.code };
  }
  console.error('[esoterica]', error instanceof Error ? error.message : error);
  return { status: 500, message: 'Something went wrong. Try again.', code: 'error' };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

export function serveDist(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const root = join(process.cwd(), 'dist');
  const file = normalize(join(root, pathname.replace(/^\/+/, '')));
  if (!file.startsWith(normalize(root + sep))) {
    sendText(res, 404, 'Not found');
    return;
  }
  const candidate = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file;
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const ext = candidate.slice(candidate.lastIndexOf('.'));
  const cache = pathname.startsWith('/assets/') || pathname.startsWith('/images/') ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  createReadStream(candidate).pipe(res);
}
