import { announce, initSite, openCart } from './site.ts';
import * as cart from './cart.ts';
import { escapeHtml } from './format.ts';
import { imageEntry, photoToCome, picture } from './images.ts';

initSite();

type QuoteLine = {
  productId: string;
  colourId: string;
  productName: string;
  colourName: string;
  size: string;
  quantity: number;
  lineAmount: string;
  fitSummary: string | null;
};

type Quote = {
  lines: QuoteLine[];
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

const root = document.querySelector<HTMLElement>('[data-checkout]')!;
let submitting = false;

function payload() {
  return cart.getLines().map((line) => ({
    productId: line.productId,
    colourId: line.colourId,
    size: line.size,
    quantity: line.quantity,
    fit: line.fit,
  }));
}

function thumb(productId: string, colourId: string, colourName: string): string {
  const colour = cart.findProduct(productId)?.colours.find((item) => item.id === colourId);
  const img = colour?.images[0];
  if (img && imageEntry(img)) return picture({ ...img, alt: '' }, { sizes: '96px', className: 'cart-line__img' });
  return photoToCome(colourName, 'cart-line__img');
}

function checkoutKey(lines: ReturnType<typeof payload>): string {
  const sig = JSON.stringify(lines);
  const storageKey = `esoterica.checkout.${sig}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const key = crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  return key;
}

function pageHtml(quote: Quote): string {
  const lines = quote.lines
    .map(
      (line) => `<li class="cart-line">
        <div class="cart-line__media">${thumb(line.productId, line.colourId, line.colourName)}</div>
        <div class="cart-line__info">
          <div class="cart-line__head"><p class="cart-line__name">${escapeHtml(line.productName)}</p><p>${escapeHtml(line.lineAmount)}</p></div>
          <p>Colour ${escapeHtml(line.colourName)} · Size ${escapeHtml(line.size)} · Qty ${line.quantity}</p>
          <p class="muted">${line.fitSummary ? `Fit details: ${escapeHtml(line.fitSummary)}` : 'No fit details added. You can leave those blank.'}</p>
        </div>
      </li>`,
    )
    .join('');
  return `<h1 class="section-label">Checkout</h1>
    <p>Review your order, then continue to Stripe to enter your email, delivery address and payment. Card details are never stored here.</p>
    <ul class="cart-lines">${lines}</ul>
    <button type="button" class="text-button" data-edit-cart>Edit cart</button>
    <div class="totals">
      <div><span>Subtotal</span><span>${escapeHtml(quote.subtotal)}</span></div>
      <div><span>${escapeHtml(quote.shippingLabel)}</span><span>${escapeHtml(quote.shipping)}</span></div>
      <div><span>Total</span><span>${escapeHtml(quote.total)}</span></div>
    </div>
    <p class="muted">${escapeHtml(quote.shippingNote)} Shipping is included before you pay. <a href="policies.html#shipping">Shipping and returns</a> are not finalised. Australian Consumer Law still covers faulty goods.</p>
    <p class="muted">Opening the payment page holds these pieces for about ${quote.holdMinutes} minutes.</p>
    ${quote.testMode ? '<p class="muted">Stripe test mode is on, so you won’t be charged. Test card 4242 4242 4242 4242, any future expiry, any CVC.</p>' : ''}
    ${quote.blockingMessage ? `<p class="field-error">${escapeHtml(quote.blockingMessage)}</p>` : ''}
    <form data-pay>
      <button type="submit" class="button" ${quote.canCheckout ? '' : 'disabled'}>Continue to payment</button>
      <p class="field-error" data-pay-error></p>
    </form>`;
}

async function render(): Promise<void> {
  const lines = payload();
  if (!lines.length) {
    root.innerHTML = `<h1 class="section-label">Checkout</h1>
      <p>Your cart is empty.</p>
      <p><a class="button" href="./#shop">Back to the shop</a></p>`;
    return;
  }
  const response = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ lines }),
  });
  const data = (await response.json()) as Quote & { error?: string };
  if (!response.ok) {
    root.innerHTML = `<h1 class="section-label">Checkout</h1><p class="field-error">${escapeHtml(data.error ?? 'The cart could not be priced.')}</p>`;
    return;
  }
  root.innerHTML = pageHtml(data);
}

root.addEventListener('click', (event) => {
  const edit = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-edit-cart]');
  if (edit) openCart(edit);
});

root.addEventListener('submit', (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-pay]');
  if (!form) return;
  event.preventDefault();
  void pay(form);
});

async function pay(form: HTMLFormElement): Promise<void> {
  if (submitting) return;
  submitting = true;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = form.querySelector<HTMLElement>('[data-pay-error]')!;
  button.disabled = true;
  error.textContent = '';
  const lines = payload();
  const idempotencyKey = checkoutKey(lines);
  try {
    const result = await requestCheckout(lines, idempotencyKey);
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    error.textContent = result.error ?? 'The payment page could not be opened.';
    announce(error.textContent);
    button.disabled = false;
    submitting = false;
    if (result.code === 'capacity') void render();
  } catch {
    error.textContent = 'The payment page could not be opened. Nothing was charged.';
    button.disabled = false;
    submitting = false;
  }
}

async function requestCheckout(lines: ReturnType<typeof payload>, idempotencyKey: string, attempt = 0): Promise<{ url?: string; error?: string; code?: string }> {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ lines, idempotencyKey }),
  });
  const data = (await response.json()) as { url?: string; error?: string; code?: string };
  if (response.status === 409 && data.code === 'in_progress' && attempt < 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return requestCheckout(lines, idempotencyKey, attempt + 1);
  }
  return data;
}

cart.subscribe(() => {
  if (!submitting) void render();
});
void render();
