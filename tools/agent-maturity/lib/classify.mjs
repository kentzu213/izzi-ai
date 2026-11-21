// Prompt classifier for the upgrade-checkpoint hook (docs/izzi-v2/PLAN.md §4.2 and §4.9).
// Pure functions: no I/O, and results never carry the prompt text.

import crypto from 'node:crypto';

export const CHECKPOINT_HEADER = '[Checkpoint nâng cấp]';

const LIMIT = {
  tooLong: 400,
  resignation: 120,
  negation: 120,
  correction: 300,
  narrowedDung: 120,
  approve: 60,
  praise: 80,
  flow: 25,
  longApproval: 60,
  reply: 40,
  replyScan: 200, // only the start of a checkpoint reply is read
  rawSkip: 2000, // longer raw prompts are too-long without normalizing them
};
const ASK_BLOCK_LINES = 10; // the "Trả lời:" line must follow the header within this many lines
const ANSWER_LINE = 'Trả lời';

// Labels that can be a completion milestone.
export const MILESTONE_LABELS = new Set(['approve_decision', 'praise']);

// Unaccented forms that collide with other words (đừng/dùng/đúng/dừng) are never matched.
const AMBIGUOUS_PLAIN = new Set(['dung', 'dung roi']);
const WRAPPER_RULES = new Set(['abstain:wrapper', 'abstain:slash-command', 'abstain:interrupted']);

export function stripAccents(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC');
}

const TRAILING_PUNCTUATION = new Set(['.', '!', '…']);

// Callers pass short text only (classifyPrompt checks rawSkip first, replies are cut to replyScan).
// Trailing punctuation is trimmed with a loop: /[.!…]+$/ is quadratic on long runs that do not end the text.
export function normalize(text) {
  const s = text.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
  let end = s.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(s[end - 1])) end -= 1;
  return s.slice(0, end).trim();
}

// Chat abbreviations, expanded before matching. "ko" stays as typed: every word list already has it.
const ABBREVIATIONS = new Map([
  ['dc', 'được'], ['đc', 'được'], ['cx', 'cũng'], ['cg', 'cũng'],
  ['k', 'không'], ['kh', 'không'], ['khg', 'không'], ['hok', 'không'], ['hông', 'không'],
]);
const ABBREVIATION_RE = /(?<![\p{L}\p{N}\p{M}])(?:dc|đc|cx|cg|khg|kh|k|hok|hông)(?![\p{L}\p{N}\p{M}])/gu;

// An unaccented prompt gets unaccented expansions, so the accent rule below still applies.
function expandAbbreviations(norm, accented) {
  return norm.replace(ABBREVIATION_RE, (w) => (accented ? ABBREVIATIONS.get(w) : stripAccents(ABBREVIATIONS.get(w))));
}

const tokenize = (text) => text.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
const keyOf = (pattern) => stripAccents(pattern).replace(/ /g, '-');

function patterns(list) {
  return {
    accented: list.map((p) => ({ tokens: tokenize(p), key: keyOf(p) })),
    plain: list
      .map((p) => stripAccents(p))
      .filter((p) => !AMBIGUOUS_PLAIN.has(p))
      .map((p) => ({ tokens: tokenize(p), key: p.replace(/ /g, '-') })),
  };
}

