// Three-way code floor for a candidate standard (docs/izzi-v2/PLAN.md §2.4). Pure.
//   hard_reject            a plain, unconditional loosening the matcher is sure of: a floor phrase whose every
//                          other word is on the NEUTRAL list ("Bỏ qua test.", "Push without asking.", "Không cần hỏi
//                          anh trước khi push lên main."). Final, store-wide, never promotable.
//   owner_review_required  touches a protected topic (tests, review, CI, deploy, push, merge, release, security,
//                          secrets, permission, verification, reporting, asking the owner) or holds a floor phrase,
//                          and is not a sure loosening: a negator, exception or condition, any word off the NEUTRAL
//                          list, or text the matcher cannot read. Never promoted on a socrates ACCEPT alone.
//   pass                   no protected topic, no floor phrase, nothing the matcher cannot read.
// Negation never clears anything: a negated or scoped rule ("Never skip tests when merging to main") goes to the
// owner instead of being judged by more regexes. Reordering a sentence can at most move it from hard_reject to
// owner_review_required, never to pass.

import { stripDiacritics } from './candidate.mjs';

export const FLOOR_CLASSES = Object.freeze(['hard_reject', 'owner_review_required', 'pass']);

const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
// A gap token never ends with punctuation, so a gap cannot run across ; , . : or a dash into another clause.
const TOK = '[^\\s]*[^\\s.,;:!?—–]';
// Gaps are captured: their words are free text, judged like the words around the phrase.
const GAP = (n) => `((?:${TOK}\\s+){0,${n}}?)`;
// Each accented letter also matches its unaccented base letter ("Bo qua test"), while distinct accented words stay
// distinct (lời/lỗi, tất/tắt, cái/cài): full folding would read "Chạy tất cả test" as "tắt ... test".
const tolerant = (source) =>
  Array.from(source, (ch) => {
    const base = stripDiacritics(ch);
    return base !== ch && base.length === 1 ? `[${ch}${base}]` : ch;
  }).join('');
const longestFirst = (list) => [...list].sort((a, b) => b.length - a.length);
const anyF = (list) => `(?:${longestFirst(list).map(tolerant).join('|')})`;
const rx = (source) => new RegExp(source, 'gud');
const word = (list) => new RegExp(`${B}${anyF(list)}${E}`, 'gu');

// ---- floor phrases (what a loosening looks like) --------------------------------------------------------------

const SECRET_WORDS = [
  'secrets?', 'api key', 'api-key', 'apikey', 'private key', 'khoá api', 'khóa api', 'access token', 'api token',
  'mật khẩu', 'passwords?', 'credentials?',
];
const AUTH_VERBS = [
  'deploy(?:s|ed|ing)?', 'triển khai', 'force-push(?:es|ed|ing)?', 'force push(?:es|ed|ing)?', 'push(?:es|ed|ing)?',
  'merg(?:e|es|ed|ing)', 'releas(?:e|es|ed|ing)', 'phát hành', 'publish(?:es|ed|ing)?', 'đăng bài', 'đăng lên',
  'gửi tin nhắn', 'gửi tin', 'gửi email', 'gửi mail', 'nhắn tin', 'send(?:s|ing)? (?:a |the )?(?:messages?|emails?|mails?|dms?)',
  'sent (?:a |the )?(?:messages?|emails?|mails?|dms?)', 'xoá', 'xóa', 'delet(?:e|es|ed|ing)', 'drop(?:s|ped|ping)?',
  'thanh toán', 'charg(?:e|es|ed|ing)', 'mua', 'purchas(?:e|es|ed|ing)', 'cài', 'install(?:s|ed|ing)?',
];
const ASK_TAILS = [
  'mà không cần hỏi', 'mà không hỏi', 'không cần hỏi', 'không hỏi', 'khi chưa hỏi', 'chưa hỏi', 'mà không xin phép',
  'không xin phép', 'không cần duyệt', 'không chờ duyệt', 'chưa được duyệt', 'without asking', 'without approval',
  'without confirmation', 'without permission', 'without review', 'without the owner',
];
const VERIFY_NOUNS = [
  'tests?', 'testing', 'kiểm thử', 'review', 'reviews', 'kiểm tra', 'verify', 'verification', 'xác minh', 'kiểm chứng',
  'ci', 'lint', 'typecheck', 'smoke', 'qa',
];
const WITHOUT_VERBS = [
  ...AUTH_VERBS, 'commit(?:s|ted|ting)?', 'ship(?:s|ped|ping)?', 'finish(?:es|ed|ing)?', 'report(?:s|ed|ing)?',
  'mark(?:s|ed|ing)?', 'clos(?:e|es|ed|ing)', 'hand(?:s|ed|ing)? (?:off|over)', 'deliver(?:s|ed|ing)?',
  'submit(?:s|ted|ting)?', 'approv(?:e|es|ed|ing)', 'say(?:s|ing)?', 'declar(?:e|es|ed|ing)', 'claim(?:s|ed|ing)?',
  'call(?:s|ed|ing)?', 'land(?:s|ed|ing)?', 'roll(?:s|ed|ing)? out',
];
const FAILURE_WORDS = ['lỗi', 'fail', 'failed', 'failures?', 'thất bại', 'errors?', 'cảnh báo', 'warnings?'];

