// "Repeated error" checker, v1 (D5 part 1): does a new correction share scope and content with a standard that
// already existed (active or candidate)? Keyword rules plus scope, with a confidence score. Pure: no I/O; results
// carry ids and numbers only, never the correction text. Not validated: part 2 scores it on >=30 real labelled pairs.

import { stripAccents } from '../lib/classify.mjs';

export const DEFAULT_THRESHOLD = 0.5;
// Content score: shared distinct terms, zero below MIN_SHARED_TERMS, full at TERMS_FOR_FULL_MATCH.
export const MIN_SHARED_TERMS = 2;
export const TERMS_FOR_FULL_MATCH = 4;
// Keyword score: one listed keyword phrase found in order gives KEYWORD_BASE, each further one adds KEYWORD_STEP.
const KEYWORD_BASE = 0.5;
const KEYWORD_STEP = 0.25;
const MAX_TEXT_CHARS = 4000;
const USABLE_STATES = new Set(['active', 'candidate']);
const SCOPES = new Set(['user', 'project']);

// Unaccented function words (Vietnamese and English) and correction markers ("sai", "lại", "vẫn") that say nothing
// about the topic. Accents are stripped first, so one entry covers several words (đã/đá -> "da").
const STOPWORDS = new Set([
  'la', 'va', 'cua', 'co', 'khong', 'ko', 'cho', 'de', 'thi', 'ma', 'nhu', 'nay', 'do', 'da', 'dang', 'se', 'duoc',
  'roi', 'voi', 'trong', 'khi', 'nhung', 'cac', 'mot', 'cung', 'lai', 'ra', 'vao', 'len', 'xuong', 'tai', 'theo', 've',
  'tu', 'den', 'nua', 'chua', 'phai', 'sao', 'gi', 'nao', 'the', 'vay', 'em', 'anh', 'chi', 'nhe', 'nha', 'oi', 'di',
  'lam', 'truoc', 'sau', 'hay', 'hoac', 'neu', 'bang', 'hon', 'nhat', 'rat', 'qua', 'moi', 'luon', 'can', 'nen', 'con',
  'van', 'sai', 'dung', 'minh', 'toi', 'no', 'ay', 'kia', 'day', 'thoi', 'cai', 'viec', 'lan', 'het', 'bi', 'vi',
  'them', 'tren', 'duoi', 'giup', 'xem', 'ok', 'oke', 'thay', 'biet', 'muon',
  'an', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'this', 'that', 'with', 'before',
  'after', 'when', 'not', 'does', 'don', 'please', 'you', 'we', 'at', 'by', 'as', 'from', 'if', 'then', 'than',
  'so', 'but', 'yes', 'just', 'also', 'all', 'any', 'its', 'was', 'were', 'has', 'have', 'had', 'should',
  'must', 'will', 'would', 'again', 'still',
]);

export function tokens(text) {
  const s = stripAccents(String(text).slice(0, MAX_TEXT_CHARS).normalize('NFC').toLocaleLowerCase('vi'));
  return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const isContent = (t) => t.length >= 2 && !STOPWORDS.has(t);
export const contentTerms = (text) => new Set(tokens(text).filter(isContent));

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const toMs = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const first = (o, keys) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null);
// Windows paths compare case-insensitively with forward slashes.
const rootKey = (v) => {
  const s = str(v);
  return s ? s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : null;
};

// Accepts KnowledgeMemory-style records (id, scope, state, created_at, title, summary, topic_key) plus `keywords`.
function normalizeStandard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = str(raw.id);
  if (!id || !SCOPES.has(raw.scope)) return null;
  const projectId = str(first(raw, ['project_id', 'projectId']));
  const projectRoot = rootKey(first(raw, ['project_root', 'projectRoot']));
  if (raw.scope === 'project' && !projectId && !projectRoot) return null;
  const text = ['title', 'summary', 'statement'].map((k) => (typeof raw[k] === 'string' ? raw[k] : '')).join(' ');
  const topic = typeof raw.topic_key === 'string' ? raw.topic_key.replace(/[-_]/g, ' ') : '';
  const terms = contentTerms(`${text} ${topic}`);
  const keywords = (Array.isArray(raw.keywords) ? raw.keywords : []).filter((k) => typeof k === 'string').map(tokens).filter((t) => t.length > 0);
  if (terms.size === 0 && keywords.length === 0) return null;
  const state = first(raw, ['state', 'status']);
  return {
    id,
    scope: raw.scope,
    projectId,
    projectRoot,
    // An export of active standards may omit the state; any state other than active/candidate is not usable.
    usable: state === undefined || USABLE_STATES.has(state),
    createdMs: toMs(first(raw, ['created_at', 'createdAt'])),
    terms,
    keywords,
  };
}

