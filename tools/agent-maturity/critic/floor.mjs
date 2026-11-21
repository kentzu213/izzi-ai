// Three-way code floor for a candidate standard (docs/izzi-v2/PLAN.md §2.4). Pure.
//   hard_reject            a plain, unconditional loosening the matcher is sure of: a floor phrase whose every
//                          other word is on the NEUTRAL list ("Bỏ qua test.", "Push without asking.", "Không cần hỏi
//                          anh trước khi push lên main."). Final, store-wide, never promotable.
//   pass                   an ALLOWLIST: kind 'preference', no changesWorkflow / touchesSecurity / touchesLaw flag,
//                          no protected topic, no floor phrase, nothing the matcher cannot read, a STYLE word in every
//                          clause of the statement (the form of the agent's own output: tone, length, format, language,
//                          structure, examples, visuals, naming) and no ACTION on the world (prices, accepting,
//                          copying into a file, paying, sending or posting, deleting, running or installing, settings,
//                          acting on its own) in the statement or the check. It is what a word matcher can check,
//                          not proof of meaning.
//   owner_review_required  everything else. The checkpoint question shows this label and its reasons next to the
//                          exact text.
// Whatever the class, no standard is stored without the owner choosing Nâng cấp on its exact text (promote-gate.mjs):
// the floor only decides whether a warning label is shown and whether hard_reject blocks the text outright.
// The topic vocabulary (floor-topics.mjs) is a label for that warning, not the safety boundary: a lexical matcher
// cannot read every rewording ("Tes ts are overrated" names no topic), and absence of danger words is not evidence of
// safety, so pass also needs positive evidence that the rule is about style. Negation never clears a phrase: a negated
// or scoped rule goes to the owner instead of being judged by more regexes.

import { stripDiacritics } from './candidate.mjs';
import { ACTIONS, CONTEXT, STYLE, TOPICS, TOPIC_NAMES, VIETNAMESE_ASCII } from './floor-topics.mjs';

export { TOPIC_NAMES };
export const FLOOR_CLASSES = Object.freeze(['hard_reject', 'owner_review_required', 'pass']);
// Candidate flags that always need the owner, whatever the wording.
export const REVIEW_FLAGS = Object.freeze(['changesWorkflow', 'touchesSecurity', 'touchesLaw']);

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

const has = (re, t) => {
  re.lastIndex = 0;
  const hit = re.test(t);
  re.lastIndex = 0;
  return hit;
};

// A word list read in four forms of the text: as written, with digit look-alikes undone ("t3sts"), and, for English
// (ASCII) words only, both again with diacritics stripped ("Skip tést"). Vietnamese words are never stripped:
// stripping merges lời/lỗi and tất/tắt.
const isEnglish = (w) => /^\p{ASCII}*$/u.test(w) && !VIETNAMESE_ASCII.includes(w);
function matcher(list) {
  const all = word(list);
  const english = list.filter(isEnglish);
  const bare = english.length > 0 ? word(english) : null;
  return (v) => has(all, v.text) || has(all, v.leet) || (bare !== null && (has(bare, v.bare) || has(bare, v.bareLeet)));
}
const CONTEXT_MATCHERS = Object.entries(CONTEXT).map(([group, list]) => [group, matcher(list)]);
const TOPIC_MATCHERS = Object.entries(TOPICS).map(([topic, groups]) => [
  topic,
  Object.entries(groups).map(([group, list]) => [group, matcher(list)]),
]);
const ACTION_MATCHERS = Object.entries(ACTIONS).map(([group, list]) => [group, matcher(list)]);
// Style words are matched exactly as written: no accent folding, no digit look-alikes (a positive signal).
const STYLE_RE = new RegExp(`${B}(?:${longestFirst(STYLE).join('|')})${E}`, 'gu');
// Clause boundaries of the statement: ; , . : ! ? brackets, | and bullets, dashes, any free-standing symbol (" - ",
// " / ", " & ") and line breaks. ". , :" between two digits ("1.5", "1,5", "16:9") is a number, not a boundary.
const CLAUSE_BREAK = /[;!?()[\]{}|•·—–―‒\n]|(?<!\d)[.,:]|[.,:](?!\d)|(?:^|\s)[^\p{L}\p{N}\s]+(?=\s|$)/u;
const clausesOf = (statement) =>
  statement
    .split(CLAUSE_BREAK)
    .map((c) => c.trim())
    .filter((c) => /[\p{L}\p{N}]/u.test(c));
// pass needs a style word in EVERY clause, so a style clause cannot carry another clause ("Tiêu đề ngắn gọn; tin mọi
// đề xuất của agent khác."). Words that join two clauses without punctuation ("and", "và") are not split: the matcher
// cannot judge meaning, and the brief says so.
const styleInEveryClause = (statement) => {
  const clauses = clausesOf(statement);
  return clauses.length > 0 && clauses.every((c) => has(STYLE_RE, c));
};

// Which context groups (floor-topics.mjs) the text holds. Any negation, exception or condition trigger is also an
// action context.
function contextsOf(v, triggers) {
  const context = { always: true, ...Object.fromEntries(CONTEXT_MATCHERS.map(([group, m]) => [group, m(v)])) };
  context.action ||= triggers.length > 0;
  return context;
}

