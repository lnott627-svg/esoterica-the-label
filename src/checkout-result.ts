import { initSite } from './site.ts';
import * as cart from './cart.ts';
import { resultHtml, type ShownOrder } from './order-view.ts';

initSite();

const root = document.querySelector<HTMLElement>('[data-result]')!;
const kind = root.dataset.result;

type Result = { state: string; order?: ShownOrder; error?: string };

async function showSuccess(): Promise<void> {
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!sessionId) {
    root.innerHTML = resultHtml({ state: 'not_found' });
    return;
  }
  root.innerHTML = `<h1 class="section-label">Checking payment</h1><p class="muted">Confirming this payment with Stripe.</p>`;
  const response = await fetch(`/api/checkout/result?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'application/json' },
  });
  const data = (await response.json()) as Result;
  if (!response.ok) {
    root.innerHTML = resultHtml({ state: 'not_found' });
    return;
  }
  root.innerHTML = resultHtml(data);
  if (data.state === 'paid') {
    cart.clear();
    document.title = `${data.order?.number ?? 'Order'} — esoterica`;
  } else {
    document.title = 'Payment — esoterica';
  }
}

async function showCancel(): Promise<void> {
  const reservationId = new URLSearchParams(location.search).get('reservation');
  let state = 'cancelled';
  if (reservationId) {
    const response = await fetch('/api/checkout/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ reservationId }),
    });
    const data = (await response.json()) as { state?: string };
    if (data.state === 'closed') state = 'closed';
    else if (data.state === 'unknown') state = 'cancelled';
    else state = 'cancelled';
  }
  root.innerHTML = resultHtml({ state });
  document.title = state === 'cancelled' ? 'Payment cancelled — esoterica' : 'Payment — esoterica';
}

if (kind === 'cancel') void showCancel();
else void showSuccess();
