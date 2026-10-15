/*
 * esoterica — store configuration.
 *
 * This is the one file to edit for product, policy and link information.
 * Anything set to `null` is treated as "not yet supplied": the site shows a
 * visible "To supply" marker in its place and lists it in the browser console
 * (see `listMissingInfo` at the bottom of this file).
 *
 * Image `src` values are filenames inside `esoterica top photos/` or
 * `brand assets - web photos/`. After changing images, run `npm run images`.
 */

export type Money = { amount: number; currency: 'AUD' };

export type ImageRef = {
  /** Path relative to the project root. */
  src: string;
  alt: string;
  /** CSS object-position for crops, e.g. '50% 30%'. */
  focus?: string;
  /** Optional crop in fractions of the original (applied before resizing). */
  crop?: { left: number; top: number; width: number; height: number };
};

export type ColourStatus = 'available' | 'planned';

export type Colour = {
  id: string;
  name: string;
  /** Swatch fill shown next to the colour name. */
  swatch: string;
  status: ColourStatus;
  /** Empty array = no real photograph supplied yet. Never substitute another colour's photos. */
  images: ImageRef[];
};

export type SizeMeasurements = Record<string, string | null>;

export type Product = {
  id: string;
  name: string;
  /** Mark `true` once the name is final. */
  nameConfirmed: boolean;
  price: Money | null;
  colours: Colour[];
  sizes: string[] | null;
  /**
   * Size guide. Columns are measurement names (e.g. 'Chest, flat (cm)');
   * rows are sizes. `null` values render as "To supply".
   */
  sizeGuide: {
    columns: string[] | null;
    rows: Record<string, SizeMeasurements> | null;
    note: string | null;
  };
  /** Stock per colour/size. `null` = unknown; the prototype does not limit quantities. */
  inventory: Record<string, Record<string, number>> | null;
  details: string[] | null;
  fit: string[] | null;
  care: string[] | null;
};

const ROCK = 'esoterica top photos';

export const products: Product[] = [
  {
    id: 'relic-top',
    name: 'Relic Top',
    nameConfirmed: false,
    price: { amount: 80, currency: 'AUD' },
    colours: [
      {
        id: 'brown',
        name: 'Brown',
        swatch: '#5a4232', // approximate; adjust to match the fabric
        status: 'available',
        images: [],
      },
      {
        id: 'green',
        name: 'Green',
        swatch: '#5b5e45', // approximate; adjust to match the fabric
        status: 'available',
        // Provisional rock-face portraits; to be replaced with white-background footage.
        images: [
          { src: `${ROCK}/DSC05261 2.JPG`, alt: 'Relic Top in Green, worn with jeans, front view against a rock face', focus: '50% 30%' },
          { src: `${ROCK}/DSC05274.JPG`, alt: 'Relic Top in Green, front view with the halter neck tied', focus: '50% 30%' },
          { src: `${ROCK}/DSC05277.JPG`, alt: 'Relic Top in Green, side view showing the laced side', focus: '50% 40%' },
          { src: `${ROCK}/DSC05283.JPG`, alt: 'Relic Top in Green, back view showing the open back', focus: '50% 40%' },
          { src: `${ROCK}/DSC05284.JPG`, alt: 'Relic Top in Green, back view while climbing', focus: '50% 40%' },
          { src: `${ROCK}/DSC05296.JPG`, alt: 'Relic Top in Green, three-quarter back view', focus: '50% 40%' },
          { src: `${ROCK}/DSC05363.JPG`, alt: 'Relic Top in Green, close view of the neckline', focus: '50% 30%' },
        ],
      },
      {
        // Planned for later. Shown as "coming soon" only once a real photograph is added.
        id: 'navy',
        name: 'Navy',
        swatch: '#1f2738',
        status: 'planned',
        images: [],
      },
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    sizeGuide: {
      columns: null, // e.g. ['Chest, flat (cm)', 'Length from neck (cm)']
      rows: null, // e.g. { XS: { 'Chest, flat (cm)': '38', ... }, ... }
      note: null,
    },
    inventory: null,
    // Suggestions from the photographs, to confirm before publishing:
    // halter neck tied with knotted straps, laced side, open back, long back panel.
    details: null,
    fit: null,
    care: null,
  },
];

export const site = {
  name: 'esoterica',
  hero: {
    desktop: {
      src: `${ROCK}/DSC05265 2.JPG`,
      alt: 'Model climbing a rock face in the Relic Top, seen from behind, with the coast below',
      focus: '55% 50%',
    } satisfies ImageRef,
    // No separate mobile photograph supplied; this is a portrait crop of the same image.
    mobile: {
      src: `${ROCK}/DSC05265 2.JPG`,
      alt: 'Model climbing a rock face in the Relic Top, seen from behind, with the coast below',
      focus: '62% 50%',
      crop: { left: 0.2, top: 0, width: 0.52, height: 1 },
    } satisfies ImageRef,
  },
  about: {
    image: {
      src: 'brand assets - web photos/f4535fa6-b9e0-49a2-938c-e67fd8241075.png',
      alt: 'The word esoterica tattooed inside a lower lip',
      focus: '50% 50%',
    } satisfies ImageRef,
    definition: {
      word: 'esoteric',
      pronunciation: '/ˌiːsə(ʊ)ˈtɛrɪk/',
      meaning:
        'something intended for or understood by only a small, specialised group of people who have special knowledge',
    },
    body: null as string | null,
  },
  links: {
    contact: null as string | null, // e.g. 'mailto:hello@example.com'
    instagram: null as string | null, // e.g. 'https://instagram.com/…'
  },
  policies: {
    shipping: null as string | null,
    returns: null as string | null,
  },
};

export type MissingItem = { area: string; item: string };

export function listMissingInfo(): MissingItem[] {
  const missing: MissingItem[] = [];
  for (const p of products) {
    const area = p.name;
    if (!p.nameConfirmed) missing.push({ area, item: 'Final product name (currently provisional)' });
    if (!p.price) missing.push({ area, item: 'Price' });
    if (!p.sizes?.length) missing.push({ area, item: 'Sizes' });
    if (!p.sizeGuide.columns || !p.sizeGuide.rows) missing.push({ area, item: 'Size guide garment measurements' });
    if (!p.inventory) missing.push({ area, item: 'Inventory / stock quantities' });
    if (!p.details) missing.push({ area, item: 'Details (fabric composition, construction)' });
    if (!p.fit) missing.push({ area, item: 'Fit notes' });
    if (!p.care) missing.push({ area, item: 'Care instructions' });
    for (const c of p.colours) {
      if (c.status === 'available' && c.images.length === 0) {
        missing.push({ area, item: `${c.name} photographs` });
      }
    }
  }
  if (!site.links.contact) missing.push({ area: 'Footer', item: 'Contact destination' });
  if (!site.links.instagram) missing.push({ area: 'Footer', item: 'Instagram URL' });
  if (!site.policies.shipping) missing.push({ area: 'Policies', item: 'Shipping policy and delivery times' });
  if (!site.policies.returns) missing.push({ area: 'Policies', item: 'Returns policy' });
  if (!site.about.body) missing.push({ area: 'About', item: 'About copy (optional)' });
  return missing;
}
