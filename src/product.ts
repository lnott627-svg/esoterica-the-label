import { announce, initSite, openCart } from './site.ts';
import * as cart from './cart.ts';
import { products, site, type Colour, type Product } from './store.config.ts';
import { escapeHtml, formatMoney, todo } from './format.ts';
import { photoToCome, picture } from './images.ts';
import { bindFitFields, fitFieldsHtml, readFit } from './fit-fields.ts';

initSite();

const params = new URLSearchParams(location.search);
const product: Product = products.find((p) => p.id === params.get('id')) ?? products[0];
const colours = product.colours.filter((c) => c.status === 'available');
let colour: Colour | undefined = colours.find((c) => c.id === params.get('colour'));

const root = document.querySelector<HTMLElement>('[data-pdp]')!;
document.title = `${product.name} — ${site.name}`;

function galleryHtml(c: Colour | undefined): string {
  const target = c ?? colours.find((x) => x.images.length) ?? colours[0];
  if (!target) return '';
  if (!target.images.length) {
    return `<li class="gallery__item">${photoToCome(`${product.name} in ${target.name}`, 'gallery__img')}</li>`;
  }
  return target.images
    .map(
      (img, i) => `<li class="gallery__item">${picture(img, {
        sizes: '(min-width: 900px) 33vw, 88vw',
        className: 'gallery__img',
        eager: i < 2,
      })}</li>`,
    )
    .join('');
}

