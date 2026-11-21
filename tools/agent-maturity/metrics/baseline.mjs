// D0 baseline input for the report. Values are never built in: D0 reports them for two instruments and the
// numbers may be revised, so they come from a small JSON file (format in metrics/README.md).

export const INSTRUMENTS = ['classifier', 'gold'];
// The hook log is labelled by the D1 classifier, so only a classifier baseline measures the same thing.
export const LIKE_FOR_LIKE = 'classifier';
const FIELDS = new Set(['firstPassRate', 'correctionsPer100', 'note']);

function fail(message) {
  throw new Error(`baseline: ${message}`);
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function parseInstrument(name, value) {
  if (!isObject(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!FIELDS.has(key)) fail(`${name}.${key} is not a known field`);
  const { firstPassRate = null, correctionsPer100 = null, note } = value;
  if (firstPassRate !== null && !(typeof firstPassRate === 'number' && firstPassRate >= 0 && firstPassRate <= 1)) {
    fail(`${name}.firstPassRate must be a number from 0 to 1`);
  }
  if (correctionsPer100 !== null && !(typeof correctionsPer100 === 'number' && Number.isFinite(correctionsPer100) && correctionsPer100 >= 0)) {
    fail(`${name}.correctionsPer100 must be a number of 0 or more`);
  }
  if (firstPassRate === null && correctionsPer100 === null) fail(`${name} needs firstPassRate or correctionsPer100`);
  if (note !== undefined && typeof note !== 'string') fail(`${name}.note must be text`);
  return { firstPassRate, correctionsPer100, ...(note ? { note } : {}) };
}

export function parseBaseline(value) {
  if (!isObject(value)) fail('the file must hold a JSON object');
  const { instruments, source } = value;
  if (!isObject(instruments)) fail('an "instruments" object is required');
  const names = Object.keys(instruments);
  if (names.length === 0) fail('"instruments" is empty');
  for (const name of names) if (!INSTRUMENTS.includes(name)) fail(`unknown instrument "${name}" (use classifier or gold)`);
  return {
    source: typeof source === 'string' ? source : null,
    instruments: Object.fromEntries(INSTRUMENTS.filter((n) => n in instruments).map((n) => [n, parseInstrument(n, instruments[n])])),
  };
}

const delta = (current, base) => (current === null || base === null ? null : current - base);

export function compareToBaseline(metrics, baseline) {
  return Object.entries(baseline.instruments).map(([instrument, b]) => ({
    instrument,
    likeForLike: instrument === LIKE_FOR_LIKE,
    firstPassRate: { current: metrics.firstPass.rate, baseline: b.firstPassRate, delta: delta(metrics.firstPass.rate, b.firstPassRate) },
    correctionsPer100: {
      current: metrics.corrections.per100Prompts,
      baseline: b.correctionsPer100,
      delta: delta(metrics.corrections.per100Prompts, b.correctionsPer100),
    },
    ...(b.note ? { note: b.note } : {}),
  }));
}
