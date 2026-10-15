import manifestJson from './generated/image-manifest.json';
import { imageKey } from './image-key.ts';
import type { ImageRef } from './store.config.ts';
import { escapeHtml } from './format.ts';

type Entry = { width: number; height: number; widths: number[]; bg: string };
const manifest = manifestJson as Record<string, Entry>;
const base = `${import.meta.env.BASE_URL}images/`;

export function imageEntry(ref: ImageRef): Entry | undefined {
  return manifest[imageKey(ref)];
}

function srcset(key: string, widths: number[], ext: string) {
  return widths.map((w) => `${base}${key}-${w}.${ext} ${w}w`).join(', ');
}

export type PictureOptions = {
  sizes: string;
  className?: string;
  eager?: boolean;
  /** Art-directed source for narrow screens. */
  mobile?: { ref: ImageRef; media: string };
};

export function picture(ref: ImageRef, opts: PictureOptions): string {
  const key = imageKey(ref);
  const entry = manifest[key];
  if (!entry) {
    console.warn(`[esoterica] Missing optimised image for "${ref.src}". Run \`npm run images\`.`);
    return `<div class="media-placeholder ${opts.className ?? ''}" role="img" aria-label="${escapeHtml(ref.alt)}"></div>`;
  }
  const fallbackWidth = entry.widths.find((w) => w >= 1200) ?? entry.widths[entry.widths.length - 1];
  let mobileSources = '';
  if (opts.mobile) {
    const mk = imageKey(opts.mobile.ref);
    const me = manifest[mk];
    if (me) {
      mobileSources = `
        <source media="${opts.mobile.media}" type="image/avif" srcset="${srcset(mk, me.widths, 'avif')}" sizes="100vw" width="${me.width}" height="${me.height}">
        <source media="${opts.mobile.media}" type="image/jpeg" srcset="${srcset(mk, me.widths, 'jpg')}" sizes="100vw" width="${me.width}" height="${me.height}">`;
    }
  }
  const style = [`background-color:${entry.bg}`, ref.focus ? `object-position:${ref.focus}` : ''].filter(Boolean).join(';');
  return `<picture class="${opts.className ?? ''}">${mobileSources}
    <source type="image/avif" srcset="${srcset(key, entry.widths, 'avif')}" sizes="${opts.sizes}">
    <img src="${base}${key}-${fallbackWidth}.jpg" srcset="${srcset(key, entry.widths, 'jpg')}" sizes="${opts.sizes}"
      width="${entry.width}" height="${entry.height}" alt="${escapeHtml(ref.alt)}"
      ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="${style}">
  </picture>`;
}

/** Neutral stand-in when a colour has no real photograph yet. */
export function photoToCome(label: string, className = ''): string {
  return `<div class="media-placeholder ${className}" role="img" aria-label="${escapeHtml(label)}: photograph to come">
    <span aria-hidden="true">Photograph to come</span>
  </div>`;
}