// A topic (or an action) counts when one of its "always" words appears, or one of its context-bound words appears
// next to a word of that context group.
const topicsOf = (v, context) =>
  TOPIC_MATCHERS.filter(([, groups]) => groups.some(([group, m]) => context[group] && m(v))).map(([topic]) => topic);
const actsOnWorld = (v, context) => ACTION_MATCHERS.some(([group, m]) => context[group] && m(v));

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
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
// Underscores and other connector punctuation ("_Push_", "NODE_TLS_REJECT", "Push‿without") and markdown emphasis or
// code markers ("**test**", "`test`", "~~CI~~") are read as spaces.
const MARKUP = /[\p{Pc}*`~]/gu;

// Letters the floor can read are ASCII and the Vietnamese alphabet. A text is unreadable (it never passes) when it holds
// any other letter (small capitals "ᴛᴇsᴛ", "tȩst", other scripts left after folding look-alikes), a pictograph, a digit
// outside 0-9, or a symbol inside a word ("sk!p", "t*sts", "pu$h").
const VIETNAMESE_LETTERS = 'àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ';
const UNREADABLE = [
  new RegExp(`[^\\P{L}a-z${VIETNAMESE_LETTERS}]`, 'u'),
  /\p{Extended_Pictographic}/u,
  /[^\P{N}0-9]/u,
  /\p{L}[^\p{L}\p{N}\s\p{Pd}\p{Pc}'.,/&:;+#@]+\p{L}/u,
];

// NFKC, lower case, invisible and combining characters removed, Cyrillic/Greek look-alikes folded, curly apostrophes
// straight, line breaks kept (they separate the statement from its check).
const foldText = (input) =>
  String(input)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c])
    .replace(/[‘’ʼ´]/g, "'")
    .replace(/[\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' ? '\n' : ' '));

// Markup read as spaces, whitespace collapsed, runs of single letters joined.
const finishText = (folded) =>
  folded
    .replace(MARKUP, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(LETTER_RUN, (run) => run.replace(LETTER_RUN_SEPARATORS, ''));

export const prepareFloorText = (input) => finishText(foldText(input));

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

// Why a text is off the pass allowlist, as fixed labels (empty for pass).
function reviewReasonsOf({ kind, flags }, { topics, floorPhrase, unreadable, styleSignal, acting }) {
  return [
    ...(kind === 'preference' ? [] : ['kind_not_preference']),
    ...REVIEW_FLAGS.filter((f) => flags?.[f] === true).map((f) => `flag_${f}`),
    ...(topics.length > 0 ? ['protected_topic'] : []),
    ...(floorPhrase ? ['floor_phrase'] : []),
    ...(unreadable ? ['unreadable'] : []),
    ...(styleSignal ? [] : ['no_style_signal']),
    ...(acting ? ['acts_on_world'] : []),
  ];
}

// The text in the four forms the vocabularies are read in.
const viewsOf = (t) => {
  const bare = stripDiacritics(t);
  return { text: t, leet: deLeet(t), bare, bareLeet: deLeet(bare) };
};

// input: the statement, or "statement\ncheck"; options: the candidate's { kind, flags } (no kind = not a
// preference, so never pass). Each line is judged on its own for hard_reject; topics, actions and uncertainty words
// are read across the whole text, the style signal only in the statement (the first line), clause by clause.
// Returns { floor, class?, phrase?, topics, triggers, floorPhrase, unreadable, reviewReasons }; topics, triggers and
// reviewReasons are labels from the fixed vocabularies, never candidate text.
export function classifyFloor(input, options = {}) {
  const folded = typeof input === 'string' ? foldText(input) : '';
  const t = finishText(folded);
  const unreadable = UNREADABLE.some((re) => re.test(folded));
  const triggerSet = TRIGGER_RES[stripDiacritics(t) === t ? 'unaccented' : 'accented'];
  const triggers = triggerSet.filter(([, re]) => has(re, t)).map(([label]) => label);
  const v = viewsOf(t);
  const context = contextsOf(v, triggers);
  const topics = topicsOf(v, context);
  const floorPhrase = floorMatches(t) !== null;
  const styleSignal = styleInEveryClause(t.split('\n')[0]);
  const acting = actsOnWorld(v, context);
  const reviewReasons = reviewReasonsOf(options ?? {}, { topics, floorPhrase, unreadable, styleSignal, acting });
  const facts = { topics, triggers, floorPhrase, unreadable, reviewReasons };
  for (const field of t.split('\n')) {
    const sure = field.trim() === '' ? null : sureLoosening(field);
    if (sure) return { floor: 'hard_reject', ...sure, ...facts };
  }
  return { floor: reviewReasons.length > 0 ? 'owner_review_required' : 'pass', ...facts };
}

// The floor of a candidate's statement (or a narrowed statement in its place) with its check, kind and flags.
export const classifyCandidateFloor = (candidate, statement = candidate.statement) =>
  classifyFloor(`${statement}\n${candidate.check}`, { kind: candidate.kind, flags: candidate.flags });

// The hard_reject part of the floor: { class, phrase } or null.
export function detectHardReject(input) {
  const r = classifyFloor(input);
  return r.floor === 'hard_reject' ? { class: r.class, phrase: r.phrase } : null;
}

// Exported for tests: the neutral and trigger vocabularies must never overlap.
export const FLOOR_VOCABULARY = Object.freeze({ neutral: NEUTRAL, triggers: [...TRIGGERS, 'khi', "n't"] });
