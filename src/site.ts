import '@fontsource/michroma/latin-400.css';
import './styles.css';
import * as cart from './cart.ts';
import { listMissingInfo, site } from './store.config.ts';
import { escapeHtml, formatMoney, todo } from './format.ts';
import { imageEntry, photoToCome, picture } from './images.ts';
import { bindFitFields, fitFieldsHtml, fitSummary, readFit } from './fit-fields.ts';

let drawer: HTMLDialogElement;
let announcer: HTMLElement;

export function announce(message: string) {
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = message));
}

function updateCounts() {
  const n = cart.count();
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = String(n)));
  document.querySelectorAll<HTMLElement>('[data-cart-toggle]').forEach((el) =>
    el.setAttribute('aria-label', `Cart, ${n} ${n === 1 ? 'item' : 'items'}`),
  );
}

function lineThumb(line: cart.CartLine): string {
  const product = cart.findProduct(line.productId)!;
  const colour = product.colours.find((c) => c.id === line.colourId)!;
  const img = colour.images[0];
  if (img && imageEntry(img)) return picture({ ...img, alt: '' }, { sizes: '96px', className: 'cart-line__img' });
  return photoToCome(colour.name, 'cart-line__img');
}

function lineHtml(line: cart.CartLine): string {
  const product = cart.findProduct(line.productId)!;
  const colour = product.colours.find((c) => c.id === line.colourId)!;
  const price = cart.unitPrice(line);
  const label = `${product.name}, ${colour.name}, size ${line.size}`;
  const summary = fitSummary(line.fit);
  const fitId = `fit-${btoa(line.key).replace(/[^a-z0-9]/gi, '')}`;
  return `<li class="cart-line" data-key="${escapeHtml(line.key)}">
    <div class="cart-line__media">${lineThumb(line)}</div>
    <div class="cart-line__info">
      <div class="cart-line__head">
        <p class="cart-line__name">${escapeHtml(product.name)}</p>
        <p>${price == null ? todo('price') : formatMoney(price * line.quantity)}</p>
      </div>
      <dl class="cart-line__meta">
        <div><dt>Colour</dt><dd>${escapeHtml(colour.name)}</dd></div>
        <div><dt>Size</dt><dd>${escapeHtml(line.size)}</dd></div>
      </dl>
      <div class="cart-line__fit">
        <p class="muted">${summary ? `Fit details: ${escapeHtml(summary)}` : 'No fit details added'}</p>
        <button type="button" class="text-button" data-action="edit-fit" aria-expanded="false" aria-controls="${fitId}">
          ${summary ? 'Edit fit details' : 'Add fit details'}<span class="visually-hidden"> for ${escapeHtml(label)}</span>
        </button>
        <form class="fit-edit" id="${fitId}" hidden>
          ${fitFieldsHtml(fitId, line.fit)}
          <div class="fit-edit__actions">
            <button type="submit" class="button button--small">Save</button>
            <button type="button" class="text-button" data-action="cancel-fit">Cancel</button>
          </div>
        </form>
      </div>
      <div class="cart-line__actions">
        <div class="qty" role="group" aria-label="Quantity, ${escapeHtml(label)}">
          <button type="button" class="qty__btn" data-action="dec" aria-label="Decrease quantity">−</button>
          <span class="qty__value">${line.quantity}</span>
          <button type="button" class="qty__btn" data-action="inc" aria-label="Increase quantity" ${line.quantity >= cart.MAX_QTY ? 'disabled' : ''}>+</button>
        </div>
        <button type="button" class="text-button" data-action="remove">Remove<span class="visually-hidden"> ${escapeHtml(label)}</span></button>
      </div>
    </div>
  </li>`;
}

function renderDrawer(focus?: { key: string; selector: string }) {
  const lines = cart.getLines();
  const body = drawer.querySelector<HTMLElement>('.drawer__body')!;
  const foot = drawer.querySelector<HTMLElement>('.drawer__foot')!;
  if (!lines.length) {
    body.innerHTML = `<p class="drawer__empty">Your cart is empty.</p>`;
    foot.hidden = true;
  } else {
    body.innerHTML = `<ul class="cart-lines">${lines.map(lineHtml).join('')}</ul>`;
    body.querySelectorAll<HTMLElement>('.fit-edit').forEach(bindFitFields);
    const sub = cart.subtotal();
    foot.hidden = false;
    foot.querySelector('[data-subtotal]')!.innerHTML = sub == null ? todo('price') : formatMoney(sub);
    const blocked = sub == null;
    foot.querySelector<HTMLElement>('[data-checkout]')!.hidden = blocked;
    foot.querySelector<HTMLElement>('[data-checkout-disabled]')!.hidden = !blocked;
    foot.querySelector<HTMLElement>('[data-checkout-note]')!.hidden = blocked;
  }
  drawer.querySelector('[data-drawer-count]')!.textContent = `(${cart.count()})`;
  if (focus) {
    const li = [...body.querySelectorAll<HTMLElement>('.cart-line')].find((el) => el.dataset.key === focus.key);
    const target = li?.querySelector<HTMLElement>(focus.selector) ?? drawer.querySelector<HTMLElement>('.drawer__close');
    target?.focus();
  }
}

