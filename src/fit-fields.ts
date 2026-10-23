import { FIT_QUESTIONS, summariseFit, type FitAnswers } from './fit.ts';
import { escapeHtml } from './format.ts';

/** Optional fit questions as radio groups with a per-question clear button. Nothing is preselected. */
export function fitFieldsHtml(prefix: string, values: FitAnswers = {}): string {
  return FIT_QUESTIONS.map((q) => {
    const legendId = `${prefix}-${q.id}-legend`;
    const choices = q.options
      .map(
        (opt) => `<label class="choice">
          <input type="radio" name="${prefix}-${q.id}" value="${escapeHtml(opt)}" ${values[q.id] === opt ? 'checked' : ''}>
          <span class="choice__box">${escapeHtml(opt)}</span>
        </label>`,
      )
      .join('');
    return `<fieldset class="choice-group fit-question" data-question="${q.id}">
      <legend id="${legendId}" class="field-label">${escapeHtml(q.label)}</legend>
      <div class="choices">${choices}</div>
      <button type="button" class="text-button fit-clear" data-clear="${q.id}" ${values[q.id] ? '' : 'hidden'}
        aria-describedby="${legendId}">Clear answer</button>
    </fieldset>`;
  }).join('');
}

export function readFit(container: HTMLElement): FitAnswers {
  const out: FitAnswers = {};
  for (const q of FIT_QUESTIONS) {
    const checked = container.querySelector<HTMLInputElement>(`[data-question="${q.id}"] input:checked`);
    if (checked) out[q.id] = checked.value;
  }
  return out;
}

export function bindFitFields(container: HTMLElement) {
  container.addEventListener('change', (e) => {
    const input = e.target as HTMLElement;
    const group = input.closest<HTMLElement>('.fit-question');
    group?.querySelector<HTMLButtonElement>('.fit-clear')?.removeAttribute('hidden');
  });
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.fit-clear');
    if (!btn) return;
    const group = btn.closest<HTMLElement>('.fit-question')!;
    group.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.checked = false));
    btn.hidden = true;
    group.querySelector<HTMLInputElement>('input')?.focus();
  });
}

export function fitSummary(fit: FitAnswers): string | null {
  return summariseFit(fit);
}
