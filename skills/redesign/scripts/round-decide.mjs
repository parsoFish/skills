// DECISIONS.md rows: `| # | Date | Kind | Track | Decision | Source |`. Pure helpers, no file access.
// Rows in the older five-column format (`| # | date | stage | decision | source |`) are read for their number only.

export const KINDS = ['product', 'process', 'architecture', 'standing'];
export const HEADER = '| # | Date | Kind | Track | Decision | Source |\n|---|---|---|---|---|---|\n';
const TITLE = '# Decisions\n\nOne line per decision, never rewritten: a change of mind is a new line that ends "(replaces N)".\n\n';
const COLUMNS = 6;
const ROW_NUMBER = /^\|\s*(\d+)\s*\|/;

/** The number the next decision takes: one above the highest # in any row. */
export const nextNumber = (md) => {
  const found = String(md).split('\n').map((line) => ROW_NUMBER.exec(line)?.[1]).filter(Boolean).map(Number);
  return found.length ? Math.max(...found) + 1 : 1;
};

const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

/** One table row for `{ n, date, kind, track, text, source, replaces?, scope? }`. */
export const formatRow = ({ n, date, kind, track = '-', text, source, replaces, scope }) => {
  let decision = oneLine(text);
  if (scope && !decision.includes('(scope:')) decision += ` (scope: ${oneLine(scope)})`;
  if (replaces !== undefined && !decision.endsWith(`(replaces ${replaces})`)) decision += ` (replaces ${replaces})`;
  return `| ${n} | ${date} | ${kind} | ${oneLine(track) || '-'} | ${decision} | ${oneLine(source)} |`;
};

/** True when the last table header in `md` is the six-column one (so new rows fit under it). */
const endsInCurrentTable = (md) => {
  const header = [...String(md).split('\n')].reverse().find((line) => /^\|\s*#\s*\|/.test(line));
  return header !== undefined && header.split('|').length - 2 === COLUMNS;
};

/** `md` with `rows` (`{ date, kind, track, text, source, replaces?, scope? }`) appended and numbered on from the highest #. */
export const appendRows = (md, rows) => {
  const first = nextNumber(md);
  const lines = rows.map((row, i) => formatRow({ ...row, n: first + i }));
  let out = String(md);
  if (!out.trim()) out = TITLE + HEADER;
  else if (!endsInCurrentTable(out)) out = `${out.replace(/\n*$/, '\n')}\n${HEADER}`;
  return `${out.replace(/\n*$/, '\n')}${lines.join('\n')}\n`;
};

const need = (cond, index, message) => { if (!cond) throw new Error(`decision ${index + 1}: ${message}`); };

/** Parses and checks the JSON `decide` reads: an array of `{ text, kind, track?, source, replaces?, scope? }`. */
export const parseDecisionInput = (raw) => {
  let list;
  try { list = JSON.parse(raw); } catch (err) { throw new Error(`the decisions are not valid JSON (${err.message})`); }
  if (!Array.isArray(list)) throw new Error('the decisions must be a JSON array of { text, kind, track, source } objects');
  if (!list.length) throw new Error('give at least one decision');
  return list.map((item, i) => {
    need(item && typeof item === 'object' && !Array.isArray(item), i, 'must be an object');
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    need(text, i, 'text is required');
    need(KINDS.includes(item.kind), i, `kind "${item.kind}" is not one of ${KINDS.join(', ')}`);
    const source = typeof item.source === 'string' ? item.source.trim() : '';
    need(source, i, 'source is required (a round and ask id, "chat", or "spike <name>")');
    need(item.replaces === undefined || Number.isInteger(item.replaces), i, 'replaces must be a decision number');
    const track = typeof item.track === 'string' && item.track.trim() ? item.track.trim() : '-';
    return {
      text, kind: item.kind, track, source,
      ...(item.replaces !== undefined ? { replaces: item.replaces } : {}),
      ...(typeof item.scope === 'string' && item.scope.trim() ? { scope: item.scope.trim() } : {}),
    };
  });
};
