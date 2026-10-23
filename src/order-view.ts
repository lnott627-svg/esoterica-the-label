import { escapeHtml } from './format.ts';

export type ShownFit = { label: string; value: string | null };
export type ShownLine = {
  productName: string;
  colourName: string;
  size: string;
  quantity: number;
  lineAmount: string;
  fit: ShownFit[];
};
export type ShownOrder = {
  number: string;
  placedAtLabel: string;
  testMode: boolean;
  email: string | null;
  contactName: string | null;
  phone: string | null;
  address: string[];
  lines: ShownLine[];
  subtotal: string;
  shipping: string;
  shippingLabel: string;
  total: string;
  fulfilmentStatus: 'unfulfilled' | 'fulfilled';
  fulfilmentNote: string | null;
  reviewStatus: 'ok' | 'needs_review';
  reviewReason: string | null;
  stripeReference: string;
  notification: 'pending' | 'sent' | 'skipped' | 'failed';
};

function t(value: string | number | null | undefined): string {
  return escapeHtml(value == null ? '' : String(value));
}

function fitHtml(line: ShownLine): string {
  return `<dl class="fit-readout">${line.fit
    .map((answer) => `<div><dt>${t(answer.label)}</dt><dd>${answer.value ? t(answer.value) : 'Not answered'}</dd></div>`)
    .join('')}</dl>`;
}

function linesHtml(lines: ShownLine[]): string {
  return `<ul class="order__lines">${lines
    .map(
      (line) => `<li>
        <p class="cart-line__name">${t(line.productName)}</p>
        <p>Colour ${t(line.colourName)} · Size ${t(line.size)} · Qty ${t(line.quantity)}</p>
        <p>${t(line.lineAmount)}</p>
        ${fitHtml(line)}
      </li>`,
    )
    .join('')}</ul>`;
}

function totalsHtml(order: Pick<ShownOrder, 'subtotal' | 'shipping' | 'shippingLabel' | 'total'>): string {
  return `<div class="totals">
    <div><span>Subtotal</span><span>${t(order.subtotal)}</span></div>
    <div><span>${t(order.shippingLabel)}</span><span>${t(order.shipping)}</span></div>
    <div><span>Total</span><span>${t(order.total)}</span></div>
  </div>`;
}

export function customerOrderHtml(order: ShownOrder): string {
  const address = order.address.length ? order.address.map((line) => t(line)).join('<br>') : 'No delivery address captured';
  return `<article class="order">
    <div class="order__head">
      <h2 class="order__number">${t(order.number)}</h2>
      <p>${t(order.placedAtLabel)}</p>
    </div>
    ${order.testMode ? '<p class="muted">This was a Stripe test payment. You were not charged.</p>' : ''}
    <p>${t(order.email) || 'No email captured'}${order.contactName ? `<br>${t(order.contactName)}` : ''}${order.phone ? `<br>${t(order.phone)}` : ''}</p>
    <p class="address">${address}</p>
    ${linesHtml(order.lines)}
    ${totalsHtml(order)}
  </article>`;
}

const NOTIFICATION: Record<ShownOrder['notification'], string> = {
  sent: 'An email was sent to the studio.',
  skipped: 'No email was sent. This page is the record of the order.',
  failed: 'The email could not be sent. The order is still recorded here.',
  pending: 'The email is waiting to send.',
};

export function adminOrdersHtml(input: { orders: ShownOrder[]; unfulfilled: number; testMode: boolean }): string {
  const waiting =
    input.unfulfilled === 0
      ? 'Nothing waiting to be made or sent.'
      : `${input.unfulfilled} ${input.unfulfilled === 1 ? 'order' : 'orders'} to make and send.`;
  const banner = input.testMode ? '<p class="muted">Stripe test mode is on. These payments are not real charges.</p>' : '';
  if (!input.orders.length) {
    return `${banner}<p>${waiting}</p><p class="muted">Paid orders appear here after Stripe confirms them. The success page alone does not create an order.</p>`;
  }
  const cards = input.orders
    .map((order) => {
      const next = order.fulfilmentStatus === 'fulfilled' ? 'unfulfilled' : 'fulfilled';
      const label = next === 'fulfilled' ? 'Mark as fulfilled' : 'Mark as not fulfilled';
      const review =
        order.reviewStatus === 'needs_review'
          ? `<p class="review">Check this payment in Stripe before cutting or sewing. ${t(order.reviewReason)}</p>`
          : '';
      return `<article class="order">
        <div class="order__head">
          <h2 class="order__number">${t(order.number)}</h2>
          <p>${t(order.placedAtLabel)}</p>
        </div>
        <p>${order.testMode ? 'Test payment · ' : ''}Paid · ${order.fulfilmentStatus === 'fulfilled' ? 'Fulfilled' : 'To make and send'}</p>
        ${review}
        <p>${t(order.email) || 'No email captured'}${order.contactName ? `<br>${t(order.contactName)}` : ''}${order.phone ? `<br>${t(order.phone)}` : ''}</p>
        <p class="address">${order.address.length ? order.address.map((line) => t(line)).join('<br>') : 'No delivery address captured'}</p>
        ${linesHtml(order.lines)}
        ${totalsHtml(order)}
        <p class="muted">${t(NOTIFICATION[order.notification])} Stripe reference ${t(order.stripeReference)}</p>
        <form class="fulfil" data-order="${t(order.number)}">
          <label class="field">
            <span class="field-label" for="note-${t(order.number)}">Postage note, optional</span>
            <input class="input" id="note-${t(order.number)}" name="note" maxlength="400" value="${t(order.fulfilmentNote)}">
          </label>
          <button type="submit" class="${next === 'fulfilled' ? 'button' : 'text-button'}" data-status="${next}">${label}</button>
          <p class="field-error" data-fulfil-error></p>
        </form>
      </article>`;
    })
    .join('');
  return `${banner}<p>${waiting}</p>${cards}<button type="button" class="text-button" data-logout>Log out</button>`;
}

export function resultHtml(result: { state: string; order?: ShownOrder }): string {
  if (result.state === 'paid' && result.order) {
    return `<h1 class="section-label">Payment confirmed</h1>
      <p>Stripe has confirmed this payment. Your order number is ${t(result.order.number)}.</p>
      ${customerOrderHtml(result.order)}
      <p><a class="button" href="./">Back to the shop</a></p>`;
  }
  const copy: Record<string, { title: string; body: string }> = {
    processing: {
      title: 'Payment processing',
      body: 'Stripe has not confirmed this payment yet. This page is not a receipt. If the payment clears, the order is recorded from Stripe, even if you close this page.',
    },
    unpaid: {
      title: 'Payment not completed',
      body: 'No charge was made, and no order was placed.',
    },
    expired: {
      title: 'Checkout expired',
      body: 'The payment page expired before it was completed. No charge was made.',
    },
    failed: {
      title: 'Payment failed',
      body: 'The payment didn’t go through, so no order was placed.',
    },
    not_found: {
      title: 'Payment not found',
      body: 'That payment could not be confirmed with Stripe.',
    },
    cancelled: {
      title: 'Payment cancelled',
      body: 'No charge was made, and no order was placed. The pieces are free for someone else to order.',
    },
    closed: {
      title: 'Checkout already closed',
      body: 'If you finished paying, use the confirmation page Stripe opened. Otherwise no new charge was made.',
    },
  };
  const state = copy[result.state] ?? copy.not_found;
  return `<h1 class="section-label">${state.title}</h1>
    <p>${state.body}</p>
    <p><a class="button" href="checkout.html">Return to checkout</a></p>
    <p><a href="./">Back to the shop</a></p>`;
}