const RESIGNATION = patterns(['thôi được rồi', 'thôi được', 'thôi kệ', 'thôi bỏ', 'cũng được', 'tạm được', 'tạm ổn', 'được thôi', 'kệ đi']);
const NEGATORS = patterns(['đừng', 'chưa', 'không', 'ko', 'khoan']);
// Terms whose negation or question form must never count as approval.
const APPROVAL_TERMS = patterns(['phát hành', 'merge', 'đồng ý', 'duyệt', 'sửa ở đây', 'chốt']);
const PRAISE_TERMS = patterns(['được rồi', 'ổn', 'tốt', 'chuẩn', 'đẹp', 'ok', 'tuyệt', 'perfect', 'ưng']);
const QUESTION_PARTICLES = patterns(['không', 'ko', 'chưa', 'hả', 'à', 'nhỉ', 'sao', 'chứ']);
const QUESTION_OPENERS = patterns(['tại sao', 'vì sao', 'sao lại', 'làm sao', 'có phải']);
// Address and softener words skipped when looking for a final question particle ("merge chưa em").
const SOFT_ENDINGS = patterns(['em', 'anh', 'chị', 'ạ', 'nhé', 'nha', 'nhá', 'vậy', 'thế', 'đấy', 'đó']);
// A negator followed by one of these is not a negation: "không sao", "đừng lo", "không vấn đề".
const NOT_NEGATION_NEXT = patterns(['sao', 'lo', 'vấn']);
// "merge ... không được": a negation after the term, within a few words.
const POST_NEGATORS = patterns(['không', 'ko', 'chưa']);
const POST_WINDOW = 4;
const CORRECTION = patterns(['không phải', 'sai rồi', 'chưa đúng', 'không đúng', 'ko đúng', 'làm lại', 'sửa lại', 'chưa được', 'vẫn chưa', 'vẫn lỗi', 'vẫn sai']);
const DUNG_MARKERS = patterns(['đừng làm vậy', 'sao lại', 'không phải', 'sai', 'làm lại', 'chưa được', 'vẫn chưa']);
const CLARIFY = patterns(['chưa hiểu', 'không hiểu', 'ko hiểu', 'nói rõ hơn', 'giải thích lại']);
const APPROVE = patterns(['phát hành', 'merge', 'đồng ý', 'duyệt theo', 'duyệt đi', 'sửa ở đây', 'chốt']);
const PRAISE = patterns(['được rồi', 'ổn rồi', 'tốt rồi', 'chuẩn rồi', 'đẹp rồi', 'hay rồi', 'ok rồi', 'tuyệt', 'perfect', 'ưng']);
const CONFIRM = patterns(['đúng rồi', 'đúng vậy']);
const FLOW = patterns(['tiếp tục', 'làm tiếp', 'tiếp đi', 'ok', 'oke', 'okay', 'continue', 'go']);

// Occurrences that look like a pattern but mean something else.
function excluded(tokens, start, length) {
  const first = tokens[start];
  const before = tokens[start - 1];
  const next = tokens[start + length];
  if ((first === 'duyệt' || first === 'duyet') && (before === 'trình' || before === 'trinh')) return true;
  if (first === 'merge' && (next === 'conflict' || next === 'conflicts')) return true;
  if ((first === 'tuyệt' || first === 'tuyet') && length === 1 && (next === 'đối' || next === 'doi')) return true;
  return false;
}

function occurrences(tokens, pattern) {
  const found = [];
  const n = pattern.tokens.length;
  for (let i = 0; i + n <= tokens.length; i += 1) {
    let same = true;
    for (let j = 0; j < n && same; j += 1) same = tokens[i + j] === pattern.tokens[j];
    if (same && !excluded(tokens, i, n)) found.push(i);
  }
  return found;
}

const firstKey = (tokens, list) => list.find((p) => occurrences(tokens, p).length > 0)?.key ?? null;

// Positive labels follow the accent rule: accented prompts only match accented patterns.
function matchPositive(ctx, group) {
  return ctx.accented ? firstKey(ctx.tokens, group.accented) : firstKey(ctx.plainTokens, group.plain);
}

// Blocking labels match either form, so mixed accented/unaccented prompts cannot slip through.
function matchBlocking(ctx, group) {
  return firstKey(ctx.tokens, group.accented) ?? firstKey(ctx.plainTokens, group.plain);
}

const MODES = ['accented', 'plain'];
const tokensOf = (ctx, mode) => (mode === 'accented' ? ctx.tokens : ctx.plainTokens);
const wordsOf = (group, mode) => new Set(group[mode].map((p) => p.tokens.join(' ')));
const hasApprovalOrPraise = (ctx) => Boolean(matchBlocking(ctx, APPROVAL_TERMS) ?? matchBlocking(ctx, PRAISE_TERMS));

function termSpans(tokens, mode) {
  return [...APPROVAL_TERMS[mode], ...PRAISE_TERMS[mode]].flatMap((p) => occurrences(tokens, p).map((i) => ({ start: i, end: i + p.tokens.length })));
}

// A negator up to 2 words before an approval/praise term, or (withPost) "không/chưa được" just after it.
function negated(tokens, mode, negators, withPost) {
  const notNegation = wordsOf(NOT_NEGATION_NEXT, mode);
  const post = wordsOf(POST_NEGATORS, mode);
  const duoc = mode === 'accented' ? 'được' : 'duoc';
  const negatorAt = (i) => i >= 0 && negators.has(tokens[i]) && !notNegation.has(tokens[i + 1]);
  const postAt = (i) => post.has(tokens[i]) && tokens[i + 1] === duoc;
  return termSpans(tokens, mode).some(({ start, end }) => {
    if (negatorAt(start - 1) || negatorAt(start - 2)) return true;
    if (!withPost) return false;
    for (let i = end; i < Math.min(end + POST_WINDOW, tokens.length - 1); i += 1) if (postAt(i)) return true;
    return false;
  });
}

