import { initSite } from './site.ts';
import { adminOrdersHtml, type ShownOrder } from './order-view.ts';
import { escapeHtml } from './format.ts';

initSite();

const root = document.querySelector<HTMLElement>('[data-admin]')!;

type OrdersResponse = { orders: ShownOrder[]; unfulfilled: number; testMode: boolean; error?: string };

function loginHtml(message = ''): string {
  return `<h1 class="section-label">Orders</h1>
    <p>Sign in to see paid orders, delivery details and fit notes.</p>
    <form class="contact-form" data-login>
      <div class="field">
        <label class="field-label" for="admin-password">Password</label>
        <input class="input" id="admin-password" name="password" type="password" autocomplete="current-password" required>
        <p class="field-error">${escapeHtml(message)}</p>
      </div>
      <button type="submit" class="button">Sign in</button>
    </form>`;
}

async function load(): Promise<void> {
  const response = await fetch('/api/admin/orders', { headers: { accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    root.innerHTML = loginHtml(response.status === 403 && data.error?.includes('configured') ? data.error : '');
    return;
  }
  if (!response.ok) {
    root.innerHTML = `<h1 class="section-label">Orders</h1><p class="field-error">Orders couldn’t be loaded.</p>`;
    return;
  }
  const data = (await response.json()) as OrdersResponse;
  root.innerHTML = `<h1 class="section-label">Orders</h1>${adminOrdersHtml(data)}`;
}

root.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.matches('[data-login]')) {
    event.preventDefault();
    void signIn(form);
    return;
  }
  if (form.matches('[data-order]')) {
    event.preventDefault();
    void fulfil(form);
  }
});

root.addEventListener('click', (event) => {
  const logout = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-logout]');
  if (!logout) return;
  void fetch('/api/admin/logout', { method: 'POST' }).then(() => {
    root.innerHTML = loginHtml();
  });
});

async function signIn(form: HTMLFormElement): Promise<void> {
  const password = (form.elements.namedItem('password') as HTMLInputElement).value;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled = true;
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    root.innerHTML = loginHtml(data.error ?? 'That password isn’t right.');
    root.querySelector<HTMLInputElement>('#admin-password')?.focus();
    return;
  }
  await load();
}

async function fulfil(form: HTMLFormElement): Promise<void> {
  const number = form.dataset.order;
  const status = form.querySelector<HTMLButtonElement>('[data-status]')?.dataset.status;
  const note = (form.elements.namedItem('note') as HTMLInputElement | null)?.value ?? '';
  const error = form.querySelector<HTMLElement>('[data-fulfil-error]')!;
  const response = await fetch(`/api/admin/orders/${number}/fulfilment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ status, note }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    error.textContent = data.error ?? 'That status could not be saved.';
    return;
  }
  await load();
}

void load();
