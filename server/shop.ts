import { randomUUID } from 'node:crypto';
import {
  capacityFor,
  holdMinutes,
  quoteTotals,
  resolveLines,
  variantKey,
  OrderError,
  type PricedLine,
} from '../src/domain.ts';
import { cleanFit, fitLines, type FitAnswers } from '../src/fit.ts';
import { formatMoney } from '../src/format.ts';
import { products, site } from '../src/store.config.ts';
import { all, get, transaction, type ShopDb } from './db.ts';
import type { CheckoutSnapshot, Payments, StripeEventInput, StripeLine } from './payments.ts';
import { toPublicLine, toPublicOrder, type OrderRow, type PublicOrder } from './present.ts';

export type Notifier = (order: PublicOrder) => Promise<'sent' | 'skipped' | 'failed'>;

export type Quote = {
  lines: ReturnType<typeof toPublicLine>[];
  subtotal: string;
  shipping: string;
  shippingLabel: string;
  shippingNote: string;
  total: string;
  canCheckout: boolean;
  blockingMessage: string | null;
  paymentsConfigured: boolean;
  testMode: boolean;
  holdMinutes: number;
};

type ReservationRow = {
  id: string;
  idempotency_key: string | null;
  status: string;
  session_id: string | null;
  checkout_url: string | null;
  lines: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  expires_at: string;
  created_at: string;
};

const ORDER_COLUMNS = `number, session_id, lines, subtotal_cents, shipping_cents, total_cents, email, contact_name, phone,
  shipping_name, address_json, payment_status, fulfilment_status, fulfilment_note, review_status, review_reason,
  livemode, notification, created_at`;

export class Shop {
  private db: ShopDb;
  private payments: Payments | null;
  private notifier: Notifier;
  private now: () => Date;

  constructor(db: ShopDb, payments: Payments | null, notifier: Notifier, now: () => Date = () => new Date()) {
    this.db = db;
    this.payments = payments;
    this.notifier = notifier;
    this.now = now;
  }

  quote(input: unknown): Quote {
    const lines = resolveLines(input);
    this.sweep();
    const totals = quoteTotals(lines);
    const capacityMessage = this.capacityMessage(lines);
    const paymentsConfigured = Boolean(this.payments);
    let blockingMessage = capacityMessage;
    if (!blockingMessage && !paymentsConfigured) {
      blockingMessage =
        process.env.NODE_ENV === 'production'
          ? 'Payments aren’t available right now. Please check back soon.'
          : 'Payments aren’t switched on yet. Add your Stripe test keys to .env and restart.';
    }
    const presented = lines.map(toPublicLine);
    return {
      lines: presented,
      subtotal: formatMoney(totals.subtotalCents / 100),
      shipping: formatMoney(totals.shippingCents / 100),
      shippingLabel: totals.shippingLabel,
      shippingNote: totals.shippingNote,
      total: formatMoney(totals.totalCents / 100),
      canCheckout: !capacityMessage && paymentsConfigured,
      blockingMessage,
      paymentsConfigured,
      testMode: this.payments?.testMode ?? false,
      holdMinutes: holdMinutes(),
    };
  }

