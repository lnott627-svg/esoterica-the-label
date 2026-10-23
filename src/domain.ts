import { fitLines, readFitStrict, summariseFit, type FitAnswers, type FitLine } from './fit.ts';
import { products, site, type Product } from './store.config.ts';

export const MAX_QTY = 10;

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OrderError';
    this.code = code;
  }
}

export type LineInput = {
  productId: string;
  colourId: string;
  size: string;
  quantity: number;
  fit?: FitAnswers;
};

export type PricedLine = {
  productId: string;
  productName: string;
  colourId: string;
  colourName: string;
  size: string;
  quantity: number;
  unitAmountCents: number;
  lineAmountCents: number;
  fit: FitAnswers;
  fitLines: FitLine[];
};

export type QuoteTotals = {
  currency: 'AUD';
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  shippingLabel: string;
  shippingNote: string;
};

export function audToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new OrderError('price', 'Invalid price.');
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 0.001) throw new OrderError('price', 'Invalid price.');
  return cents;
}

export function variantKey(line: { productId: string; colourId: string; size: string }): string {
  return `${line.productId}|${line.colourId}|${line.size}`;
}

export function lineTitle(line: Pick<PricedLine, 'productName' | 'colourName' | 'size'>): string {
  return `${line.productName} – ${line.colourName} / ${line.size}`;
}

export function lineDescription(line: PricedLine): string {
  const answered = line.fitLines.filter((f) => f.value);
  const garment = `${line.colourName}, size ${line.size}`;
  if (!answered.length) return `${garment}. No fit details supplied.`;
  return `${garment}. Fit notes: ${answered.map((f) => `${f.short} ${f.value}`).join(', ')}.`;
}

export function capacityFor(line: { productId: string; colourId: string; size: string }): number {
  const product = products.find((p) => p.id === line.productId);
  const n = product?.capacity?.[line.colourId]?.[line.size];
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
}

export function holdMinutes(): number {
  return Math.max(35, site.checkoutHoldMinutes);
}

function productOf(id: string): Product {
  const product = products.find((p) => p.id === id);
  if (!product) throw new OrderError('invalid', 'That piece is no longer in the shop.');
  return product;
}

function oneLine(raw: unknown): PricedLine {
  if (!raw || typeof raw !== 'object') throw new OrderError('invalid', 'A cart line is invalid.');
  const row = raw as Record<string, unknown>;
  if (typeof row.productId !== 'string' || typeof row.colourId !== 'string' || typeof row.size !== 'string') {
    throw new OrderError('invalid', 'A cart line is invalid.');
  }
  if (typeof row.quantity !== 'number' || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > MAX_QTY) {
    throw new OrderError('quantity', `Enter a quantity from 1 to ${MAX_QTY}.`);
  }
  let fit: FitAnswers;
  try {
    fit = readFitStrict(row.fit);
  } catch (error) {
    throw new OrderError('fit', error instanceof Error ? error.message : 'Fit details are invalid.');
  }
  const product = productOf(row.productId);
  const colour = product.colours.find((c) => c.id === row.colourId);
  if (!colour || colour.status !== 'available') {
    throw new OrderError('invalid', 'That colour isn’t available.');
  }
  if (!product.sizes?.includes(row.size)) throw new OrderError('invalid', 'That size isn’t available.');
  if (!product.price) throw new OrderError('price', `${product.name} doesn’t have a price yet.`);
  const unitAmountCents = audToCents(product.price.amount);
  return {
    productId: product.id,
    productName: product.name,
    colourId: colour.id,
    colourName: colour.name,
    size: row.size,
    quantity: row.quantity,
    unitAmountCents,
    lineAmountCents: unitAmountCents * row.quantity,
    fit,
    fitLines: fitLines(fit),
  };
}

export function resolveLines(input: unknown): PricedLine[] {
  if (!Array.isArray(input) || input.length === 0) throw new OrderError('empty', 'Your cart is empty.');
  if (input.length > 30) throw new OrderError('invalid', 'Too many items in the cart.');
  const merged = new Map<string, PricedLine>();
  for (const raw of input) {
    const line = oneLine(raw);
    const key = `${variantKey(line)}|${line.fitLines.map((f) => f.value ?? '').join(',')}`;
    const existing = merged.get(key);
    if (existing) {
      const quantity = existing.quantity + line.quantity;
      if (quantity > MAX_QTY) {
        throw new OrderError('quantity', `You can order at most ${MAX_QTY} of the same item.`);
      }
      existing.quantity = quantity;
      existing.lineAmountCents = existing.unitAmountCents * quantity;
    } else {
      merged.set(key, line);
    }
  }
  return [...merged.values()];
}

export function quoteTotals(lines: PricedLine[]): QuoteTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineAmountCents, 0);
  const shippingCents = audToCents(site.shippingRate.amount);
  if (site.shippingRate.currency !== 'AUD') throw new OrderError('price', 'Shipping currency must be AUD.');
  return {
    currency: 'AUD',
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    shippingLabel: site.shippingRate.displayName,
    shippingNote: site.shippingRate.note,
  };
}

export function summariseLineFit(line: PricedLine): string | null {
  return summariseFit(line.fit);
}

export function brisbaneLabel(iso: string): string {
  const formatted = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).format(new Date(iso));
  return `${formatted} Brisbane time`;
}

export function countryName(code: string): string {
  if (code.toUpperCase() === 'AU') return 'Australia';
  return code.toUpperCase();
}
