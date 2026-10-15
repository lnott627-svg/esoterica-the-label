import type { ImageRef } from './store.config.ts';

/** Stable key for a configured image (source + crop), used for output filenames and the manifest. */
export function imageKey(ref: Pick<ImageRef, 'src' | 'crop'>): string {
  const base = ref.src
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!ref.crop) return base;
  const c = ref.crop;
  const f = (n: number) => Math.round(n * 100);
  return `${base}-c${f(c.left)}-${f(c.top)}-${f(c.width)}-${f(c.height)}`;
}
