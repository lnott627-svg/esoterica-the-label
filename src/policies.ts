import { initSite } from './site.ts';
import { site } from './store.config.ts';
import { escapeHtml, todo } from './format.ts';

initSite();

const copy = {
  shipping: site.policies.shipping ?? null,
  returns: site.policies.returns ?? null,
};
for (const [key, text] of Object.entries(copy)) {
  const el = document.querySelector(`[data-policy="${key}"]`)!;
  el.innerHTML = text
    ? text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    : `<p>${todo(`${key} policy`)}</p>`;
}