function isNegatedApproval(ctx) {
  return MODES.some((mode) => negated(tokensOf(ctx, mode), mode, wordsOf(NEGATORS, mode), true));
}

// Unaccented "dung merge" may be "đừng merge": block it instead of guessing.
function isAmbiguousNegation(ctx) {
  return !ctx.accented && negated(ctx.plainTokens, 'plain', new Set(['dung']), false);
}

function endsWithParticle(tokens, mode) {
  const particles = wordsOf(QUESTION_PARTICLES, mode);
  const soft = wordsOf(SOFT_ENDINGS, mode);
  let i = tokens.length - 1;
  if (particles.has(tokens[i])) return true;
  while (i >= 0 && soft.has(tokens[i])) i -= 1;
  return i >= 0 && particles.has(tokens[i]);
}

const opensAsQuestion = (tokens, mode) => tokens[0] === 'sao' || QUESTION_OPENERS[mode].some((p) => occurrences(tokens, p).length > 0);

function isQuestion(ctx) {
  if (!hasApprovalOrPraise(ctx)) return false;
  if (ctx.norm.includes('?')) return true;
  return MODES.some((mode) => endsWithParticle(tokensOf(ctx, mode), mode) || opensAsQuestion(tokensOf(ctx, mode), mode));
}

// "thôi, merge đi": a leading "thôi" turns the approval into a shrug.
const thoiLead = (ctx) => (ctx.tokens[0] === 'thôi' || ctx.tokens[0] === 'thoi') && hasApprovalOrPraise(ctx);

function narrowedDung(ctx) {
  const at = ctx.tokens.indexOf('đừng');
  if (at < 0 || ctx.len > LIMIT.narrowedDung) return false;
  return ctx.tokens.indexOf('nữa', at + 1) > at || firstKey(ctx.tokens, DUNG_MARKERS.accented) !== null;
}

// Any of these anywhere in a short approval or praise candidate makes it abstain (PLAN §4.9, review fix 1).
// A token typed with accents must match the accented word; a token typed without accents matches the
// unaccented form, so an ambiguous unaccented token ("dung", "hoan", "thoi") always vetoes.
const vetoWords = (list) => list.map((w) => ({ accented: tokenize(w), plain: tokenize(stripAccents(w)) }));
const VETO = [
  ['negator', vetoWords(['đừng', 'chưa', 'không', 'ko', 'chẳng', 'khoan', 'đâu'])],
  ['cancel', vetoWords(['dừng', 'ngừng', 'huỷ', 'hủy', 'hoãn', 'revert', 'rollback', 'roll back', 'undo', 'cancel'])],
  ['question', vetoWords(['có nên', 'thế nào', 'như nào', 'khi nào', 'lúc nào', 'nào', 'bao giờ', 'bao nhiêu', 'gì', 'sao', 'mấy', 'liệu'])],
  ['shrug', vetoWords(['thôi', 'kệ'])],
  // Deferral: "để sau hẵng merge", "mai phát hành" postpone the action, so they are not approval yet.
  ['defer', vetoWords(['để sau', 'hẵng', 'lát', 'từ từ', 'đợi', 'chờ', 'mai', 'tuần sau', 'sau này'])],
  ['contrast', vetoWords(['nhưng', 'tuy nhiên', 'có điều'])],
];
const NEGATOR_WORDS = VETO[0][1];
// "không sao", "đừng lo", "không vấn đề (gì)" are reassurance, not negation: the whole phrase is skipped.
const REASSURANCE_NEXT = vetoWords(['vấn đề gì', 'vấn đề', 'vấn', 'sao', 'lo']);
// "mà" and "hay" veto only with a word after them: "đẹp rồi mà sai màu", "merge hay đợi"; not "hay rồi".
const NEEDS_NEXT = vetoWords(['mà', 'hay']);
const HAY_PRAISE_NEXT = vetoWords(['rồi', 'quá', 'lắm', 'thế', 'đấy', 'đó', 'ghê', 'thật']);

function wordAt(tokens, i, word) {
  return word.accented.every((a, j) => {
    const t = tokens[i + j];
    return t === a || (t !== undefined && t === word.plain[j] && stripAccents(t) === t);
  });
}