const FLOOR = [
  {
    cls: 'expands_authority',
    re: rx(`${B}${anyF(AUTH_VERBS)}${E}\\s*${GAP(4)}(?:(${TOK})?[,—–]\\s*)?${anyF(ASK_TAILS)}${E}`),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${anyF(['no need to', "don't need to", 'do not need to', "needn't", 'không cần', 'khỏi cần', "don't", 'do not', 'never', 'đừng', 'không'])}\\s+${anyF([
        'ask(?:ing)?', 'hỏi', 'xin phép', 'confirm(?:ing)?', 'check(?:ing)? with', 'wait(?:ing)? for approval', 'chờ duyệt',
        'get(?:ting)? approval',
      ])}${E}\\s*${GAP(3)}${anyF(AUTH_VERBS)}${E}`,
    ),
  },
  { cls: 'expands_authority', re: rx(`${B}${anyF(['tự ý', 'tự tiện', 'unilaterally'])}\\s+${GAP(1)}${anyF(AUTH_VERBS)}${E}`) },
  {
    cls: 'expands_authority',
    re: rx(`${B}${anyF(['tự duyệt', 'tự approve', 'tự merge', 'self-approve', 'self approve', '(?:approve|merge) (?:your|its|my|their) own'])}${E}`),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${anyF(['bỏ qua', 'skip', 'bypass', 'vượt', 'tắt', 'disable'])}\\s+${GAP(2)}${anyF([
        'quyền', 'permissions?', 'xin phép', 'hỏi ý kiến', 'phê duyệt', 'approvals?', 'confirmation', 'human gate', 'cổng duyệt',
      ])}${E}`,
    ),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${anyF(['dùng', 'use', 'sử dụng'])}\\s+${GAP(2)}${anyF(['credentials?', 'tokens?', 'keys?', 'mật khẩu', 'passwords?', 'tài khoản', 'accounts?'])}\\s+${GAP(2)}${anyF(['không được cấp', 'chưa được cấp', 'của người khác', 'của khách', 'not given', 'not granted', 'of someone else'])}`,
    ),
  },
  { cls: 'expands_authority', re: rx('dangerously-skip-permissions|bypasspermissions|--yolo') },
  {
    cls: 'loosens_security',
    re: rx(
      `${B}${anyF(['hardcode', 'hard-code', 'hard code', 'commit', 'paste', 'dán', 'nhét', 'embed'])}\\s+${GAP(2)}(?:${anyF([...SECRET_WORDS, 'tokens?'])}${E}|\\.env${E})`,
    ),
  },
  { cls: 'loosens_security', re: rx(`${B}${anyF(['in ra', 'print', 'log', 'ghi log'])}\\s+${GAP(2)}${anyF(SECRET_WORDS)}${E}`) },
  {
    cls: 'loosens_security',
    re: rx(
      `${B}${anyF(['tắt', 'disable', 'turn off', 'bỏ qua', 'skip', 'bypass', 'vô hiệu hoá', 'vô hiệu hóa', 'nới lỏng', 'loosen', 'relax'])}\\s+${GAP(2)}${anyF([
        'bảo mật', 'security', 'xác thực', 'auth', 'authentication', '2fa', 'mfa', 'tls', 'ssl', 'csrf', 'rate limit',
        'rate-limit', 'firewall', 'sandbox', 'mã hoá', 'mã hóa', 'encryption', 'quét bảo mật', 'secret scan(?:ning)?',
      ])}${E}`,
    ),
  },
  { cls: 'loosens_security', re: rx('skiptlsverification|rejectunauthorized\\s*[:=]\\s*false|verify\\s*=\\s*false|chmod\\s+777') },
  {
    cls: 'loosens_honest_reporting',
    re: rx(
      `${B}${anyF(['không', 'đừng', 'chớ', 'never', "don't", 'do not', 'avoid', 'tránh'])}\\s+(?:${tolerant('cần')}\\s+)?${anyF([
        'nhắc', 'báo', 'nói', 'ghi', 'nêu', 'kể', 'mention', 'report', 'show', 'hiện', 'list', 'liệt kê',
      ])}\\s+${GAP(3)}${anyF([...FAILURE_WORDS, 'rủi ro', 'risks?'])}${E}`,
    ),
  },
  {
    cls: 'loosens_honest_reporting',
    re: rx(`${B}${anyF(['giấu', 'che giấu', 'ẩn', 'hide', 'conceal', 'bury', 'lờ đi', 'omit'])}\\s+${GAP(2)}${anyF([...FAILURE_WORDS, 'kết quả xấu'])}${E}`),
  },
  {
    cls: 'loosens_honest_reporting',
    re: rx(
      `${B}${anyF(['báo', 'report', 'đánh dấu', 'mark', 'ghi nhận', 'coi'])}\\s+(?:${tolerant('là')}\\s+)?${anyF([
        'xong', 'done', 'complete', 'completed', 'pass', 'passed', 'thành công', 'success', 'đạt',
      ])}\\s+${GAP(2)}${anyF(['khi chưa', 'dù', 'mà chưa', 'without', 'before', 'even if', 'even though', 'trước khi', 'although'])}${E}`,
    ),
  },
  {
    cls: 'loosens_verification',
    re: rx(
      `${B}${anyF([
        'bỏ qua', 'skip', 'skipping', 'bypass', 'không cần', 'no need to', "don't need to", 'do not need to', 'lược bỏ',
        'omit', 'disable', 'tắt',
      ])}\\s+${GAP(2)}${anyF(VERIFY_NOUNS)}${E}`,
    ),
  },
  {
    cls: 'loosens_verification',
    re: rx(
      `${B}${anyF(['không cần', 'khỏi cần', 'no need to', 'không', 'đừng', 'khỏi', 'chẳng', 'never', "don't", 'do not'])}\\s+${anyF([
        'chạy', 'run', 'running', 'execute', 'thực hiện', 'làm',
      ])}${E}\\s*${GAP(2)}${anyF([...VERIFY_NOUNS, 'bộ test', 'test suite'])}${E}`,
    ),
  },
  {
    cls: 'loosens_verification',
    re: rx(
      `${B}${anyF(WITHOUT_VERBS)}${E}\\s+${GAP(3)}without\\s+(?:${anyF(['running', 'run', 'executing', 'any', 'a', 'the'])}\\s+){0,2}${anyF(VERIFY_NOUNS)}${E}`,
    ),
  },
  {
    cls: 'loosens_verification',
    re: rx(
      `${B}${anyF(VERIFY_NOUNS)}${E}\\s+${GAP(2)}${anyF([
        'không bắt buộc', 'không cần thiết', 'không quan trọng', 'tuỳ chọn', 'tùy chọn', 'optional', 'not required',
        'not mandatory', 'not needed', 'unnecessary',
      ])}${E}`,
    ),
  },
  { cls: 'loosens_verification', re: rx('--no-verify') },
];

// Words that may surround or sit inside a floor phrase without making it less sure: articles, addressees,
// targets, intensifiers, copulas, "and/or", and "before" (as in "ask before you deploy"). Never a negator,
// exception, condition or scope ("cho PR nhỏ", "on Fridays", "khi gấp" all send the sentence to the owner).
const NEUTRAL = [
  'the', 'a', 'an', 'all', 'any', 'every', 'always', 'just', 'simply', 'please', 'directly', 'straight', 'right away',
  'immediately', 'now', 'quickly', 'fast', 'for speed', 'to save time', 'to', 'into', 'onto', 'and', 'or', 'is', 'are',
  'before', 'main', 'master', 'prod', 'production', 'staging', 'branch', 'branches', 'repo', 'origin', 'remote',
  'code', 'changes', 'commits?', 'prs?', 'pull requests?', 'steps?', 'you', 'we', 'agents?', 'root', 'the owner',
  'owner', 'user', 'me', 'it', 'them', 'your', 'its', 'my', 'their', 'own',
  'cứ', 'cứ việc', 'luôn', 'luôn luôn', 'hãy', 'thẳng', 'ngay', 'ngay lập tức', 'lên', 'vào', 'đi', 'nhé', 'nha',
  'nhá', 'anh', 'em', 'mình', 'tôi', 'cho nhanh', 'nhanh', 'tất cả', 'mọi', 'các', 'trước khi', 'trước', 'là', 'và',
  'hoặc', 'nhánh', 'bước', 'thay đổi',
];
const NEUTRAL_RE = word(NEUTRAL);

// ---- protected topics and uncertainty words (reported to socrates and the owner) ------------------------------

const TOPICS = {
  verification: [
    'tests?', 'testing', 'tested', 'kiểm thử', 'bộ test', 'test suite', 'reviews?', 'reviewed', 'reviewing',
    'reviewers?', 'kiểm tra', 'kiểm chứng', 'xác minh', 'verif(?:y|ies|ied|ying|ication)', 'ci', 'lint(?:s|ing|er)?',
    'type-?check(?:s|ing)?', 'smoke', 'qa', 'e2e',
  ],
  release: [
    'deploy(?:s|ed|ing|ment|ments)?', 'triển khai', 'push(?:es|ed|ing)?', 'force-push(?:es|ed|ing)?', 'merg(?:e|es|ed|ing)',
    'releas(?:e|es|ed|ing)', 'phát hành', 'publish(?:es|ed|ing)?',
  ],
  security: [
    'security', 'bảo mật', 'auth', 'oauth', 'authentication', 'xác thực', '2fa', 'mfa', 'tls', 'ssl', 'csrf',
    'encryption', 'mã hoá', 'mã hóa', 'firewall', 'sandbox', 'rate limit', 'rate-limit',
  ],
  secrets: [
    'secrets?', 'api key', 'api-key', 'apikey', 'private key', 'khoá api', 'khóa api', 'tokens?', 'credentials?',
    'passwords?', 'mật khẩu', '\\.env',
  ],
  permission: [
    'permissions?', 'quyền', 'xin phép', 'approv(?:e|es|ed|ing|al|als)', 'phê duyệt', 'chờ duyệt', 'tự duyệt',
    'được duyệt', 'sign-?off', 'human gate', 'cổng duyệt', 'tự ý', 'delet(?:e|es|ed|ing|ion)', 'xoá', 'xóa',
    'install(?:s|ed|ing)?', 'cài đặt', 'thanh toán', 'payments?', 'purchas(?:e|es|ed|ing)', 'gửi email', 'gửi mail',
    'gửi tin', 'nhắn tin', 'send(?:s|ing)? (?:a |the )?(?:messages?|emails?|mails?|dms?)',
    'dangerously-skip-permissions', 'bypasspermissions', '--yolo', '--no-verify',
  ],
  asking_owner: ['hỏi', 'ask(?:s|ed|ing)?', 'confirm(?:s|ed|ing|ation)?'],
  reporting: ['báo cáo', 'reports?', 'reported', 'reporting', 'fail(?:s|ed|ing)?', 'failures?', 'thất bại', 'cảnh báo', 'warnings?'],
};
const TOPIC_RES = Object.entries(TOPICS).map(([topic, list]) => [topic, word(list)]);

const TRIGGERS = [
  'không', 'chẳng', 'chả', 'chưa', 'đừng', 'chớ', 'cấm', 'khỏi', 'trừ khi', 'trừ phi', 'ngoại trừ', 'trừ', 'nếu',
  'chỉ', 'miễn là', 'riêng', 'lúc', 'trường hợp', 'tránh', 'ngừng', 'dừng', 'thôi', 'never', 'no', 'not', 'nothing',
  'none', 'nobody', 'no one', 'neither', 'nor', 'cannot', 'unless', 'except', 'excepting', 'barring', 'save for',
  'apart from', 'other than', 'otherwise', 'provided', 'as long as', 'if', 'when', 'whenever', 'only', 'until',
  'forbid', 'forbids', 'forbidden', 'prohibit', 'prohibited', 'ban', 'banned', 'stop', 'avoid',
];
// Reported, never used to classify. Accent-insensitive only when the whole text is unaccented ("Khong bo qua
// test"), so "cho" (for) in accented text is not reported as "chớ" (do not).
const triggerRes = (fold) => [
  ...TRIGGERS.map((t) => [t, new RegExp(`${B}${fold(t)}${E}`, 'gu')]),
  // "khi" (when) is a condition; "trước khi" / "sau khi" (before / after) are not.
  ['khi', new RegExp(`${B}(?<!${fold('trước')}\\s|sau\\s)${fold('khi')}${E}`, 'gu')],
  ["n't", new RegExp(`\\p{L}n't${E}`, 'gu')],
];
const TRIGGER_RES = { unaccented: triggerRes(tolerant), accented: triggerRes((t) => t) };

