/**
 * Optional sizing questions. Answers travel with the cart line and, after payment,
 * with that order item. Every question can be left blank.
 */

export const FIT_QUESTIONS = [
  {
    id: 'topSize',
    label: 'What top size do you generally wear?',
    short: 'Usual top size',
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'torsoLength',
    label: 'How would you describe your torso length?',
    short: 'Torso length',
    options: ['Short', 'Medium', 'Long'],
  },
  {
    id: 'bustSize',
    label: 'How would you describe your bust size?',
    short: 'Bust size',
    options: ['XS', 'S', 'M', 'L'],
  },
] as const;

export type FitQuestionId = (typeof FIT_QUESTIONS)[number]['id'];
export type FitAnswers = Partial<Record<FitQuestionId, string>>;

export type FitLine = {
  id: FitQuestionId;
  label: string;
  short: string;
  value: string | null;
};

export function cleanFit(fit: FitAnswers | null | undefined): FitAnswers {
  const out: FitAnswers = {};
  if (!fit) return out;
  for (const q of FIT_QUESTIONS) {
    const v = fit[q.id];
    if (v && (q.options as readonly string[]).includes(v)) out[q.id] = v;
  }
  return out;
}

/** Rejects an answer that isn't one of the choices. Blank answers are omitted. */
export function readFitStrict(raw: unknown): FitAnswers {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Fit details are invalid.');
  }
  const record = raw as Record<string, unknown>;
  const out: FitAnswers = {};
  for (const q of FIT_QUESTIONS) {
    if (!Object.prototype.hasOwnProperty.call(record, q.id)) continue;
    const v = record[q.id];
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || !(q.options as readonly string[]).includes(v)) {
      throw new Error(`Choose a valid answer for “${q.label}”, or leave it blank.`);
    }
    out[q.id] = v;
  }
  return out;
}

export function fitLines(fit: FitAnswers): FitLine[] {
  return FIT_QUESTIONS.map((q) => ({
    id: q.id,
    label: q.label,
    short: q.short,
    value: fit[q.id] ?? null,
  }));
}

export function summariseFit(fit: FitAnswers): string | null {
  const parts = FIT_QUESTIONS.filter((q) => fit[q.id]).map((q) => `${q.short}: ${fit[q.id]}`);
  return parts.length ? parts.join(' · ') : null;
}