function listOrTodo(items: string[] | null, missing: string): string {
  return items?.length ? `<ul class="plain-list">${items.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : `<p>${todo(missing)}</p>`;
}

function sizeGuideHtml(): string {
  const g = product.sizeGuide;
  const sizes = product.sizes ?? [];
  if (!g.columns || !g.rows) {
    return `<p>${todo('garment measurements for each size')}</p>
      <p class="muted">Sizes available: ${sizes.map(escapeHtml).join(', ') || todo('sizes')}</p>`;
  }
  const head = g.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('');
  const body = sizes
    .map((s) => {
      const row = g.rows![s] ?? {};
      const cells = g.columns!.map((c) => `<td>${row[c] ? escapeHtml(row[c]!) : todo('value')}</td>`).join('');
      return `<tr><th scope="row">${escapeHtml(s)}</th>${cells}</tr>`;
    })
    .join('');
  return `<table class="size-table"><caption class="visually-hidden">Garment measurements by size</caption>
    <thead><tr><th scope="col">Size</th>${head}</tr></thead><tbody>${body}</tbody></table>
    ${g.note ? `<p class="muted">${escapeHtml(g.note)}</p>` : ''}`;
}

const price = product.price ? formatMoney(product.price.amount, product.price.currency) : null;
const sizes = product.sizes ?? [];

root.innerHTML = `
  <section class="pdp__gallery" aria-label="Photographs">
    <ul class="gallery" data-gallery tabindex="0" aria-label="${escapeHtml(product.name)} photographs, scrolls horizontally on small screens"></ul>
  </section>

  <section class="pdp__panel" aria-labelledby="pdp-title">
    <h1 id="pdp-title" class="pdp__title">${escapeHtml(product.name)}<span data-title-colour></span></h1>
    <p class="pdp__price">${price ?? todo('price')}</p>

    <form class="buy-form" data-buy-form novalidate>
      <fieldset class="choice-group" data-group="colour" aria-describedby="colour-error">
        <legend class="field-label">Colour: <span data-colour-label>${colour ? escapeHtml(colour.name) : 'select'}</span></legend>
        <div class="choices">
          ${colours
            .map(
              (c) => `<label class="choice choice--swatch">
                <input type="radio" name="colour" value="${c.id}" ${colour?.id === c.id ? 'checked' : ''}>
                <span class="choice__box"><span class="swatch" style="background:${c.swatch}" aria-hidden="true"></span>${escapeHtml(c.name)}</span>
              </label>`,
            )
            .join('')}
        </div>
        <p class="field-error" id="colour-error" data-error="colour"></p>
      </fieldset>

      <fieldset class="choice-group" data-group="size" aria-describedby="size-error">
        <legend class="field-label">Size</legend>
        ${
          sizes.length
            ? `<div class="choices">${sizes
                .map(
                  (s) => `<label class="choice">
                    <input type="radio" name="size" value="${escapeHtml(s)}">
                    <span class="choice__box">${escapeHtml(s)}</span>
                  </label>`,
                )
                .join('')}</div>`
            : `<p>${todo('sizes')}</p>`
        }
        <p class="field-error" id="size-error" data-error="size"></p>
      </fieldset>

      <button type="button" class="text-button pdp__size-guide" data-open-size-guide aria-haspopup="dialog">Size guide</button>

      <div class="fit-survey">
        <button type="button" class="disclosure" aria-expanded="false" aria-controls="fit-survey-panel" data-fit-toggle>
          Add fit details (optional)<span class="disclosure__icon" aria-hidden="true"></span>
        </button>
        <div class="fit-survey__panel" id="fit-survey-panel" hidden data-fit-panel>
          <p class="fit-survey__intro">Want us to take your proportions into account? Answer whichever questions you’re comfortable with. You can leave any or all of them blank.</p>
          ${fitFieldsHtml('survey')}
        </div>
      </div>

      <button type="submit" class="button" ${price ? '' : 'disabled'}>Add to cart</button>
    </form>

    <div class="accordions">
      <details class="accordion">
        <summary>Details</summary>
        <div class="accordion__body">${listOrTodo(product.details, 'garment details, including fabric composition')}</div>
      </details>
      <details class="accordion">
        <summary>Fit</summary>
        <div class="accordion__body">
          ${sizes.length ? `<p>Available in ${sizes.map(escapeHtml).join(', ')}.</p>` : ''}
          ${listOrTodo(product.fit, 'fit notes')}
        </div>
      </details>
      <details class="accordion">
        <summary>Care</summary>
        <div class="accordion__body">${listOrTodo(product.care, 'care instructions')}</div>
      </details>
      <details class="accordion">
        <summary>Shipping and Returns</summary>
        <div class="accordion__body">
          <p>${site.policies.shipping ? escapeHtml(site.policies.shipping) : todo('shipping policy and delivery times')}</p>
          <p>${site.policies.returns ? escapeHtml(site.policies.returns) : todo('returns policy')}</p>
          <p><a href="policies.html">Shipping and returns information</a></p>
        </div>
      </details>
    </div>
  </section>

  <dialog class="modal" id="size-guide" aria-labelledby="size-guide-title" data-size-guide>
    <div class="modal__head">
      <h2 id="size-guide-title" class="modal__title">Size guide</h2>
      <button type="button" class="text-button" data-close-size-guide>Close</button>
    </div>
    ${sizeGuideHtml()}
  </dialog>
`;

const gallery = root.querySelector<HTMLElement>('[data-gallery]')!;
const form = root.querySelector<HTMLFormElement>('[data-buy-form]')!;

function renderColour() {
  gallery.innerHTML = galleryHtml(colour);
  gallery.scrollLeft = 0;
  root.querySelector('[data-colour-label]')!.textContent = colour?.name ?? 'select';
  root.querySelector('[data-title-colour]')!.textContent = colour ? ` – ${colour.name}` : '';
  document.title = `${product.name}${colour ? ` – ${colour.name}` : ''} — ${site.name}`;
}
renderColour();

function setError(group: 'colour' | 'size', message: string) {
  const el = root.querySelector<HTMLElement>(`[data-error="${group}"]`)!;
  el.textContent = message;
  root.querySelector<HTMLElement>(`[data-group="${group}"]`)!.toggleAttribute('data-invalid', Boolean(message));
}

form.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'colour') {
    colour = colours.find((c) => c.id === input.value);
    setError('colour', '');
    renderColour();
    const url = new URL(location.href);
    url.searchParams.set('id', product.id);
    url.searchParams.set('colour', input.value);
    history.replaceState(null, '', url);
  } else if (input.name === 'size') {
    setError('size', '');
  }
});

const fitToggle = root.querySelector<HTMLButtonElement>('[data-fit-toggle]')!;
const fitPanel = root.querySelector<HTMLElement>('[data-fit-panel]')!;
bindFitFields(fitPanel);
fitToggle.addEventListener('click', () => {
  const open = fitPanel.hidden;
  fitPanel.hidden = !open;
  fitToggle.setAttribute('aria-expanded', String(open));
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const colourInput = form.querySelector<HTMLInputElement>('input[name="colour"]:checked');
  const sizeInput = form.querySelector<HTMLInputElement>('input[name="size"]:checked');
  const validColour = colourInput && colours.some((c) => c.id === colourInput.value);
  const validSize = sizeInput && sizes.includes(sizeInput.value);

  setError('colour', validColour ? '' : 'Please select a colour.');
  setError('size', validSize ? '' : 'Please select a size.');
  if (!validColour || !validSize) {
    const first = !validColour ? 'colour' : 'size';
    form.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
    return;
  }

  cart.addLine({ productId: product.id, colourId: colourInput.value, size: sizeInput.value, fit: readFit(fitPanel) });
  announce(`${product.name}, ${colour?.name}, size ${sizeInput.value} added to cart`);
  openCart(form.querySelector<HTMLElement>('button[type="submit"]'));
});

const sizeGuide = root.querySelector<HTMLDialogElement>('[data-size-guide]')!;
root.querySelector('[data-open-size-guide]')!.addEventListener('click', () => sizeGuide.showModal());
root.querySelector('[data-close-size-guide]')!.addEventListener('click', () => sizeGuide.close());
sizeGuide.addEventListener('click', (e) => e.target === sizeGuide && sizeGuide.close());