const anyWordAt = (tokens, i, words) => words.some((w) => wordAt(tokens, i, w));

function vetoKind(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const reassurance = anyWordAt(tokens, i, NEGATOR_WORDS) && REASSURANCE_NEXT.find((w) => wordAt(tokens, i + 1, w));
    if (reassurance) {
      i += reassurance.accented.length;
      continue;
    }
    const kind = VETO.find(([, words]) => anyWordAt(tokens, i, words));
    if (kind) return kind[0];
    if (i + 1 < tokens.length && anyWordAt(tokens, i, NEEDS_NEXT)) {
      const isHay = wordAt(tokens, i, NEEDS_NEXT[1]);
      if (!isHay) return 'contrast';
      if (!anyWordAt(tokens, i + 1, HAY_PRAISE_NEXT)) return 'question';
    }
  }
  return null;
}

function abstainRule(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return 'abstain:empty';
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('<')) return 'abstain:wrapper';
  if (trimmed.startsWith('/')) return 'abstain:slash-command';
  if (trimmed.startsWith('[Request interrupted')) return 'abstain:interrupted';
  if (raw.includes('```')) return 'abstain:code-fence';
  if (raw.length > LIMIT.rawSkip) return 'abstain:too-long';
  return null;
}

const result = (label, ruleId) => ({ label, ruleId });

export function classifyPrompt(text) {
  const early = abstainRule(text);
  if (early) return result('abstain', early);
  const typed = normalize(text);
  if (typed.length > LIMIT.tooLong) return result('abstain', 'abstain:too-long');
  const norm = expandAbbreviations(typed, stripAccents(typed) !== typed);
  const plain = stripAccents(norm);
  const ctx = { norm, len: typed.length, accented: plain !== norm, tokens: tokenize(norm), plainTokens: tokenize(plain) };

  if (ctx.len <= LIMIT.resignation) {
    const key = matchBlocking(ctx, RESIGNATION);
    if (key) return result('resignation', `resignation:${key}`);
  }
  if (ctx.len <= LIMIT.negation) {
    if (isNegatedApproval(ctx)) return result('correction', 'correction:negated-approval');
    if (isAmbiguousNegation(ctx)) return result('abstain', 'abstain:ambiguous-negation');
  }
  if (ctx.len <= LIMIT.resignation && thoiLead(ctx)) return result('resignation', 'resignation:thoi-lead');
  if (isQuestion(ctx)) return result('abstain', 'abstain:question');
  if (ctx.len <= LIMIT.correction) {
    const key = matchPositive(ctx, CORRECTION);
    if (key) return result('correction', `correction:${key}`);
    if (narrowedDung(ctx)) return result('correction', 'correction:dung');
    const clarify = matchPositive(ctx, CLARIFY);
    if (clarify) return result('clarify', `clarify:${clarify}`);
  }
  const positive = [
    ['approve_decision', APPROVE, LIMIT.approve],
    ['praise', PRAISE, LIMIT.praise],
    ['confirm', CONFIRM, Infinity],
    ['flow', FLOW, LIMIT.flow],
  ];
  for (const [label, group, limit] of positive) {
    if (ctx.len > limit) continue;
    const key = matchPositive(ctx, group);
    if (!key) continue;
    const veto = MILESTONE_LABELS.has(label) ? vetoKind(ctx.tokens) : null;
    return veto ? result('abstain', `abstain:veto-${veto}`) : result(label, `${label}:${key}`);
  }
  if (ctx.len > LIMIT.longApproval && matchBlocking(ctx, APPROVAL_TERMS)) return result('abstain', 'abstain:long-approval');
  return result('none', 'none');
}

export function isWrapperPrompt(cls) {
  return Boolean(cls) && cls.label === 'abstain' && WRAPPER_RULES.has(cls.ruleId);
}

// The skill's ask blocks in an assistant message's lines: [header line, "Trả lời:" line] index pairs, in order.
function askBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trimStart().startsWith(CHECKPOINT_HEADER)) continue;
    const end = Math.min(lines.length, i + 1 + ASK_BLOCK_LINES);
    const answer = lines.slice(i + 1, end).findIndex((l) => l.trimStart().replace(/^[*_]+/, '').startsWith(ANSWER_LINE));
    if (answer >= 0) blocks.push([i, i + 1 + answer]);
  }
  return blocks;
}

