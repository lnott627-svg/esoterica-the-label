import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { formatMoney } from '../src/format.ts';
import { adminOrdersHtml, type ShownOrder } from '../src/order-view.ts';
import { openDatabase, get, type ShopDb } from '../server/db.ts';
import { clearLoginAttempts, createHandler } from '../server/http.ts';
import type { CheckoutCreate, CheckoutSnapshot, Payments, RefundState, StripeEventInput } from '../server/payments.ts';
import { Shop, type Notifier } from '../server/shop.ts';

const SECRET = 'whsec_esoterica_test_secret';
const ORIGIN = 'http://127.0.0.1:5173';
const stripe = new Stripe('sk_test_esoterica');

const green = {
  productId: 'relic-top',
  colourId: 'green',
  size: 'M',
  quantity: 1,
  fit: { topSize: 'S', torsoLength: 'Long' },
  price: 1,
};

class FakePayments implements Payments {
  testMode = true;
  sessions = new Map<string, CheckoutSnapshot>();
  created: CheckoutCreate[] = [];
  expired: string[] = [];
  refunds: { paymentIntentId: string; amountCents: number | undefined }[] = [];
  charges = new Map<string, RefundState>();
  failCreate = false;
  pause: Promise<void> | null = null;

  async createCheckoutSession(input: CheckoutCreate) {
    if (this.pause) await this.pause;
    if (this.failCreate) throw new Error('stripe down');
    const id = `cs_test_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
    const subtotal = input.lines.reduce((sum, line) => sum + line.lineAmountCents, 0);
    const snapshot: CheckoutSnapshot = {
      id,
      status: 'open',
      paymentStatus: 'unpaid',
      currency: 'aud',
      amountSubtotal: subtotal,
      amountShipping: input.shippingCents,
      amountTotal: subtotal + input.shippingCents,
      livemode: false,
      reservationId: input.reservationId,
      paymentIntentId: `pi_${id}`,
      customerEmail: null,
      customerName: null,
      customerPhone: null,
      shippingName: null,
      shipping: null,
      lineItems: input.lines.map((line) => ({
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        name: line.productName,
        productId: line.productId,
        colourId: line.colourId,
        size: line.size,
        fitJson: JSON.stringify(line.fit),
      })),
    };
    this.sessions.set(id, snapshot);
    this.created.push(input);
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }

  async retrieveCheckoutSession(id: string) {
    return this.sessions.get(id) ?? null;
  }

  async expireCheckoutSession(id: string) {
    this.expired.push(id);
    const session = this.sessions.get(id);
    if (session?.status === 'open') session.status = 'expired';
  }

  async refundPayment(paymentIntentId: string, amountCents?: number) {
    this.refunds.push({ paymentIntentId, amountCents });
  }

  async refundStateForCharge(chargeId: string) {
    return this.charges.get(chargeId) ?? null;
  }

  constructEvent(payload: string, signature: string): StripeEventInput {
    const event = stripe.webhooks.constructEvent(payload, signature, SECRET);
    const object = event.data.object as { id?: string };
    return { id: event.id, type: event.type, data: { object: { id: object.id } } };
  }

  pay(id: string, extra: Partial<CheckoutSnapshot> = {}) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`missing ${id}`);
    session.status = 'complete';
    session.paymentStatus = 'paid';
    session.customerEmail = extra.customerEmail ?? 'ari@example.com';
    session.customerName = extra.customerName ?? 'Ari Lee';
    session.shippingName = extra.shippingName ?? 'Ari Lee';
    session.shipping = extra.shipping ?? {
      line1: '1 Example St',
      line2: null,
      city: 'Brisbane',
      state: 'QLD',
      postalCode: '4000',
      country: 'AU',
    };
    Object.assign(session, extra);
  }
}

function harness() {
  const db = openDatabase(':memory:');
  const payments = new FakePayments();
  const sent: string[] = [];
  const notifier: Notifier = async (order) => {
    sent.push(order.number);
    return 'skipped';
  };
  let now = new Date('2026-10-23T01:00:00.000Z');
  const shop = new Shop(db, payments, notifier, () => now);
  return {
    db,
    payments,
    shop,
    sent,
    setNow(value: Date) {
      now = value;
    },
  };
}

function sessionId(db: ShopDb): string {
  const row = get<{ session_id: string }>(
    db.prepare(`SELECT session_id FROM reservations WHERE session_id IS NOT NULL ORDER BY rowid DESC`),
  );
  if (!row?.session_id) throw new Error('no session');
  return row.session_id;
}

function reservationId(db: ShopDb): string {
  const row = get<{ id: string }>(db.prepare(`SELECT id FROM reservations ORDER BY created_at DESC`));
  if (!row) throw new Error('no reservation');
  return row.id;
}

describe('checkout pricing and capacity', () => {
  test('prices and shipping are taken from the server, and fit answers are optional', async () => {
    const { shop, payments } = harness();
    const quote = shop.quote([{ ...green, fit: {} }, { productId: 'relic-top', colourId: 'brown', size: 'S', quantity: 2 }]);
    assert.equal(quote.subtotal, formatMoney(80 + 160));
    assert.equal(quote.shipping, formatMoney(12));
    assert.equal(quote.total, formatMoney(252));
    assert.equal(quote.canCheckout, true);
    assert.equal(quote.lines[0].fitSummary, null);
    assert.equal(quote.lines[1].quantity, 2);

    const started = await shop.startCheckout(
      [{ ...green, fit: {} }, { productId: 'relic-top', colourId: 'brown', size: 'S', quantity: 2 }],
      'checkout-key-1',
      ORIGIN,
    );
    assert.match(started.url, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    assert.equal(payments.created[0].lines[0].unitAmountCents, 8000);
    assert.equal(payments.created[0].shippingCents, 1200);
    assert.match(payments.created[0].successUrl, /\/checkout-success\.html\?session_id=\{CHECKOUT_SESSION_ID\}$/);
    assert.match(payments.created[0].cancelUrl, /\/checkout-cancel\.html\?reservation=/);

    const again = await shop.startCheckout(
      [{ ...green, fit: {} }, { productId: 'relic-top', colourId: 'brown', size: 'S', quantity: 2 }],
      'checkout-key-1',
      ORIGIN,
    );
    assert.equal(again.url, started.url);
    assert.equal(payments.created.length, 1);
  });

  test('partial fit stays on the right line and blank questions do not block payment', async () => {
    const { shop, payments, db, sent } = harness();
    await shop.startCheckout(
      [
        green,
        { productId: 'relic-top', colourId: 'brown', size: 'L', quantity: 2, fit: { bustSize: 'M' } },
      ],
      'fit-lines-key',
      ORIGIN,
    );
    const id = sessionId(db);
    payments.pay(id);
    const result = await shop.paymentResult(id);
    assert.equal(result.state, 'paid');
    if (result.state !== 'paid') return;
    assert.equal(result.order.number, 'ES-1001');
    assert.equal(result.order.email, 'ari@example.com');
    assert.deepEqual(result.order.address, ['Ari Lee', '1 Example St', 'Brisbane QLD 4000', 'Australia']);
    assert.equal(result.order.lines[0].colourName, 'Green');
    assert.equal(result.order.lines[0].size, 'M');
    assert.deepEqual(result.order.lines[0].fit, [
      { label: 'Usual top size', value: 'S' },
      { label: 'Torso length', value: 'Long' },
      { label: 'Bust size', value: null },
    ]);
    assert.equal(result.order.lines[1].quantity, 2);
    assert.deepEqual(
      result.order.lines[1].fit.map((fit) => fit.value),
      [null, null, 'M'],
    );
    assert.equal(sent.length, 1);
    assert.match(result.order.placedAtLabel, /23 Oct 2026/);
    assert.match(result.order.placedAtLabel, /Brisbane time/);

    const repeat = await shop.paymentResult(id);
    assert.equal(repeat.state, 'paid');
    if (repeat.state === 'paid') assert.equal(repeat.order.number, 'ES-1001');
    await shop.handleStripeEvent({ id: 'evt_completed', type: 'checkout.session.completed', data: { object: { id } } });
    await shop.handleStripeEvent({
      id: 'evt_async',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { id } },
    });
    await shop.handleStripeEvent({ id: 'evt_completed', type: 'checkout.session.completed', data: { object: { id } } });
    assert.equal(sent.length, 1);
    assert.equal(shop.listOrders().orders.length, 1);

    payments.retrieveCheckoutSession = async () => {
      throw new Error('stripe down');
    };
    const cached = await shop.paymentResult(id);
    assert.equal(cached.state, 'paid');
    if (cached.state === 'paid') assert.equal(cached.order.number, 'ES-1001');
    assert.equal(sent.length, 1);
  });

  test('an unpaid success check does not create an order', async () => {
    const { shop, db, sent } = harness();
    await shop.startCheckout([green], 'unpaid-key-1', ORIGIN);
    const result = await shop.paymentResult(sessionId(db));
    assert.equal(result.state, 'unpaid');
    assert.equal(shop.listOrders().orders.length, 0);
    assert.equal(sent.length, 0);
  });

  test('capacity, cancellation, expiry and fulfilment follow making capacity', async () => {
    const { shop, payments, db, setNow } = harness();
    await shop.startCheckout([{ ...green, quantity: 4, fit: {} }], 'capacity-hold', ORIGIN);
    await assert.rejects(() => shop.startCheckout([{ ...green, quantity: 1, fit: {} }], 'capacity-extra', ORIGIN), /can’t be accepted/);

    const cancelled = await shop.cancel(reservationId(db));
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(payments.expired.length, 1);
    await shop.startCheckout([{ ...green, quantity: 4, fit: {} }], 'capacity-again', ORIGIN);

    setNow(new Date('2026-10-23T04:00:00.000Z'));
    const freed = shop.quote([{ ...green, quantity: 4, fit: {} }]);
    assert.equal(freed.canCheckout, true);

    await shop.startCheckout([{ ...green, quantity: 4, fit: {} }], 'capacity-paid', ORIGIN);
    const id = sessionId(db);
    payments.pay(id);
    const paid = await shop.paymentResult(id);
    assert.equal(paid.state, 'paid');
    await assert.rejects(() => shop.startCheckout([{ ...green, quantity: 1, fit: {} }], 'while-making', ORIGIN), /can’t be accepted/);
    if (paid.state !== 'paid') return;
    shop.setFulfilment(paid.order.number, 'fulfilled', 'Sent with the post');
    const after = await shop.startCheckout([{ ...green, quantity: 4, fit: {} }], 'after-fulfil', ORIGIN);
    assert.match(after.url, /^https:\/\/checkout\.stripe\.com/);
    payments.pay(sessionId(db));
    const second = await shop.paymentResult(sessionId(db));
    assert.equal(second.state, 'paid');
    if (second.state !== 'paid') return;
    assert.throws(() => shop.setFulfilment(paid.order.number, 'unfulfilled', null), /can’t be reopened/);
  });

  test('a cash refund frees making capacity and keeps the restocking fee', async () => {
    const { shop, payments, db } = harness();
    await shop.startCheckout([{ ...green, quantity: 2, fit: {} }], 'refund-mind', ORIGIN);
    const id = sessionId(db);
    payments.pay(id);
    const paid = await shop.paymentResult(id);
    assert.equal(paid.state, 'paid');
    if (paid.state !== 'paid') return;
    assert.equal(shop.listOrders().unfulfilled, 1);

    const changed = await shop.refund(paid.order.number, 'change_of_mind');
    assert.equal(changed.paymentStatus, 'refunded');
    assert.equal(payments.refunds.length, 1);
    assert.equal(payments.refunds[0].paymentIntentId, `pi_${id}`);
    assert.equal(payments.refunds[0].amountCents, 8000 * 2 - 1100 * 2);
    assert.equal(shop.listOrders().unfulfilled, 0);
    assert.equal(shop.quote([{ ...green, quantity: 4, fit: {} }]).canCheckout, true);

    const again = await shop.refund(paid.order.number, 'change_of_mind');
    assert.equal(again.paymentStatus, 'refunded');
    assert.equal(payments.refunds.length, 1);

    await shop.startCheckout([green], 'refund-webhook', ORIGIN);
    const webhookId = sessionId(db);
    payments.pay(webhookId);
    const webhookPaid = await shop.paymentResult(webhookId);
    if (webhookPaid.state !== 'paid') return;
    payments.charges.set('ch_partial', { paymentIntentId: `pi_${webhookId}`, status: 'partial', amountRefundedCents: 6900 });
    await shop.handleStripeEvent({ id: 'evt_partial_refund', type: 'charge.refunded', data: { object: { id: 'ch_partial' } } });
    assert.equal(shop.listOrders().orders.find((order) => order.number === webhookPaid.order.number)?.paymentStatus, 'paid');
    payments.charges.set('ch_full', { paymentIntentId: `pi_${webhookId}`, status: 'full', amountRefundedCents: 9200 });
    await shop.handleStripeEvent({ id: 'evt_full_refund', type: 'charge.refunded', data: { object: { id: 'ch_full' } } });
    assert.equal(shop.listOrders().orders.find((order) => order.number === webhookPaid.order.number)?.paymentStatus, 'refunded');
    assert.equal(shop.listOrders().unfulfilled, 0);

    await shop.startCheckout([green], 'refund-faulty', ORIGIN);
    const faultyId = sessionId(db);
    payments.pay(faultyId);
    const faultyPaid = await shop.paymentResult(faultyId);
    if (faultyPaid.state !== 'paid') return;
    const faulty = await shop.refund(faultyPaid.order.number, 'faulty');
    assert.equal(faulty.paymentStatus, 'refunded');
    assert.equal(payments.refunds.at(-1)?.amountCents, undefined);
  });

  test('a failed or mismatched payment cannot create a second order', async () => {
    const { shop, payments, db, sent } = harness();
    await shop.startCheckout([green], 'fail-key-01', ORIGIN);
    const id = sessionId(db);
    payments.sessions.get(id)!.status = 'complete';
    await shop.handleStripeEvent({ id: 'evt_fail', type: 'checkout.session.async_payment_failed', data: { object: { id } } });
    const failed = await shop.paymentResult(id);
    assert.equal(failed.state, 'failed');
    assert.equal(shop.listOrders().orders.length, 0);
    assert.equal(shop.quote([green]).canCheckout, true);

    await shop.startCheckout([green], 'review-key-1', ORIGIN);
    const reviewId = sessionId(db);
    payments.pay(reviewId);
    payments.sessions.get(reviewId)!.amountTotal = 1;
    const reviewed = await shop.paymentResult(reviewId);
    assert.equal(reviewed.state, 'paid');
    if (reviewed.state !== 'paid') return;
    assert.equal(reviewed.order.reviewStatus, 'needs_review');
    assert.match(reviewed.order.reviewReason ?? '', /amount paid/);
    assert.equal(sent.length, 1);
    assert.equal(shop.listOrders().orders.length, 1);
  });

  test('invalid lines are rejected and payments stay off without Stripe', async () => {
    const { shop } = harness();
    assert.throws(() => shop.quote([{ productId: 'relic-top', colourId: 'navy', size: 'M', quantity: 1 }]), /isn’t available/);
    assert.throws(() => shop.quote([{ ...green, fit: { topSize: 'tiny' } }]), /valid answer/);
    assert.throws(() => shop.quote([{ ...green, quantity: 0 }]), /quantity/);

    const db = openDatabase(':memory:');
    const bare = new Shop(db, null, async () => 'skipped');
    const quote = bare.quote([green]);
    assert.equal(quote.paymentsConfigured, false);
    assert.equal(quote.canCheckout, false);
    assert.match(quote.shipping, /12/);
    await assert.rejects(() => bare.startCheckout([green], 'no-stripe-key', ORIGIN), /aren’t available/);
  });

  test('a second click while Stripe is opening does not reserve the pieces twice', async () => {
    const { shop, payments } = harness();
    let release!: () => void;
    payments.pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = shop.startCheckout([green], 'slow-key-001', ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await assert.rejects(() => shop.startCheckout([green], 'slow-key-001', ORIGIN), /already being opened/);
    release();
    const started = await first;
    assert.match(started.url, /^https:\/\/checkout\.stripe\.com/);
    assert.equal(payments.created.length, 1);
  });
});

describe('http webhook and admin', { concurrency: 1 }, () => {
  let server: Server;
  let base: string;
  let env: ReturnType<typeof harness>;

  before(async () => {
    env = harness();
    clearLoginAttempts();
    const handler = createHandler({
      shop: env.shop,
      db: env.db,
      adminPassword: 'test-password-123',
      next: (_req, res) => {
        res.statusCode = 404;
        res.end('no');
      },
    });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test('rejects a webhook that is not signed by Stripe', async () => {
    await env.shop.startCheckout([green], 'hook-key-001', ORIGIN);
    const id = sessionId(env.db);
    env.payments.pay(id);
    const payload = JSON.stringify({
      id: 'evt_forged',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id, object: 'checkout.session' } },
    });
    const forged = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=forged', 'content-type': 'application/json' },
      body: payload,
    });
    assert.equal(forged.status, 400);
    assert.equal(env.shop.listOrders().orders.length, 0);

    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const ok = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    assert.equal(ok.status, 200);
    const again = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      body: payload,
    });
    assert.equal(again.status, 200);
    assert.equal(env.shop.listOrders().orders.length, 1);
    assert.equal(env.sent.length, 1);
  });

  test('admin requires a password and can mark an order fulfilled', async () => {
    const anonymous = await fetch(`${base}/api/admin/orders`);
    assert.equal(anonymous.status, 403);

    const wrong = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope-nope-nope' }),
    });
    assert.equal(wrong.status, 403);

    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-123' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie') ?? '';
    assert.match(cookie, /esoterica_admin=/);
    assert.match(cookie, /HttpOnly/i);
    const token = cookie.split(';')[0];

    const orders = await fetch(`${base}/api/admin/orders`, { headers: { cookie: token } });
    assert.equal(orders.status, 200);
    const body = (await orders.json()) as { orders: { number: string; lines: { fit: { value: string | null }[] }[] }[] };
    assert.equal(body.orders[0].number, 'ES-1001');
    assert.equal(body.orders[0].lines[0].fit[0].value, 'S');

    const saved = await fetch(`${base}/api/admin/orders/ES-1001/fulfilment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: token },
      body: JSON.stringify({ status: 'fulfilled', note: 'Posted Friday' }),
    });
    assert.equal(saved.status, 200);
    const updated = (await saved.json()) as { order: { fulfilmentStatus: string; fulfilmentNote: string } };
    assert.equal(updated.order.fulfilmentStatus, 'fulfilled');
    assert.equal(updated.order.fulfilmentNote, 'Posted Friday');

    const cross = await fetch(`${base}/api/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ lines: [green] }),
    });
    assert.equal(cross.status, 403);
  });

  test('an admin refund accepts only change of mind or faulty', async () => {
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-123' }),
    });
    const token = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const anonymous = await fetch(`${base}/api/admin/orders/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: 'ES-1001', reason: 'faulty' }),
    });
    assert.equal(anonymous.status, 403);

    const rejected = await fetch(`${base}/api/admin/orders/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: token },
      body: JSON.stringify({ number: 'ES-1001', reason: 'store_credit' }),
    });
    assert.equal(rejected.status, 400);

    const refunded = await fetch(`${base}/api/admin/orders/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: token },
      body: JSON.stringify({ number: 'ES-1001', reason: 'change_of_mind' }),
    });
    assert.equal(refunded.status, 200);
    const body = (await refunded.json()) as { order: { paymentStatus: string } };
    assert.equal(body.order.paymentStatus, 'refunded');
    assert.equal(env.payments.refunds.at(-1)?.amountCents, 8000 - 1100);
    const listed = await fetch(`${base}/api/admin/orders`, { headers: { cookie: token } });
    const orders = (await listed.json()) as { unfulfilled: number; orders: { paymentStatus: string }[] };
    assert.equal(orders.orders[0].paymentStatus, 'refunded');
    assert.equal(orders.unfulfilled, 0);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

