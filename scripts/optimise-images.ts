/*
 * Generates responsive AVIF + JPEG versions of every image referenced in
 * src/store.config.ts and writes src/generated/image-manifest.json.
 *
 *   npm run images          # only processes images that are new or changed
 *   npm run images -- --force
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { products, site, type ImageRef } from '../src/store.config.ts';
import { imageKey } from '../src/image-key.ts';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'public/images');
const manifestPath = path.join(root, 'src/generated/image-manifest.json');
const force = process.argv.includes('--force');

const WIDTHS = [480, 800, 1200, 1600, 2000, 2560];

export type ManifestEntry = {
  width: number;
  height: number;
  widths: number[];
  /** Average colour, used as a loading placeholder. */
  bg: string;
  source: string;
  sourceMtime: number;
};

const refs: ImageRef[] = [
  site.hero.desktop,
  site.hero.mobile,
  site.about.image,
  ...products.flatMap((p) => p.colours.flatMap((c) => c.images)),
];

const unique = new Map<string, ImageRef>();
for (const r of refs) unique.set(imageKey(r), r);

let manifest: Record<string, ManifestEntry> = {};
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {}

await mkdir(outDir, { recursive: true });
await mkdir(path.dirname(manifestPath), { recursive: true });

const next: Record<string, ManifestEntry> = {};

for (const [key, ref] of unique) {
  const sourcePath = path.join(root, ref.src);
  const { mtimeMs } = await stat(sourcePath);
  const prev = manifest[key];
  if (!force && prev && prev.source === ref.src && prev.sourceMtime === mtimeMs) {
    next[key] = prev;
    console.log(`skip  ${key}`);
    continue;
  }

  const rotated = await sharp(sourcePath).rotate().toBuffer();
  let base = sharp(rotated);
  const meta = await base.metadata();
  let w = meta.width!;
  let h = meta.height!;

  if (ref.crop) {
    const left = Math.round(ref.crop.left * w);
    const top = Math.round(ref.crop.top * h);
    const cw = Math.min(Math.round(ref.crop.width * w), w - left);
    const ch = Math.min(Math.round(ref.crop.height * h), h - top);
    base = sharp(await base.extract({ left, top, width: cw, height: ch }).toBuffer());
    w = cw;
    h = ch;
  }

  const widths = WIDTHS.filter((x) => x < w);
  if (w <= WIDTHS[WIDTHS.length - 1] && (widths.length === 0 || widths[widths.length - 1] < w * 0.9)) widths.push(w);

  const isPhoto = !ref.src.toLowerCase().endsWith('.png');

  for (const tw of widths) {
    const resized = base
      .clone()
      .resize({ width: tw, kernel: 'lanczos3' })
      .toColourspace('srgb');
    // Light post-resize sharpening keeps fabric texture crisp without halos.
    const sharpened = isPhoto && tw < w ? resized.sharpen({ sigma: 0.5, m1: 0.6, m2: 2 }) : resized;
    await sharpened
      .clone()
      .avif({ quality: 64, effort: 5, chromaSubsampling: '4:4:4' })
      .toFile(path.join(outDir, `${key}-${tw}.avif`));
    await sharpened
      .clone()
      .jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .withIccProfile('srgb')
      .toFile(path.join(outDir, `${key}-${tw}.jpg`));
  }

  const { channels } = await base.clone().resize(1, 1).raw().toBuffer({ resolveWithObject: true }).then((r) => ({
    channels: [...r.data.subarray(0, 3)],
  }));
  const bg = '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('');

  next[key] = { width: w, height: h, widths, bg, source: ref.src, sourceMtime: mtimeMs };
  console.log(`done  ${key}  ${w}x${h}  [${widths.join(', ')}]`);
}

await writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n');
console.log(`\nWrote ${Object.keys(next).length} entries to ${path.relative(root, manifestPath)}`);