// ---- text preparation -----------------------------------------------------------------------------------------

// Cyrillic and Greek letters that look like Latin ones ("Skiр tests" with a Cyrillic р), plus dotless i.
const CONFUSABLES = {
  а: 'a', в: 'b', е: 'e', ё: 'e', ѐ: 'e', і: 'i', ї: 'i', ј: 'j', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c',
  т: 't', у: 'y', х: 'x', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h', ӏ: 'l', α: 'a', β: 'b', γ: 'y', ε: 'e', η: 'n',
  ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w', ı: 'i',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu');
// Three or more single letters in a row, split by a space, dot, dash, underscore, star, middle dot or slash
// ("s k i p tests", "t.e.s.t.s"), are read as one word.
const LETTER_RUN = /(?<![\p{L}\p{N}])\p{L}(?:[ .\-_*·/]\p{L}(?![\p{L}\p{N}])){2,}/gu;
const LETTER_RUN_SEPARATORS = /[ .\-_*·/]/g;
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

// NFKC, lower case, invisible and combining characters removed, look-alikes folded, curly apostrophes straight,
// whitespace collapsed (line breaks kept: they separate the statement from its check).
export function prepareFloorText(input) {
  return String(input)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c])
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' ? '\n' : ' '))
    .replace(/[^\S\n]+/g, ' ')
    .replace(LETTER_RUN, (run) => run.replace(LETTER_RUN_SEPARATORS, ''));
}