test('order pages escape customer text and show unanswered fit questions', () => {
  const order: ShownOrder = {
    number: 'ES-1001',
    placedAtLabel: '23 Oct 2026, 11:00 am Brisbane time',
    testMode: true,
    email: 'ari@example.com',
    contactName: '<script>alert(1)</script>',
    phone: null,
    address: ['1 <b>Example</b> St'],
    lines: [
      {
        productName: 'Relic Top',
        colourName: 'Green',
        size: 'M',
        quantity: 1,
        lineAmount: formatMoney(80),
        fit: [
          { label: 'Usual top size', value: 'S' },
          { label: 'Torso length', value: null },
          { label: 'Bust size', value: null },
        ],
      },
    ],
    subtotal: formatMoney(80),
    shipping: formatMoney(12),
    shippingLabel: 'Shipping within Australia',
    total: formatMoney(92),
    paymentStatus: 'paid',
    fulfilmentStatus: 'unfulfilled',
    fulfilmentNote: null,
    reviewStatus: 'ok',
    reviewReason: null,
    stripeReference: 'cs_test_abc',
    notification: 'skipped',
  };
  const html = adminOrdersHtml({ orders: [order], unfulfilled: 1, testMode: true });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /&#60;script&#62;/);
  assert.match(html, /Not answered/);
  assert.match(html, /Usual top size/);
  assert.match(html, /Stripe test mode/);
});
