import { announce, initSite } from './site.ts';
import { site } from './store.config.ts';

initSite();

const to = site.links.contactEmail;
const direct = document.querySelector<HTMLAnchorElement>('[data-contact-email]')!;
direct.href = `mailto:${to}`;
direct.textContent = to;

const form = document.querySelector<HTMLFormElement>('[data-contact-form]')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;

function setError(name: string, message: string) {
  form.querySelector<HTMLElement>(`[data-error="${name}"]`)!.textContent = message;
  field(name).toggleAttribute('aria-invalid', Boolean(message));
}

form.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.hasAttribute('aria-invalid')) setError(el.name, '');
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = field('name').value.trim();
  const email = field('email').value.trim();
  const subject = field('subject').value.trim();
  const message = field('message').value.trim();

  const errors: Record<string, string> = {
    name: name ? '' : 'Please enter your name.',
    email: !email ? 'Please enter your email address.' : field('email').validity.valid ? '' : 'Please enter a valid email address.',
    message: message ? '' : 'Please enter a message.',
  };
  for (const [key, msg] of Object.entries(errors)) setError(key, msg);
  const firstInvalid = Object.keys(errors).find((k) => errors[k]);
  if (firstInvalid) {
    field(firstInvalid).focus();
    return;
  }

  const body = `${message}\n\n—\n${name}\n${email}`;
  const params = new URLSearchParams({ subject: subject || `Enquiry from ${name}`, body });
  // mailto expects %20 rather than + for spaces.
  window.location.href = `mailto:${to}?${params.toString().replace(/\+/g, '%20')}`;
  announce('Opening your email app');
});