// "t3sts", "pu$h": digits and symbols inside a word read as letters, for topic detection only.
const deLeet = (t) =>
  t.replace(/[\p{L}\p{N}@$]+/gu, (w) => (/\p{L}/u.test(w) && /[013457@$]/.test(w) ? w.replace(/[013457@$]/g, (c) => LEET[c]) : w));

// ---- classification -------------------------------------------------------------------------------------------

// The text outside every floor phrase, plus the gap words inside them; null when no floor phrase matched.
function floorMatches(t) {
  const fixed = new Uint8Array(t.length);
  let first = null;
  for (const { cls, re } of FLOOR) {
    for (const m of t.matchAll(re)) {
      first ??= { class: cls, phrase: m[0] };
      const [start, end] = m.indices[0];
      fixed.fill(1, start, end);
      for (const range of m.indices.slice(1)) if (range) fixed.fill(0, range[0], range[1]);
    }
  }
  if (!first) return null;
  let free = '';
  for (let i = 0; i < t.length; i += 1) free += fixed[i] ? ' ' : t[i];
  return { ...first, free };
}

const onlyNeutral = (free) => !/[\p{L}\p{N}]/u.test(free.replace(NEUTRAL_RE, ' '));

// One field (the statement or its check), prepared: { class, phrase } when it is a sure loosening, else null.
function sureLoosening(field) {
  const hit = floorMatches(field);
  return hit && onlyNeutral(hit.free) ? { class: hit.class, phrase: hit.phrase } : null;
}

