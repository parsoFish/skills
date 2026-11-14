// Turns a feedback.json into a plain account of what the person decided. Reads both the current
// reference shape (options as [{ value, label }]) and the older one (options as { value: label }).

const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]);
const optionLabels = (options) => (Array.isArray(options)
  ? Object.fromEntries(options.map((o) => [o.value, o.label ?? o.value]))
  : { ...(options ?? {}) });
const sameSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

const summarizeAsk = (id, answer, ref) => {
  const labels = optionLabels(ref?.options);
  const values = list(answer?.value);
  const recommended = list(ref?.recommended);
  const isText = ref?.kind === 'text';
  const settled = answer?.value === 'settled' || Boolean(ref?.settled);
  return {
    id,
    question: ref?.question ?? id,
    kind: ref?.kind ?? 'choice',
    settled,
    chosen: isText || settled ? [] : values.map((value) => ({ value, label: labels[value] ?? value })),
    text: isText && values.length ? String(values[0]) : undefined,
    recommended: recommended.map((value) => ({ value, label: labels[value] ?? value })),
    matchedRecommendation: isText || settled || !recommended.length || !values.length ? null : sameSet(values, recommended),
    note: hasText(answer?.note) ? answer.note.trim() : '',
    accepted: answer?.accepted === true,
  };
};

const isUnanswered = (id, answers, ref) => {
  if (ref?.optional === true || ref?.settled || answers[id]?.value === 'settled') return false;
  const v = answers[id]?.value;
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
};

/** `{ round, title, submitted, submittedAt, asks, items, comments, extra, unanswered }` from a parsed feedback file. */
export const summarize = (feedback) => {
  if (feedback === null || typeof feedback !== 'object' || Array.isArray(feedback)) throw new Error('feedback must be a JSON object');
  const answers = feedback.asks ?? {};
  const refAsks = feedback.reference?.asks ?? {};
  const refItems = feedback.reference?.items ?? {};
  const askIds = [...new Set([...Object.keys(refAsks), ...Object.keys(answers)])];
  const itemAnswers = feedback.items ?? {};
  const items = Object.keys(itemAnswers).flatMap((id) => {
    const { value, note } = itemAnswers[id] ?? {};
    const fallback = refItems[id]?.default;
    const changed = value !== undefined && value !== fallback;
    if (!changed && !hasText(note)) return [];
    return [{ id, name: refItems[id]?.name ?? id, value: value ?? fallback, default: fallback, note: hasText(note) ? note.trim() : '' }];
  });
  return {
    round: feedback.round, title: feedback.title, submitted: feedback.submitted === true, submittedAt: feedback.submittedAt,
    asks: askIds.filter((id) => answers[id] !== undefined).map((id) => summarizeAsk(id, answers[id], refAsks[id])),
    items,
    comments: Object.entries(feedback.comments ?? {}).filter(([, text]) => hasText(text)).map(([id, text]) => ({ id, text: text.trim() })),
    extra: hasText(feedback.extra) ? feedback.extra.trim() : '',
    unanswered: Object.keys(refAsks).filter((id) => isUnanswered(id, answers, refAsks[id])).map((id) => ({ id, question: refAsks[id].question ?? id })),
  };
};

const askLines = (a) => {
  if (a.settled) return [a.question, '  settled earlier'];
  const lines = [a.question];
  if (a.text !== undefined) lines.push(`  answer: ${a.text}`);
  else lines.push(`  chosen: ${a.chosen.map((c) => (c.label === c.value ? `[${c.value}]` : `${c.label} [${c.value}]`)).join(', ') || 'nothing'}`);
  if (a.matchedRecommendation === true) lines.push('  matches the recommendation');
  if (a.matchedRecommendation === false) lines.push(`  differs from the recommendation (${a.recommended.map((r) => r.label).join(', ')})`);
  if (a.accepted) lines.push('  accepted the proposal');
  if (a.note) lines.push(`  note: ${a.note}`);
  return lines;
};

/** The plain-text report `answers` and `wait` print. */
export const formatAnswers = (s) => {
  const state = s.submitted ? `finished${s.submittedAt ? ` ${s.submittedAt}` : ''}` : 'in progress, not finished';
  const out = [`${s.round ?? '(round)'}${s.title ? `: ${s.title}` : ''} (${state})`, ''];
  for (const a of s.asks) out.push(...askLines(a), '');
  if (s.items.length) out.push('Items changed', ...s.items.map((i) => `  ${i.name}: ${i.value}${i.value !== i.default && i.default !== undefined ? ` (default ${i.default})` : ''}${i.note ? ` - ${i.note}` : ''}`), '');
  if (s.comments.length) out.push('Comments', ...s.comments.map((c) => `  ${c.id}: ${c.text}`), '');
  if (s.extra) out.push('Anything else', `  ${s.extra}`, '');
  if (s.unanswered.length) out.push('Not answered', ...s.unanswered.map((q) => `  ${q.question} [${q.id}]`), '');
  return `${out.join('\n').trimEnd()}\n`;
};
