import { site } from '../src/store.config.ts';
import type { PublicOrder } from './present.ts';
import type { Notifier } from './shop.ts';

function orderText(order: PublicOrder): string {
  const items = order.lines
    .map((line) => {
      const fit = line.fit.map((answer) => `  ${answer.label}: ${answer.value ?? 'Not answered'}`).join('\n');
      return `${line.productName} — ${line.colourName} / ${line.size} × ${line.quantity} — ${line.lineAmount}\n${fit}`;
    })
    .join('\n\n');
  return [
    `Order ${order.number}`,
    order.placedAtLabel,
    order.testMode ? 'Stripe test mode — this is not a real charge.' : '',
    '',
    order.email ?? 'No email captured',
    order.contactName ?? '',
    order.phone ?? '',
    ...order.address,
    '',
    items,
    '',
    `Subtotal ${order.subtotal}`,
    `${order.shippingLabel} ${order.shipping}`,
    `Total ${order.total}`,
    '',
    order.reviewStatus === 'needs_review' ? `Needs a look before you cut or sew: ${order.reviewReason}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Sends one founder email when Resend is configured. Otherwise the admin list is the record. */
export function createNotifier(): Notifier {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_FROM_EMAIL;
  const to = process.env.ORDER_NOTIFY_EMAIL || site.links.contactEmail;
  return async (order) => {
    if (!apiKey || !from || !to) return 'skipped';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${order.testMode ? '[Test] ' : ''}esoterica order ${order.number}`,
        text: orderText(order),
      }),
    });
    if (!response.ok) throw new Error(`Mail provider returned ${response.status}`);
    return 'sent';
  };
}
