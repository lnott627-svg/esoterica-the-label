import type { Money } from './store.config.ts';

const aud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number, currency: Money['currency'] = 'AUD'): string {
  return `${aud.format(amount)} ${currency}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Visible marker for information still to be supplied by the store owner. */
export function todo(text: string): string {
  return `<span class="todo">To supply: ${escapeHtml(text)}</span>`;
}