// True when an assistant message holds the skill's ask block: a line starting with the header (indent
// allowed) and, within the next lines, the "Trả lời:" line. A header quoted inside a sentence does not count.
export function hasCheckpointAsk(text) {
  if (typeof text !== 'string') return false;
  return askBlocks(text.normalize('NFC').split('\n')).length > 0;
}

// The floor labels a checkpoint question may show (critic/floor.mjs FLOOR_CLASSES).
export const FLOOR_LABELS = Object.freeze(['pass', 'owner_review_required', 'hard_reject']);
// "- Đề xuất: <exact text>" and "- Nhãn an toàn: <label> · ..." inside an ask block; a bullet and ** or __ around the
// field name are allowed.
const PROPOSAL_LINE = /^\s*(?:[-*•]\s*)?[*_]{0,2}Đề xuất[*_]{0,2}\s*:[*_]{0,2}(.*)$/u;
const LABEL_LINE = /^\s*(?:[-*•]\s*)?[*_]{0,2}Nhãn an toàn[^:]*:[*_]{0,2}\s*([a-z_]+)/u;
const firstMatch = (lines, re) => lines.map((l) => re.exec(l)).find(Boolean) ?? null;

// The last ask block of an assistant message: { proposal, floor }, where proposal is the exact NFC text of its
// "Đề xuất" line (trimmed; null when the block has none) and floor its "Nhãn an toàn" label (null unless one of
// FLOOR_LABELS). null when the message holds no ask block.
export function checkpointAskParts(text) {
  if (typeof text !== 'string') return null;
  const lines = text.normalize('NFC').split(/\r?\n/);
  const last = askBlocks(lines).at(-1);
  if (!last) return null;
  const body = lines.slice(last[0] + 1, last[1]);
  const proposal = firstMatch(body, PROPOSAL_LINE);
  const label = firstMatch(body, LABEL_LINE);
  return {
    proposal: proposal ? proposal[1].trim() || null : null,
    floor: label && FLOOR_LABELS.includes(label[1]) ? label[1] : null,
  };
}

// sha256 (hex) of the NFC form of a proposal. The hook logs it for the ask block the owner answered; the door
// (standards/promote-standard.mjs) compares it with the text it stores.
export const proposalDigest = (text) => crypto.createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

export function lengthBucket(text) {
  const n = typeof text === 'string' ? text.trim().length : 0;
  if (n <= 40) return '<=40';
  if (n <= 60) return '<=60';
  if (n <= 200) return '<=200';
  return '>200';
}

const OPTION_WORDS = [['nâng cấp', 'accept'], ['chỉnh', 'edit'], ['bỏ qua', 'skip']];
const ALIASES = [['đồng ý', 'accept'], ['có', 'accept'], ['1', 'accept'], ['2', 'edit'], ['không', 'skip'], ['ko', 'skip'], ['thôi', 'skip'], ['skip', 'skip'], ['3', 'skip']];
const FILLERS = ['nhé', 'nha', 'nhá', 'đi', 'em', 'ạ', 'luôn', 'đâu', 'cần', 'vậy'];
const SEPARATOR = /^[,.:;!\-–]/u;

function startsWithWords(tokens, words) {
  const want = tokenize(words);
  return want.length > 0 && want.every((w, i) => tokens[i] === w);
}

// Reply to a checkpoint question: accept | edit | skip | ignored (PLAN §4.3 step 1, §4.9 item 2).
// Only the first replyScan characters are read; a longer reply can still pick an option word, never an alias.
export function classifyCheckpointReply(text) {
  if (typeof text !== 'string') return 'ignored';
  const cut = text.length > LIMIT.replyScan;
  const norm = normalize(cut ? text.slice(0, LIMIT.replyScan) : text).replace(/^[^\p{L}\p{N}]+/u, '');
  const accented = stripAccents(norm) !== norm;
  const form = (w) => (accented ? w : stripAccents(w));
  const tokens = tokenize(norm);
  for (const [word, choice] of OPTION_WORDS) {
    if (startsWithWords(tokens, form(word))) return choice;
  }
  if (cut || norm.length > LIMIT.reply) return 'ignored';
  const fillers = new Set(FILLERS.map(form));
  for (const [alias, choice] of ALIASES) {
    const word = form(alias);
    if (!startsWithWords(tokens, word) || !norm.startsWith(word)) continue;
    const rest = norm.slice(word.length).trim();
    if (rest === '' || SEPARATOR.test(rest) || tokenize(rest).every((t) => fillers.has(t))) return choice;
  }
  return 'ignored';
}