  async startCheckout(input: unknown, idempotencyKey: string, origin: string): Promise<{ url: string }> {
    if (!this.payments) throw new OrderError('payments', 'Payments aren’t available right now.');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
      throw new OrderError('invalid', 'Checkout could not be started. Refresh the page and try again.');
    }
    const lines = resolveLines(input);
    const totals = quoteTotals(lines);
    const existing = get<ReservationRow>(
      this.db.prepare('SELECT * FROM reservations WHERE idempotency_key = ?'),
      idempotencyKey,
    );
    if (existing?.checkout_url && existing.status !== 'released' && existing.status !== 'payment_failed') {
      return { url: existing.checkout_url };
    }
    if (existing && existing.status === 'held' && !existing.checkout_url) {
      throw new OrderError('in_progress', 'Checkout is already being opened. Try again in a moment.');
    }

    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + holdMinutes() * 60_000).toISOString();
    transaction(this.db, () => {
      this.sweep();
      const message = this.capacityMessage(lines);
      if (message) throw new OrderError('capacity', message);
      this.db
        .prepare(
          `INSERT INTO reservations
            (id, idempotency_key, status, lines, subtotal_cents, shipping_cents, total_cents, currency, expires_at, created_at)
           VALUES (?, ?, 'held', ?, ?, ?, ?, 'aud', ?, ?)`,
        )
        .run(id, idempotencyKey, JSON.stringify(lines), totals.subtotalCents, totals.shippingCents, totals.totalCents, expiresAt, createdAt);
    });

    try {
      const session = await this.payments.createCheckoutSession({
        reservationId: id,
        idempotencyKey,
        lines,
        shippingCents: totals.shippingCents,
        successUrl: `${origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/checkout-cancel.html?reservation=${encodeURIComponent(id)}`,
        expiresAt: Math.floor(new Date(expiresAt).getTime() / 1000),
      });
      this.db.prepare(`UPDATE reservations SET session_id = ?, checkout_url = ? WHERE id = ?`).run(session.id, session.url, id);
      return { url: session.url };
    } catch (error) {
      this.db
        .prepare(`UPDATE reservations SET status = 'released', idempotency_key = NULL WHERE id = ? AND status = 'held'`)
        .run(id);
      if (error instanceof OrderError) throw error;
      console.error('[esoterica] Stripe Checkout could not be created');
      throw new OrderError('payments', 'The payment page could not be opened. Nothing was charged. Try again.');
    }
  }

  async cancel(reservationId: string): Promise<{ state: 'cancelled' | 'closed' | 'unknown' }> {
    if (!/^[0-9a-f-]{36}$/i.test(reservationId)) return { state: 'unknown' };
    const reservation = get<ReservationRow>(this.db.prepare('SELECT * FROM reservations WHERE id = ?'), reservationId);
    if (!reservation) return { state: 'unknown' };
    if (reservation.status === 'paid' || reservation.status === 'processing') return { state: 'closed' };
    if (reservation.session_id && this.payments) {
      const session = await this.payments.retrieveCheckoutSession(reservation.session_id);
      if (session?.paymentStatus === 'paid') {
        await this.recordPaid(session);
        return { state: 'closed' };
      }
      if (session?.status === 'open') {
        try {
          await this.payments.expireCheckoutSession(reservation.session_id);
        } catch {
          /* already expired or completed */
        }
      }
    }
    this.releaseHeld(reservation.id, reservation.session_id);
    return { state: 'cancelled' };
  }

  async paymentResult(sessionId: string): Promise<PaymentResult> {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      throw new OrderError('invalid', 'That payment reference doesn’t look right.');
    }
    // Already recorded from a verified Stripe session. A refresh must not depend on Stripe being reachable.
    const existing = get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE session_id = ?`), sessionId);
    if (existing) return { state: 'paid', order: toPublicOrder(existing, site.shippingRate.displayName) };
    return this.settle(sessionId);
  }

  async handleStripeEvent(event: StripeEventInput): Promise<{ duplicate: boolean }> {
    if (!event.id || !event.type) throw new OrderError('invalid', 'Webhook payload is invalid.');
    if (this.seenEvent(event.id)) return { duplicate: true };
    const sessionId = event.data?.object?.id;
    if (!sessionId) throw new OrderError('invalid', 'Webhook is missing a checkout session.');
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.settle(sessionId);
        break;
      case 'checkout.session.async_payment_failed':
        await this.fail(sessionId);
        break;
      case 'checkout.session.expired':
        await this.expire(sessionId);
        break;
      case 'charge.refunded':
        await this.syncRefund(sessionId); // sessionId is the charge id for this event
        break;
    }
    this.rememberEvent(event.id, event.type);
    return { duplicate: false };
  }

  constructWebhook(payload: string, signature: string) {
    if (!this.payments) throw new OrderError('payments', 'Webhook signing is not configured.');
    try {
      return this.payments.constructEvent(payload, signature);
    } catch (error) {
      if (error instanceof OrderError) throw error;
      throw new OrderError('invalid', 'Webhook signature could not be verified.');
    }
  }

  testMode(): boolean {
    return this.payments?.testMode ?? false;
  }

  listOrders(): { orders: PublicOrder[]; unfulfilled: number } {
    const rows = all<OrderRow>(
      this.db.prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders
         ORDER BY CASE fulfilment_status WHEN 'unfulfilled' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 200`,
      ),
    );
    const orders = rows.map((row) => toPublicOrder(row, site.shippingRate.displayName));
    return {
      orders,
      unfulfilled: orders.filter((order) => order.paymentStatus === 'paid' && order.fulfilmentStatus === 'unfulfilled').length,
    };
  }

  setFulfilment(number: string, status: 'fulfilled' | 'unfulfilled', note: string | null): PublicOrder {
    if (!/^ES-\d+$/.test(number)) throw new OrderError('not_found', 'Order not found.');
    const noteValue = note?.trim() ? note.trim().slice(0, 400) : null;
    const updated = transaction(this.db, () => {
      const row = get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE number = ?`), number);
      if (!row) throw new OrderError('not_found', 'Order not found.');
      if (status === 'unfulfilled' && row.fulfilment_status === 'fulfilled') {
        const lines = JSON.parse(row.lines) as PricedLine[];
        const message = this.capacityMessage(lines);
        if (message) throw new OrderError('capacity', `This order can’t be reopened. ${message}`);
      }
      this.db
        .prepare(
          `UPDATE orders
           SET fulfilment_status = ?, fulfilment_note = ?, fulfilled_at = ?
           WHERE number = ?`,
        )
        .run(status, noteValue, status === 'fulfilled' ? this.now().toISOString() : null, number);
      return get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE number = ?`), number)!;
    });
    return toPublicOrder(updated, site.shippingRate.displayName);
  }

  async refund(number: string, reason: 'change_of_mind' | 'faulty'): Promise<PublicOrder> {
    if (!this.payments) throw new OrderError('payments', 'Payments aren’t available right now.');
    if (!/^ES-\d+$/.test(number)) throw new OrderError('not_found', 'Order not found.');
    const row = get<{
      payment_intent_id: string | null;
      payment_status: string;
      subtotal_cents: number;
      lines: string;
    }>(
      this.db.prepare('SELECT payment_intent_id, payment_status, subtotal_cents, lines FROM orders WHERE number = ?'),
      number,
    );
    if (!row) throw new OrderError('not_found', 'Order not found.');
    if (row.payment_status === 'paid') {
      if (!row.payment_intent_id) throw new OrderError('invalid', 'This order has no payment to refund.');
      let amountCents: number | undefined; // undefined = full refund incl. shipping (faulty / ACL)
      if (reason === 'change_of_mind') {
        const items = (JSON.parse(row.lines) as PricedLine[]).reduce((n, l) => n + l.quantity, 0);
        const restock = 1100 * items; // $11 AUD per item
        amountCents = row.subtotal_cents - restock; // shipping is NOT refunded
        if (amountCents <= 0) {
          throw new OrderError('invalid', 'The restocking fee meets or exceeds the item value — nothing to refund.');
        }
      }
      await this.payments.refundPayment(row.payment_intent_id, amountCents);
      this.db.prepare(`UPDATE orders SET payment_status = 'refunded' WHERE number = ? AND payment_status = 'paid'`).run(number);
    } else if (row.payment_status !== 'refunded') {
      throw new OrderError('invalid', 'Only a paid order can be refunded.');
    }
    const full = get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE number = ?`), number)!;
    return toPublicOrder(full, site.shippingRate.displayName);
  }

  private async settle(sessionId: string): Promise<PaymentResult> {
    const session = await this.retrieve(sessionId);
    if (!session) return { state: 'not_found' };
    if (session.paymentStatus === 'paid') {
      const order = await this.recordPaid(session);
      return { state: 'paid', order };
    }
    const reservation = this.reservationFor(session);
    if (reservation?.status === 'payment_failed') return { state: 'failed' };
    if (session.status === 'expired') {
      this.releaseHeld(reservation?.id ?? null, session.id);
      return { state: 'expired' };
    }
    if (session.status === 'complete') {
      this.markStatus(session, 'processing');
      return { state: 'processing' };
    }
    return { state: 'unpaid' };
  }

  private async fail(sessionId: string): Promise<void> {
    const session = await this.retrieve(sessionId);
    if (session?.paymentStatus === 'paid') {
      await this.recordPaid(session);
      return;
    }
    this.markStatus(session, 'payment_failed', sessionId);
  }

  private async expire(sessionId: string): Promise<void> {
    const session = await this.retrieve(sessionId);
    if (session?.paymentStatus === 'paid') {
      await this.recordPaid(session);
      return;
    }
    this.releaseHeld(session?.reservationId ?? null, sessionId);
  }

  private async syncRefund(chargeId: string): Promise<void> {
    if (!this.payments) return;
    const state = await this.payments.refundStateForCharge(chargeId);
    if (!state?.paymentIntentId || state.status !== 'full') return; // partial refunds don't free the slot
    this.db
      .prepare(`UPDATE orders SET payment_status = 'refunded' WHERE payment_intent_id = ? AND payment_status = 'paid'`)
      .run(state.paymentIntentId);
  }

  private async retrieve(sessionId: string): Promise<CheckoutSnapshot | null> {
    if (!this.payments) throw new OrderError('payments', 'Payments aren’t available right now.');
    return this.payments.retrieveCheckoutSession(sessionId);
  }

  private async recordPaid(session: CheckoutSnapshot): Promise<PublicOrder> {
    const created = transaction(this.db, () => {
      const existing = get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE session_id = ?`), session.id);
      if (existing) return { order: existing, created: false };
      const reservation = this.reservationFor(session);
      const built = this.orderContents(session, reservation);
      const counter = get<{ value: number }>(
        this.db.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'order' RETURNING value`),
      );
      if (!counter) throw new Error('Order counter is missing.');
      const number = `ES-${counter.value}`;
      const createdAt = this.now().toISOString();
      this.db
        .prepare(
          `INSERT INTO orders (
            number, reservation_id, session_id, payment_intent_id, lines, subtotal_cents, shipping_cents, total_cents,
            currency, email, contact_name, phone, shipping_name, address_json, payment_status, fulfilment_status,
            review_status, review_reason, livemode, notification, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aud', ?, ?, ?, ?, ?, 'paid', 'unfulfilled', ?, ?, ?, 'pending', ?)`,
        )
        .run(
          number,
          reservation?.id ?? session.reservationId,
          session.id,
          session.paymentIntentId,
          JSON.stringify(built.lines),
          built.subtotalCents,
          built.shippingCents,
          built.totalCents,
          session.customerEmail,
          session.customerName,
          session.customerPhone,
          session.shippingName,
          session.shipping ? JSON.stringify(session.shipping) : null,
          built.reviewStatus,
          built.reviewReason,
          session.livemode ? 1 : 0,
          createdAt,
        );
      if (reservation) {
        this.db.prepare(`UPDATE reservations SET status = 'paid', session_id = COALESCE(session_id, ?) WHERE id = ?`).run(session.id, reservation.id);
      }
      const order = get<OrderRow>(this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE session_id = ?`), session.id)!;
      return { order, created: true };
    });

    const order = toPublicOrder(created.order, site.shippingRate.displayName);
    if (created.created) {
      console.log(`[esoterica] order ${order.number} recorded`);
      let notification: PublicOrder['notification'] = 'failed';
      try {
        notification = await this.notifier(order);
      } catch (error) {
        console.error('[esoterica] order notification failed', error instanceof Error ? error.message : '');
      }
      this.db.prepare(`UPDATE orders SET notification = ? WHERE number = ? AND notification = 'pending'`).run(notification, order.number);
      order.notification = notification;
    }
    return order;
  }

  private orderContents(session: CheckoutSnapshot, reservation: ReservationRow | undefined): {
    lines: PricedLine[];
    subtotalCents: number;
    shippingCents: number;
    totalCents: number;
    reviewStatus: 'ok' | 'needs_review';
    reviewReason: string | null;
  } {
    const reasons: string[] = [];
    const reservedLines = reservation ? (JSON.parse(reservation.lines) as PricedLine[]) : null;
    const lines = reservedLines ?? linesFromStripe(session.lineItems);
    if (!reservation) reasons.push('The payment could not be matched to a checkout held on this server.');
    if (!lines.length) reasons.push('No items could be read from the payment.');
    const subtotalCents = reservation?.subtotal_cents ?? session.amountSubtotal ?? 0;
    const shippingCents = reservation?.shipping_cents ?? session.amountShipping ?? 0;
    const totalCents = reservation?.total_cents ?? session.amountTotal ?? subtotalCents + shippingCents;
    if (session.currency && session.currency !== 'aud') reasons.push('Currency was not AUD.');
    if (reservation && session.amountSubtotal != null && session.amountSubtotal !== reservation.subtotal_cents) {
      reasons.push('The item total from Stripe did not match the checkout that was created.');
    }
    if (reservation && session.amountShipping != null && session.amountShipping !== reservation.shipping_cents) {
      reasons.push('The shipping total from Stripe did not match the checkout that was created.');
    }
    if (reservation && session.amountTotal != null && session.amountTotal !== reservation.total_cents) {
      reasons.push('The amount paid did not match the checkout total.');
    }
    if (reservation && session.lineItems.length && session.lineItems.length !== reservedLines!.length) {
      reasons.push('The number of items Stripe charged did not match the cart.');
    }
    if (!session.customerEmail) reasons.push('No customer email was captured.');
    if (!session.shipping) reasons.push('No shipping address was captured.');
    else if (session.shipping.country && session.shipping.country.toUpperCase() !== 'AU') {
      reasons.push('The shipping country was not Australia.');
    }
    return {
      lines,
      subtotalCents,
      shippingCents,
      totalCents,
      reviewStatus: reasons.length ? 'needs_review' : 'ok',
      reviewReason: reasons.length ? reasons.join(' ') : null,
    };
  }

  private capacityMessage(lines: PricedLine[]): string | null {
    const requested = new Map<string, { units: number; sample: PricedLine }>();
    for (const line of lines) {
      const key = variantKey(line);
      const current = requested.get(key);
      if (current) current.units += line.quantity;
      else requested.set(key, { units: line.quantity, sample: line });
    }
    for (const [key, request] of requested) {
      const cap = capacityFor(request.sample);
      const used = this.unitsInUse(key);
      if (used + request.units > cap) {
        const name = `${request.sample.productName} in ${request.sample.colourName}, size ${request.sample.size}`;
        const left = Math.max(cap - used, 0);
        if (left === 0) return `${name} can’t be accepted right now.`;
        return `Only ${left} of ${name} can be accepted right now.`;
      }
    }
    return null;
  }

  private unitsInUse(key: string): number {
    const now = this.now().toISOString();
    let total = 0;
    const reservations = all<{ lines: string }>(
      this.db.prepare(
        `SELECT lines FROM reservations
         WHERE status = 'processing' OR (status = 'held' AND expires_at > ?)`,
      ),
      now,
    );
    const orders = all<{ lines: string }>(
      this.db.prepare(`SELECT lines FROM orders WHERE payment_status = 'paid' AND fulfilment_status = 'unfulfilled'`),
    );
    for (const row of [...reservations, ...orders]) {
      const lines = JSON.parse(row.lines) as PricedLine[];
      for (const line of lines) if (variantKey(line) === key) total += line.quantity;
    }
    return total;
  }

  private sweep(): void {
    this.db
      .prepare(`UPDATE reservations SET status = 'released', idempotency_key = NULL WHERE status = 'held' AND expires_at <= ?`)
      .run(this.now().toISOString());
  }

  private reservationFor(session: CheckoutSnapshot): ReservationRow | undefined {
    return (
      get<ReservationRow>(this.db.prepare('SELECT * FROM reservations WHERE session_id = ?'), session.id) ??
      (session.reservationId
        ? get<ReservationRow>(this.db.prepare('SELECT * FROM reservations WHERE id = ?'), session.reservationId)
        : undefined)
    );
  }

  private releaseHeld(reservationId: string | null, sessionId: string | null): void {
    if (reservationId) {
      this.db
        .prepare(`UPDATE reservations SET status = 'released', idempotency_key = NULL WHERE id = ? AND status = 'held'`)
        .run(reservationId);
    }
    if (sessionId) {
      this.db
        .prepare(`UPDATE reservations SET status = 'released', idempotency_key = NULL WHERE session_id = ? AND status = 'held'`)
        .run(sessionId);
    }
  }

  private markStatus(session: CheckoutSnapshot | null, status: 'processing' | 'payment_failed', fallbackSessionId?: string): void {
    const reservationId = session?.reservationId;
    const sessionId = session?.id ?? fallbackSessionId;
    if (status === 'processing') {
      if (reservationId) {
        this.db.prepare(`UPDATE reservations SET status = 'processing' WHERE id = ? AND status = 'held'`).run(reservationId);
      }
      return;
    }
    if (reservationId) {
      this.db
        .prepare(`UPDATE reservations SET status = 'payment_failed', idempotency_key = NULL WHERE id = ? AND status IN ('held', 'processing')`)
        .run(reservationId);
    } else if (sessionId) {
      this.db
        .prepare(
          `UPDATE reservations SET status = 'payment_failed', idempotency_key = NULL WHERE session_id = ? AND status IN ('held', 'processing')`,
        )
        .run(sessionId);
    }
  }

  private seenEvent(id: string): boolean {
    return Boolean(get(this.db.prepare('SELECT event_id FROM webhook_events WHERE event_id = ?'), id));
  }

  private rememberEvent(id: string, type: string): void {
    try {
      this.db.prepare('INSERT INTO webhook_events (event_id, type, received_at) VALUES (?, ?, ?)').run(id, type, this.now().toISOString());
    } catch {
      /* another delivery already recorded it */
    }
  }
}

export type PaymentResult =
  | { state: 'paid'; order: PublicOrder }
  | { state: 'processing' | 'unpaid' | 'expired' | 'failed' | 'not_found' };

function linesFromStripe(items: StripeLine[]): PricedLine[] {
  return items
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const colour = product?.colours.find((candidate) => candidate.id === item.colourId);
      let fit: FitAnswers = {};
      if (item.fitJson) {
        try {
          const parsed = JSON.parse(item.fitJson) as FitAnswers;
          if (parsed && typeof parsed === 'object') fit = cleanFit(parsed);
        } catch {
          fit = {};
        }
      }
      const unitAmountCents = item.unitAmountCents ?? 0;
      return {
        productId: item.productId ?? 'unknown',
        productName: product?.name ?? item.name ?? 'Item',
        colourId: item.colourId ?? 'unknown',
        colourName: colour?.name ?? 'Unknown',
        size: item.size ?? '?',
        quantity: item.quantity,
        unitAmountCents,
        lineAmountCents: unitAmountCents * item.quantity,
        fit,
        fitLines: fitLines(fit),
      };
    });
}
