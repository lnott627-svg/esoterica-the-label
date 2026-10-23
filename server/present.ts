import { formatMoney } from '../src/format.ts';
import { brisbaneLabel, countryName, type PricedLine } from '../src/domain.ts';
import type { ShippingAddress } from './payments.ts';

export type PublicFit = { label: string; value: string | null };

export type PublicLine = {
  productId: string;
  colourId: string;
  productName: string;
  colourName: string;
  size: string;
  quantity: number;
  lineAmount: string;
  fitSummary: string | null;
  fit: PublicFit[];
};

export type PublicOrder = {
  number: string;
  placedAt: string;
  placedAtLabel: string;
  testMode: boolean;
  email: string | null;
  contactName: string | null;
  phone: string | null;
  shippingName: string | null;
  address: string[];
  lines: PublicLine[];
  subtotal: string;
  shipping: string;
  shippingLabel: string;
  total: string;
  paymentStatus: 'paid' | 'refunded';
  fulfilmentStatus: 'unfulfilled' | 'fulfilled';
  fulfilmentNote: string | null;
  reviewStatus: 'ok' | 'needs_review';
  reviewReason: string | null;
  stripeReference: string;
  notification: 'pending' | 'sent' | 'skipped' | 'failed';
};

export type OrderRow = {
  number: string;
  session_id: string;
  lines: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  shipping_name: string | null;
  address_json: string | null;
  payment_status: string;
  fulfilment_status: string;
  fulfilment_note: string | null;
  review_status: string;
  review_reason: string | null;
  livemode: number;
  notification: string;
  created_at: string;
};

function money(cents: number): string {
  return formatMoney(cents / 100);
}

export function addressLines(address: ShippingAddress | null, name: string | null): string[] {
  if (!address) return [];
  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(' ');
  return [name, address.line1, address.line2, locality || null, address.country ? countryName(address.country) : null].filter(
    (line): line is string => Boolean(line),
  );
}

export function toPublicLine(line: PricedLine): PublicLine {
  const answered = line.fitLines.filter((fit) => fit.value);
  return {
    productId: line.productId,
    colourId: line.colourId,
    productName: line.productName,
    colourName: line.colourName,
    size: line.size,
    quantity: line.quantity,
    lineAmount: money(line.lineAmountCents),
    fitSummary: answered.length ? answered.map((fit) => `${fit.short}: ${fit.value}`).join(' · ') : null,
    fit: line.fitLines.map((fit) => ({ label: fit.short, value: fit.value })),
  };
}

export function toPublicOrder(row: OrderRow, shippingLabel: string): PublicOrder {
  const lines = JSON.parse(row.lines) as PricedLine[];
  const fulfilmentStatus = row.fulfilment_status === 'fulfilled' ? 'fulfilled' : 'unfulfilled';
  const reviewStatus = row.review_status === 'needs_review' ? 'needs_review' : 'ok';
  const notification: PublicOrder['notification'] =
    row.notification === 'sent' || row.notification === 'skipped' || row.notification === 'failed' || row.notification === 'pending'
      ? row.notification
      : 'pending';
  return {
    number: row.number,
    placedAt: row.created_at,
    placedAtLabel: brisbaneLabel(row.created_at),
    testMode: row.livemode === 0,
    email: row.email,
    contactName: row.contact_name,
    phone: row.phone,
    shippingName: row.shipping_name,
    address: row.address_json ? addressLines(JSON.parse(row.address_json) as ShippingAddress, row.shipping_name) : [],
    lines: lines.map(toPublicLine),
    subtotal: money(row.subtotal_cents),
    shipping: money(row.shipping_cents),
    shippingLabel,
    total: money(row.total_cents),
    paymentStatus: row.payment_status === 'refunded' ? 'refunded' : 'paid',
    fulfilmentStatus,
    fulfilmentNote: row.fulfilment_note,
    reviewStatus,
    reviewReason: row.review_reason,
    stripeReference: row.session_id,
    notification,
  };
}