// raw: an array of standards or { standards: [...] }. Records that cannot be used are counted as skipped.
export function normalizeStandards(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.standards) ? raw.standards : [];
  const standards = list.map(normalizeStandard).filter(Boolean);
  return { standards, skipped: list.length - standards.length };
}

// correction: { text, project_root | cwd, project_id, at }. Only tokens are kept from the text.
function prepare(correction) {
  const c = correction && typeof correction === 'object' ? correction : {};
  const all = tokens(typeof c.text === 'string' ? c.text : '');
  return {
    tokens: all,
    terms: new Set(all.filter(isContent)),
    projectId: str(first(c, ['project_id', 'projectId'])),
    projectRoot: rootKey(first(c, ['project_root', 'projectRoot', 'cwd'])),
    atMs: toMs(c.at),
  };
}

function scopeMatches(std, c) {
  if (std.scope === 'user') return true;
  if (std.projectId && c.projectId) return std.projectId === c.projectId;
  return Boolean(std.projectRoot && c.projectRoot && (c.projectRoot === std.projectRoot || c.projectRoot.startsWith(`${std.projectRoot}/`)));
}

function containsPhrase(list, phrase) {
  for (let i = 0; i + phrase.length <= list.length; i += 1) {
    if (phrase.every((t, j) => list[i + j] === t)) return true;
  }
  return false;
}

const round2 = (x) => Math.round(x * 100) / 100;

// A standard must be active or candidate, in scope, and created before the correction (when its time is known).
function score(c, std) {
  const scopeMatched = scopeMatches(std, c);
  const earlier = c.atMs === null || (std.createdMs !== null && std.createdMs < c.atMs);
  let sharedTerms = 0;
  for (const t of std.terms) if (c.terms.has(t)) sharedTerms += 1;
  const keywordHits = std.keywords.filter((k) => containsPhrase(c.tokens, k)).length;
  const termScore = sharedTerms >= MIN_SHARED_TERMS ? Math.min(1, sharedTerms / TERMS_FOR_FULL_MATCH) : 0;
  const keywordScore = keywordHits > 0 ? Math.min(1, KEYWORD_BASE + KEYWORD_STEP * (keywordHits - 1)) : 0;
  return { eligible: std.usable && scopeMatched && earlier, scopeMatched, sharedTerms, keywordHits, confidence: round2(Math.max(termScore, keywordScore)) };
}

export const scorePair = (correction, standard) => score(prepare(correction), standard);

export const isRepeat = (s, threshold) => s.eligible && s.confidence > 0 && s.confidence >= threshold;

// Best eligible standard for one correction. standardId is set only when it counts as a repeat.
export function checkCorrection(correction, standards, { threshold = DEFAULT_THRESHOLD } = {}) {
  const c = prepare(correction);
  let best = null;
  for (const std of standards) {
    const s = score(c, std);
    if (!s.eligible) continue;
    if (!best || s.confidence > best.s.confidence || (s.confidence === best.s.confidence && s.sharedTerms > best.s.sharedTerms)) best = { id: std.id, s };
  }
  const repeat = best !== null && isRepeat(best.s, threshold);
  return {
    repeat,
    standardId: repeat ? best.id : null,
    confidence: best ? best.s.confidence : 0,
    sharedTerms: best ? best.s.sharedTerms : 0,
    keywordHits: best ? best.s.keywordHits : 0,
  };
}