const has = (re, t) => {
  re.lastIndex = 0;
  const hit = re.test(t);
  re.lastIndex = 0;
  return hit;
};

// input: the statement, or "statement\ncheck". Each line is judged on its own for hard_reject; topics and
// uncertainty words are read across the whole text.
// Returns { floor, class?, phrase?, topics: [...], triggers: [...], floorPhrase, unreadable }; topics and
// triggers are labels from the fixed vocabularies above, never candidate text.
export function classifyFloor(input) {
  const t = typeof input === 'string' ? prepareFloorText(input) : '';
  const topicsIn = (s) => TOPIC_RES.filter(([, re]) => has(re, s)).map(([topic]) => topic);
  const topics = [...new Set([...topicsIn(t), ...topicsIn(deLeet(t))])];
  const triggerSet = TRIGGER_RES[stripDiacritics(t) === t ? 'unaccented' : 'accented'];
  const triggers = triggerSet.filter(([, re]) => has(re, t)).map(([label]) => label);
  const unreadable = NON_LATIN_LETTER.test(t);
  const floorPhrase = floorMatches(t) !== null;
  const facts = { topics, triggers, floorPhrase, unreadable };
  for (const field of t.split('\n')) {
    const sure = field.trim() === '' ? null : sureLoosening(field);
    if (sure) return { floor: 'hard_reject', ...sure, ...facts };
  }
  const touched = topics.length > 0 || unreadable || floorPhrase;
  return { floor: touched ? 'owner_review_required' : 'pass', ...facts };
}

// The hard_reject part of the floor: { class, phrase } or null.
export function detectHardReject(input) {
  const r = classifyFloor(input);
  return r.floor === 'hard_reject' ? { class: r.class, phrase: r.phrase } : null;
}

// Exported for tests: the neutral and trigger vocabularies must never overlap.
export const FLOOR_VOCABULARY = Object.freeze({ neutral: NEUTRAL, triggers: [...TRIGGERS, 'khi', "n't"] });
