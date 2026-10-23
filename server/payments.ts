import Stripe from 'stripe';
import { site } from '../src/store.config.ts';
import { lineDescription, lineTitle, type PricedLine } from '../src/domain.ts';

export type ShippingAddress = {
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
};

export type StripeLine = {
  quantity: number;
  unitAmountCents: number | null;
  name: string | null;
  productId: string | null;
  colourId: string | null;
  size: string | null;
  fitJson: string | null;
};

export type CheckoutSnapshot = {
  id: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  currency: string | null;
  amountSubtotal: number | null;
  amountShipping: number | null;
  amountTotal: number | null;
  livemode: boolean;
  reservationId: string | null;
  paymentIntentId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  shippingName: string | null;
  shipping: ShippingAddress | null;
  lineItems: StripeLine[];
};

export type CheckoutCreate = {
  reservationId: string;
  idempotencyKey: string;
  lines: PricedLine[];
  shippingCents: number;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
};

export type StripeEventInput = {
  id: string;
  type: string;
  data: { object: { id?: string } };
};

export type Payments = {
  testMode: boolean;
  createCheckoutSession(input: CheckoutCreate): Promise<{ id: string; url: string }>;
  retrieveCheckoutSession(id: string): Promise<CheckoutSnapshot | null>;
  expireCheckoutSession(id: string): Promise<void>;
  constructEvent(payload: string, signature: string): StripeEventInput;
};

function asStatus(value: string | null): CheckoutSnapshot['status'] {
  if (value === 'complete' || value === 'expired') return value;
  return 'open';
}

function asPaymentStatus(value: string | null): CheckoutSnapshot['paymentStatus'] {
  if (value === 'paid' || value === 'no_payment_required') return value;
  return 'unpaid';
}

function meta(metadata: Stripe.Metadata | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return value ? value : null;
}

export function snapshotFromSession(session: Stripe.Checkout.Session): CheckoutSnapshot {
  const shippingDetails = session.collected_information?.shipping_details ?? null;
  const address = shippingDetails?.address ?? null;
  const paymentIntent = session.payment_intent;
  const lineItems = (session.line_items?.data ?? []).map((item) => {
    const product = item.price?.product;
    const productMeta = product && typeof product !== 'string' && !('deleted' in product && product.deleted) ? product.metadata : null;
    return {
      quantity: item.quantity ?? 0,
      unitAmountCents: item.price?.unit_amount ?? null,
      name: item.description,
      productId: meta(productMeta, 'productId'),
      colourId: meta(productMeta, 'colourId'),
      size: meta(productMeta, 'size'),
      fitJson: meta(productMeta, 'fit'),
    };
  });
  return {
    id: session.id,
    status: asStatus(session.status),
    paymentStatus: asPaymentStatus(session.payment_status),
    currency: session.currency,
    amountSubtotal: session.amount_subtotal,
    amountShipping: session.total_details?.amount_shipping ?? session.shipping_cost?.amount_total ?? null,
    amountTotal: session.amount_total,
    livemode: session.livemode,
    reservationId: session.metadata?.reservationId || session.client_reference_id,
    paymentIntentId: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id ?? null,
    customerEmail: session.customer_details?.email ?? null,
    customerName: session.customer_details?.name ?? session.customer_details?.individual_name ?? null,
    customerPhone: session.customer_details?.phone ?? null,
    shippingName: shippingDetails?.name ?? null,
    shipping: address?.line1
      ? {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postalCode: address.postal_code,
          country: address.country ?? '',
        }
      : null,
    lineItems,
  };
}

export function createStripePayments(secretKey: string, webhookSecret: string): Payments {
  const stripe = new Stripe(secretKey);
  return {
    testMode: secretKey.startsWith('sk_test_'),
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          ui_mode: 'hosted_page',
          adaptive_pricing: { enabled: false },
          locale: 'en',
          client_reference_id: input.reservationId,
          metadata: { reservationId: input.reservationId },
          expires_at: input.expiresAt,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          billing_address_collection: 'auto',
          shipping_address_collection: { allowed_countries: [...site.shippingRate.countries] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: 'fixed_amount',
                display_name: site.shippingRate.displayName,
                fixed_amount: { amount: input.shippingCents, currency: 'aud' },
              },
            },
          ],
          line_items: input.lines.map((line) => ({
            quantity: line.quantity,
            price_data: {
              currency: 'aud',
              unit_amount: line.unitAmountCents,
              product_data: {
                name: lineTitle(line),
                description: lineDescription(line),
                metadata: {
                  productId: line.productId,
                  colourId: line.colourId,
                  size: line.size,
                  fit: JSON.stringify(line.fit),
                },
              },
            },
          })),
          custom_text: {
            shipping_address: {
              message: 'Delivery is currently within Australia only. The carrier and timing are still being confirmed.',
            },
            submit: {
              message: 'You’ll pay on this secure Stripe page. Card details stay with Stripe.',
            },
          },
          payment_intent_data: {
            metadata: { reservationId: input.reservationId },
            description: `esoterica ${input.reservationId}`,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { id: session.id, url: session.url };
    },
    async retrieveCheckoutSession(id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(id, {
          expand: ['line_items.data.price.product'],
        });
        return snapshotFromSession(session);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return null;
        throw error;
      }
    },
    async expireCheckoutSession(id) {
      await stripe.checkout.sessions.expire(id);
    },
    constructEvent(payload, signature) {
      const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      const object = event.data.object as { id?: string };
      return { id: event.id, type: event.type, data: { object: { id: object.id } } };
    },
  };
}
