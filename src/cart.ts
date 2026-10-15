import { products, type Product } from './store.config.ts';

/*
 * Prototype cart, persisted to localStorage. No checkout or payment is wired up.
 * When a commerce backend is connected, map each line with `toOrderLine` so the
 * fit answers travel with the order (e.g. as Shopify line item attributes).
 */

export const FIT_QUESTIONS = [
  {
    id: 'topSize',
    label: 'What top size do you generally wear?',
    short: 'Usual top size',
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'torsoLength',
    label: 'How would you describe your torso length?',
    short: 'Torso length',
    options: ['Short', 'Medium', 'Long'],
  },
  {
    id: 'bustSize',
    label: 'How would you describe your bust size?',
    short: 'Bust size',
    options: ['XS', 'S', 'M', 'L'],
  },
] as const;

export type FitQuestionId = (typeof FIT_QUESTIONS)[number]['id'];
export type FitAnswers = Partial<Record<FitQuestionId, string>>;

export type CartLine = {
  key: string;
  productId: string;
  colourId: string;
  size: string;
  quantity: number;
  fit: FitAnswers;
};

const STORAGE_KEY = 'esoterica.cart.v1';
const MAX_QTY = 10;

type Listener = (lines: CartLine[]) => void;
const listeners = new Set<Listener>();
let lines: CartLine[] = load();

export function cleanFit(fit: FitAnswers): FitAnswers {
  const out: FitAnswers = {};
  for (const q of FIT_QUESTIONS) {
    const v = fit[q.id];
    if (v && (q.options as readonly string[]).includes(v)) out[q.id] = v;
  }
  return out;
}

function lineKey(productId: string, colourId: string, size: string, fit: FitAnswers): string {
  const f = FIT_QUESTIONS.map((q) => fit[q.id] ?? '').join(',');
  return `${productId}|${colourId}|${size}|${f}`;
}

export function findProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

function isValid(l: CartLine): boolean {
  const p = findProduct(l.productId);
  const c = p?.colours.find((c) => c.id === l.colourId);
  return Boolean(
    p && c && c.status === 'available' && p.sizes?.includes(l.size) && Number.isInteger(l.quantity) && l.quantity > 0,
  );
}

function load(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return merge(
      raw
        .map((l: CartLine) => {
          const fit = cleanFit(l.fit ?? {});
          return { ...l, fit, quantity: Math.min(l.quantity, MAX_QTY), key: lineKey(l.productId, l.colourId, l.size, fit) };
        })
        .filter(isValid),
    );
  } catch {
    return [];
  }
}

function merge(list: CartLine[]): CartLine[] {
  const byKey = new Map<string, CartLine>();
  for (const l of list) {
    const existing = byKey.get(l.key);
    if (existing) existing.quantity = Math.min(existing.quantity + l.quantity, MAX_QTY);
    else byKey.set(l.key, { ...l });
  }
  return [...byKey.values()];
}

function commit(nextLines: CartLine[]) {
  lines = merge(nextLines);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {}
  listeners.forEach((fn) => fn(getLines()));
}

window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  lines = load();
  listeners.forEach((fn) => fn(getLines()));
});

export function getLines(): CartLine[] {
  return lines.map((l) => ({ ...l, fit: { ...l.fit } }));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addLine(input: { productId: string; colourId: string; size: string; quantity?: number; fit?: FitAnswers }): CartLine {
  const fit = cleanFit(input.fit ?? {});
  const line: CartLine = {
    key: lineKey(input.productId, input.colourId, input.size, fit),
    productId: input.productId,
    colourId: input.colourId,
    size: input.size,
    quantity: input.quantity ?? 1,
    fit,
  };
  if (!isValid(line)) throw new Error('Invalid cart line');
  commit([...lines, line]);
  return line;
}

export function setQuantity(key: string, quantity: number) {
  if (quantity <= 0) return removeLine(key);
  commit(lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(quantity, MAX_QTY) } : l)));
}

export function removeLine(key: string) {
  commit(lines.filter((l) => l.key !== key));
}

/** Updates fit answers; returns the line's new key (lines merge if they become identical). */
export function setFit(key: string, fit: FitAnswers): string {
  const clean = cleanFit(fit);
  let newKey = key;
  commit(
    lines.map((l) => {
      if (l.key !== key) return l;
      newKey = lineKey(l.productId, l.colourId, l.size, clean);
      return { ...l, fit: clean, key: newKey };
    }),
  );
  return newKey;
}

export function unitPrice(line: CartLine): number | null {
  return findProduct(line.productId)?.price?.amount ?? null;
}

export function count(): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

export function subtotal(): number | null {
  let total = 0;
  for (const l of lines) {
    const p = unitPrice(l);
    if (p == null) return null;
    total += p * l.quantity;
  }
  return total;
}

export { MAX_QTY };

/** Shape to send to a commerce backend; fit answers become visible line attributes for fulfilment. */
export function toOrderLine(line: CartLine) {
  const product = findProduct(line.productId)!;
  const colour = product.colours.find((c) => c.id === line.colourId)!;
  return {
    productId: line.productId,
    quantity: line.quantity,
    variant: { colour: colour.name, size: line.size },
    attributes: FIT_QUESTIONS.filter((q) => line.fit[q.id]).map((q) => ({
      key: `Fit: ${q.short}`,
      value: line.fit[q.id]!,
    })),
  };
}
