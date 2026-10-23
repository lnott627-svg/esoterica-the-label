import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { openDatabase } from './db.ts';
import { loadEnv } from './env.ts';
import { createHandler, serveDist } from './http.ts';
import { createNotifier } from './notify.ts';
import { createStripePayments } from './payments.ts';
import { Shop } from './shop.ts';

loadEnv();

const db = openDatabase(process.env.SHOP_DB ?? 'data/shop.sqlite');
const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const payments = secretKey && webhookSecret ? createStripePayments(secretKey, webhookSecret) : null;

if (!payments) console.warn('[esoterica] Stripe keys are not set. Checkout cannot take payment.');
else console.log(`[esoterica] Stripe ${payments.testMode ? 'test' : 'live'} mode.`);
if (!process.env.ADMIN_PASSWORD) console.warn('[esoterica] ADMIN_PASSWORD is not set. /admin.html cannot be opened.');
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_URL) {
  console.warn('[esoterica] PUBLIC_URL is not set. Checkout redirects use the request host.');
}

const shop = new Shop(db, payments, createNotifier());

const next = await createNext();
const handler = createHandler({
  shop,
  db,
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  next,
});

const port = Number(process.env.PORT ?? 5173);
createServer(handler).listen(port, '0.0.0.0', () => {
  console.log(`[esoterica] http://localhost:${port}/`);
});

async function createNext(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  if (process.env.NODE_ENV === 'production') return serveDist;
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    server: { middlewareMode: true, allowedHosts: true },
    appType: 'mpa',
  });
  return (req, res) => {
    vite.middlewares(req, res, () => {
      if (!res.headersSent) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
  };
}
