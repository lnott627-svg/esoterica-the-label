import { initSite } from './site.ts';
import { products, site } from './store.config.ts';
import { escapeHtml, formatMoney, todo } from './format.ts';
import { photoToCome, picture } from './images.ts';

initSite();

const CARD_SIZES = '(min-width: 900px) 34vw, (min-width: 600px) 45vw, 92vw';

const heroMedia = document.querySelector<HTMLElement>('[data-hero-media]')!;
heroMedia.innerHTML = picture(site.hero.desktop, {
  sizes: '100vw',
  className: 'hero__picture',
  eager: true,
  mobile: { ref: site.hero.mobile, media: '(max-width: 700px) and (orientation: portrait)' },
});
// Desktop and mobile crops need different focal points, so they're applied via CSS.
heroMedia.querySelector('img')?.style.removeProperty('object-position');
heroMedia.style.setProperty('--focus-desktop', site.hero.desktop.focus ?? '50% 50%');
heroMedia.style.setProperty('--focus-mobile', site.hero.mobile.focus ?? '50% 50%');

const cards: string[] = [];
for (const product of products) {
  const price = product.price ? formatMoney(product.price.amount, product.price.currency) : todo('price');
  for (const colour of product.colours) {
    const name = `${escapeHtml(product.name)} – ${escapeHtml(colour.name)}`;
    const image = colour.images[0];
    if (colour.status === 'available') {
      const media = image
        ? picture(image, { sizes: CARD_SIZES, className: 'product-card__img' })
        : photoToCome(`${product.name} in ${colour.name}`, 'product-card__img');
      cards.push(`<li class="product-card">
        <a class="product-card__link" href="product.html?id=${product.id}&colour=${colour.id}">
          <div class="product-card__media">${media}</div>
          <p class="product-card__name">${name}</p>
          <p class="product-card__price">${price}</p>
        </a>
      </li>`);
    } else if (colour.status === 'planned' && image) {
      cards.push(`<li class="product-card product-card--soon">
        <div class="product-card__media">${picture(image, { sizes: CARD_SIZES, className: 'product-card__img' })}</div>
        <p class="product-card__name">${name}</p>
        <p class="product-card__price">Coming soon</p>
      </li>`);
    }
  }
}
document.querySelector('[data-product-grid]')!.innerHTML = cards.join('');

const { about } = site;
document.querySelector('[data-about]')!.innerHTML = `
  <div class="about__media">${picture(about.image, { sizes: '(min-width: 900px) 34vw, 92vw', className: 'about__img' })}</div>
  <div class="about__text">
    <p>${escapeHtml(about.definition.word)}<br>${escapeHtml(about.definition.pronunciation)}</p>
    <p>${escapeHtml(about.definition.meaning)}</p>
    ${about.body ? `<p>${escapeHtml(about.body)}</p>` : `<p>${todo('about copy (optional)')}</p>`}
  </div>`;

// Topbar switches from white-on-photo to black-on-white once the hero has scrolled away.
const topbar = document.querySelector<HTMLElement>('[data-topbar]')!;
const hero = document.querySelector<HTMLElement>('[data-hero]')!;
new IntersectionObserver(
  ([entry]) => (topbar.dataset.overHero = String(entry.isIntersecting)),
  { rootMargin: '-48px 0px 0px 0px', threshold: 0 },
).observe(hero);