function buildDrawer() {
  drawer = document.createElement('dialog');
  drawer.className = 'drawer';
  drawer.id = 'cart-drawer';
  drawer.setAttribute('aria-labelledby', 'cart-title');
  drawer.innerHTML = `
    <div class="drawer__panel">
      <div class="drawer__head">
        <h2 id="cart-title" class="drawer__title">Cart <span data-drawer-count>(0)</span></h2>
        <button type="button" class="text-button drawer__close" data-action="close">Close</button>
      </div>
      <div class="drawer__body"></div>
      <div class="drawer__foot" hidden>
        <div class="drawer__subtotal"><span>Subtotal</span><span data-subtotal></span></div>
        <p class="muted" data-checkout-note>Shipping within Australia is added on the next page, before you pay. You’ll enter your email and delivery address on Stripe. No account is needed.</p>
        <a class="button" href="checkout.html" data-checkout>Checkout</a>
        <button type="button" class="button" data-checkout-disabled disabled hidden>Checkout unavailable</button>
      </div>
    </div>`;
  document.body.append(drawer);

  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) return closeCart();
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') return closeCart();
    const li = btn.closest<HTMLElement>('.cart-line');
    if (!li) return;
    const key = li.dataset.key!;
    const line = cart.getLines().find((l) => l.key === key);
    if (!line) return;
    if (action === 'inc') {
      cart.setQuantity(key, line.quantity + 1);
      renderDrawer({ key, selector: '[data-action="inc"]:not(:disabled), [data-action="dec"]' });
      announce(`Quantity ${line.quantity + 1}`);
    } else if (action === 'dec') {
      if (line.quantity <= 1) {
        cart.removeLine(key);
        renderDrawer({ key: '', selector: '' });
        announce('Item removed');
      } else {
        cart.setQuantity(key, line.quantity - 1);
        renderDrawer({ key, selector: '[data-action="dec"]' });
        announce(`Quantity ${line.quantity - 1}`);
      }
    } else if (action === 'remove') {
      cart.removeLine(key);
      renderDrawer({ key: '', selector: '' });
      announce('Item removed');
    } else if (action === 'edit-fit') {
      const form = li.querySelector<HTMLFormElement>('.fit-edit')!;
      const open = form.hidden;
      form.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) form.querySelector<HTMLInputElement>('input')?.focus();
    } else if (action === 'cancel-fit') {
      renderDrawer({ key, selector: '[data-action="edit-fit"]' });
    }
  });

  drawer.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('.fit-edit');
    if (!form) return;
    e.preventDefault();
    const key = form.closest<HTMLElement>('.cart-line')!.dataset.key!;
    const newKey = cart.setFit(key, readFit(form));
    renderDrawer({ key: newKey, selector: '[data-action="edit-fit"]' });
    announce('Fit details saved');
  });

  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCart();
    }
  });

  drawer.addEventListener('close', () => {
    document.documentElement.classList.remove('has-modal');
    lastTrigger?.focus();
  });
}

let lastTrigger: HTMLElement | null = null;

export function openCart(trigger?: HTMLElement | null) {
  lastTrigger = trigger ?? (document.activeElement as HTMLElement | null);
  renderDrawer();
  if (!drawer.open) {
    drawer.showModal();
    document.documentElement.classList.add('has-modal');
  }
  drawer.querySelector<HTMLElement>('.drawer__close')?.focus();
}

export function closeCart() {
  drawer.close();
}

function footerHtml(): string {
  const { contact, instagram, instagramHandle } = site.links;
  const link = (label: string, href: string | null, external = false) =>
    href
      ? `<a href="${escapeHtml(href)}"${external ? ' rel="noopener" target="_blank"' : ''}>${label}</a>`
      : `<span>${label} ${todo('link')}</span>`;
  return `<nav aria-label="Footer">
      <ul class="footer__links">
        <li>${link('Contact', contact)}</li>
        <li>${link(escapeHtml(instagramHandle || 'Instagram'), instagram, true)}</li>
        <li><a href="policies.html#shipping">Shipping</a></li>
        <li><a href="policies.html#returns">Returns</a></li>
      </ul>
    </nav>
    <p class="footer__legal">© ${new Date().getFullYear()} ${escapeHtml(site.name)}</p>`;
}

export function initSite() {
  announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.setAttribute('aria-live', 'polite');
  document.body.append(announcer);

  buildDrawer();
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-cart-toggle]');
    if (t) {
      e.preventDefault();
      openCart(t);
    }
  });

  const footer = document.querySelector<HTMLElement>('[data-site-footer]');
  if (footer) footer.innerHTML = footerHtml();

  updateCounts();
  cart.subscribe(() => {
    updateCounts();
    if (drawer.open && !drawer.contains(document.activeElement)) renderDrawer();
  });

  if (import.meta.env.DEV) {
    const missing = listMissingInfo();
    if (missing.length) {
      console.groupCollapsed(`[esoterica] ${missing.length} items still to supply in src/store.config.ts`);
      console.table(missing);
      console.groupEnd();
    }
  }
}
