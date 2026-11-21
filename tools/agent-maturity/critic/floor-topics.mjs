// Vocabulary of the code floor (floor.mjs): protected topics, STYLE signals and ACTIONS on the world. Topics are
// LABELS for the owner's warning, not the safety boundary: pass is an allowlist (a preference with a style signal in
// every clause of its statement, no action on the world and no review flag), and a topic hit only keeps a preference
// out of pass. The
// checkpoint question shows the label next to the exact text whenever the floor is not pass.
//
// Each topic lists its words by what they need to count:
//   always  counts on its own ("deploy", "CI", "hoàn tiền", "skip")
//   git     only next to a Git, deploy or branch word ("main", "production": "Màu main của brand" stays plain)
//   secret  only next to an API, auth or exposure word ("tokens", "key": "design tokens" stays plain)
//   data    only next to a data, history or account object ("xoá": "Xoá import không dùng" stays plain)
//   action  only next to a skip, negation, deferral, autonomy or immediacy word, or any negation, exception or
//           condition trigger of floor.mjs ("test": "A/B test hai tiêu đề" stays plain, "Khỏi test" does not)
// Entries are regex sources matched as whole words; an accented letter also matches its base letter. ASCII entries
// are also matched on the text with its diacritics stripped ("Skip tést", "Bỏ qua tẹst"), except the Vietnamese ones
// in VIETNAMESE_ASCII (stripping would read "ngày" as "ngay", "sáu" as "sau").

// At the end of a clause "luôn", "sau" and "kệ" mean "right away", "later" and "never mind"; before a verb "luôn" is
// "always", which tightens ("Luôn hỏi anh trước khi deploy").
const CLAUSE_END = '(?=\\s*(?:[.,;:!?)\\n]|$))';
const LATER_VI = `sau${CLAUSE_END}`;

export const VIETNAMESE_ASCII = Object.freeze(['ngay', 'ko', LATER_VI, 'mua']);

// A word whose accented letters must match exactly: its unaccented form is another common word ("thẻ"/the,
// "đăng"/đang, "huỷ"/Huy, "gửi"/GUI, "bật"/bat, "chạy"/chay).
const exact = (w) => Array.from(w, (ch) => (ch.codePointAt(0) > 0x7f ? `\\u{${ch.codePointAt(0).toString(16)}}` : ch)).join('');

export const CONTEXT = Object.freeze({
  git: [
    'git', 'github', 'gitlab', 'commit(?:s|ted|ting)?', 'push(?:es|ed|ing)?', 'merg(?:e|es|ed|ing)', 'deploy(?:s|ed|ing|ment)?',
    'triển khai', 'releas(?:e|es|ed|ing)', 'phát hành', 'branch(?:es)?', 'nhánh', 'prs?', 'pull requests?', 'hotfix(?:es)?',
    'rebase', 'đẩy', 'đưa lên', 'lên', 'upload(?:s|ed|ing)?', 'code', 'databases?', 'db', 'servers?', 'vps', 'env',
    'môi trường', 'migrations?', 'ship(?:s|ped|ping)?', 'roll(?:s|ed|ing)? ?out', 'rollout', 'thẳng', 'straight', 'directly',
    'builds?',
  ],
  secret: [
    'api', 'auth', 'oauth', 'secrets?', 'access', 'bearer', 'jwt', 'sessions?', 'private', 'credentials?', 'passwords?',
    'mật khẩu', 'log ?in', 'đăng nhập', 'sign ?in', 'admin', 'github', 'gh', 'của khách', 'của anh', "owner's",
    'someone else', 'người khác', 'logs?', 'logging', 'ghi log', 'print(?:s|ed|ing)?', 'in ra', 'echo', 'console', 'lộ',
    'leak(?:s|ed|ing)?', 'share', 'chia sẻ', 'commit', 'paste', 'dán', 'hard-?code', 'code', 'config', 'cấu hình', '\\.env',
    'env', 'repo', 'git', 'plain ?text', 'chat',
  ],
  data: [
    'tables?', 'bảng', 'databases?', 'db', 'dữ liệu', 'data', 'records?', 'bản ghi', 'branch(?:es)?', 'nhánh', 'repo',
    'history', 'lịch sử', 'accounts?', 'tài khoản', 'khách', 'customers?', 'users?', 'production', 'prod', 'live', 'tất cả',
    'toàn bộ', 'all', 'everything', 'mọi', 'backups?', 'sao lưu', 'logs?',
  ],
  action: [
    'skip(?:s|ped|ping)?', 'bỏ qua', 'bỏ', 'bypass(?:es|ed|ing)?', 'ignor(?:e|es|ed|ing)', 'disabl(?:e|es|ed|ing)',
    'turn(?:s|ed|ing)? off', 'tắt', 'omit(?:s|ted|ting)?', 'lược bỏ', 'drop(?:s|ped|ping)?', 'comment(?:s|ed|ing)? out',
    'hid(?:e|es|ing)', 'giấu', 'ẩn', 'kệ', 'phớt lờ', 'lờ đi', 'without', 'no need', "don't need", "needn't", 'không cần',
    'ko cần', 'k cần', 'khỏi', 'chẳng cần', 'ko', "don't", 'do not', "don't bother", 'later', 'afterwards', 'để sau',
    'tính sau', LATER_VI, 'làm gì', 'phí thời gian', 'mất thời gian', 'waste', 'pointless', 'useless', 'vô ích', 'thừa',
    'overkill', 'overrated', 'optional', 'tuỳ', 'tùy', 'unnecessary', 'không bắt buộc', 'không cần thiết', 'cũng được',
    'auto', 'automatic(?:ally)?', 'tự động', 'tự ý', 'tự quyết', 'tự làm', 'yourself', 'itself', 'whenever', 'freely',
    'liberally', 'directly', 'straight', 'right away', 'immediately', 'thẳng', 'ngay', `luôn${CLAUSE_END}`, 'cứ',
    'assum(?:e|es|ed|ing)', 'mặc định', 'feel free', 'go ahead', 'false', 'tất cả user', 'toàn bộ user', 'mọi user',
    'all users', 'everyone', 'tất cả khách', 'toàn bộ khách', 'email list',
  ],
  // Objects that make copy / paste / save / write an action on the world (ACTIONS.file).
  file: [
    'files?', 'tệp', 'thư mục', 'folders?', 'director(?:y|ies)', 'repo(?:s|sitory|sitories)?', 'readme', 'config(?:s|uration)?',
    'cấu hình', '\\.env', 'env', 'code', 'codebase', 'mã nguồn', 'source', 'docs?', 'tài liệu', 'json', 'yaml', 'yml', 'notion',
    'sheets?', 'drive', 'wiki', 'databases?', 'db', 'disk', 'ổ đĩa', 'clipboard', 'servers?', 'vps', 'cloud', 'github', 'gist',
    '[\\p{L}\\p{N}_-]+\\.(?:md|json|ya?ml|txt|ts|tsx|js|mjs|cjs|env|toml|ini|cfg)',
  ],
});

// STYLE signals: words about the form of the agent's own output (tone, length, format, language, structure,
// examples, visuals of produced content, naming and commit-message style). pass needs one in every clause of the
// statement (floor.mjs). They are matched exactly as written, never accent-folded or de-leeted: a positive signal must
// not be read into a text ("anh" is not "ảnh", "mau" is not "màu").
// "xưng" alone is not one: "xưng là nhân viên thật", "xưng anh Huy" claim an identity. Only "xưng hô" (the form of
// address) and a clause that is nothing but a pronoun choice ("xưng em", "xưng em với anh") count.
const PRONOUN_CHOICE = 'xưng (?:em|anh|chị|mình|tôi|tớ)(?: với (?:anh|chị|em|bạn|khách(?: hàng)?|quý khách|mọi người))?$';
export const STYLE = Object.freeze([
  // tone
  'tones?', 'giọng', 'giọng văn', 'giọng điệu', 'văn phong', 'xưng hô', PRONOUN_CHOICE, 'thân thiện', 'lịch sự',
  'trang trọng', 'thân mật', 'gần gũi', 'hài hước', 'friendly', 'polite', 'formal', 'informal', 'casual',
  // length and wording
  'length', 'độ dài', 'ngắn gọn', 'ngắn(?! hạn)', 'gọn', 'súc tích', 'dài dòng', 'rườm rà', 'lời thừa', 'từ thừa', 'concise(?:ly)?',
  'verbose', 'brevity', 'ký tự', 'kí tự', 'characters?', 'chars?', '\\d+ từ', 'từ ngữ', 'dùng từ', 'words?', 'wording',
  'phrasing', 'câu', 'sentences?', 'dòng(?! tiền| lệnh| sản phẩm)', 'lines?', 'chính tả', 'spelling', 'ngữ pháp', 'grammar',
  'dấu câu', 'punctuation', 'diễn đạt', 'cách viết', 'lời thường', 'plain (?:words|language|english)', 'style', 'phong cách',
  // format
  'format(?:s|ted|ting)?', 'định dạng', 'tiêu đề', 'titles?', 'headings?', 'subject lines?', 'in đậm', 'chữ đậm', 'tô đậm',
  'in nghiêng', 'bold', 'italics?', 'gạch đầu dòng', 'bullets?', 'bullet points?', 'bảng', 'tables?', 'markdown', 'emojis?',
  'icons?', 'hashtags?', 'viết hoa', 'in hoa', 'chữ hoa', 'uppercase', 'lowercase', 'code blocks?', 'khối code',
  // language
  'language', 'ngôn ngữ', 'tiếng việt', 'tiếng anh', 'có dấu', 'không dấu', 'english', 'vietnamese', 'song ngữ', 'bilingual',
  'thuật ngữ', 'jargon', 'tiếng lóng', 'slang',
  // structure
  'structure', 'cấu trúc', 'thứ tự', 'mục(?! tiêu| đích)', 'sections?', '(?<!giai |công )đoạn', 'paragraphs?', 'bố cục', 'layout',
  'mở bài', 'kết bài', 'intro', 'outro', 'kết luận', '(?:đầu|cuối|giữa) (?:mỗi )?(?:bài|câu|đoạn|mục|trang|email|tin)', 'tóm tắt',
  'summar(?:y|ies|ize|ise)',
  // examples
  'ví dụ', 'examples?', 'minh hoạ', 'minh họa',
  // visuals of produced content
  'ảnh(?! hưởng)', 'hình ảnh', '(?<!(?:cấu|mô|địa|tình|điển) )hình', 'màu', 'màu sắc', '(?<!(?:model|mô hình) )nền(?! tảng| móng)',
  'fonts?', 'phông', 'phông chữ', 'cỡ chữ', 'kiểu chữ', 'typography', 'captions?', 'thumbnails?', 'banners?', 'design tokens?',
  'colou?rs?', 'images?', 'photos?', 'pictures?', 'visuals?', 'watermark', 'palette',
  // naming and commit-message style (not "commit" itself)
  'đặt tên', 'tên (?:biến|hàm|file|tệp|nhánh|thư mục|class|component)', 'naming', '(?:kebab|camel|snake|pascal)[ -]?case',
  'commit messages?', 'conventional commits?',
]);

// Actions on the world: a rule naming one never passes, whatever its style words. Read like topics (accent-tolerant,
// de-leeted, English words also without diacritics). "file" words count only next to a CONTEXT.file object.
export const ACTIONS = Object.freeze({
  always: [
    // prices
    'tăng giá', 'giảm giá', 'hạ giá', 'nâng giá', 'đổi giá', 'chỉnh giá', 'điều chỉnh giá', 'sửa giá', 'đặt giá', 'báo giá',
    'pric(?:e|es|ed|ing)', 'repric(?:e|es|ed|ing)', 'discount(?:s|ed|ing)?', 'coupons?',
    // accepting for the owner
    'chấp nhận', 'accept(?:s|ed|ing)?', 'approv(?:e|es|ed|ing|al|als)', 'đồng ý', 'agre(?:e|es|ed) to',
    // money
    'gia hạn', 'renew(?:s|ed|al|als|ing)?', 'mua', 'buy(?:s|ing)?', 'bought', 'purchas(?:e|es|ed|ing)', 'thanh toán',
    'pay(?:s|ing|ment|ments)?', 'paid', exact('thẻ'), 'cards?', 'trả tiền', 'chuyển khoản', 'chuyển tiền', 'nạp', 'top ?-?up',
    'subscrib(?:e|es|ed|ing)', 'ngân sách', 'budgets?', 'spend(?:s|ing)?', 'spent', 'hoá đơn', 'hóa đơn', 'invoices?', 'billing',
    // sending, posting, replying to people
    exact('gửi'), 'send(?:s|ing)?', 'sent', `(?<!bài )${exact('đăng')}`, 'post(?:s|ed|ing)?(?!-mortem)', 'publish(?:es|ed|ing)?',
    'xuất bản', 'lên bài', 'lên lịch', 'hẹn giờ', 'schedul(?:e|es|ed|ing)', 'repl(?:y|ies|ied|ying) to', 'respond(?:s|ed|ing)? to',
    'trả lời khách', 'trả lời (?:review|bình luận|comment|inbox|tin nhắn|page|fanpage|email|mail)', 'phản hồi khách',
    'phản hồi (?:review|bình luận|comment|inbox|tin nhắn)', 'nhắn tin', 'nhắn khách', 'chia sẻ', 'shar(?:e|es|ed|ing)',
    'tweet(?:s|ed|ing)?', 'comment(?:s|ed|ing)? on', 'gọi điện', 'log ?in', 'sign ?(?:in|up)',
    // deleting
    'xoá', 'xóa', 'delet(?:e|es|ed|ing|ion)', 'drop(?:s|ped|ping)?(?! shadows?)', 'purg(?:e|es|ed|ing)', 'wip(?:e|es|ed|ing)',
    exact('huỷ'), exact('hủy'), 'cancel(?:s|led|ling|ed|ing)?', exact('gỡ'),
    // running, installing, switching on
    exact('chạy'), 'run(?:s|ning)?(?!-on)', 'execut(?:e|es|ed|ing|ion)', 'thực thi', exact('cài'), 'install(?:s|ed|ing|ation)?',
    'invok(?:e|es|ed|ing)', 'trigger(?:s|ed|ing)?', 'kích hoạt', 'activat(?:e|es|ed|ing)', `(?<!nổi )${exact('bật')}`,
    'enabl(?:e|es|ed|ing)', 'turn(?:s|ed|ing)? on', 'khởi động', 'restart(?:s|ed|ing)?', 'reboot(?:s|ed|ing)?',
    'gọi (?:model|mô hình|api|llm|agent)', 'call(?:s|ed|ing)? (?:the )?(?:api|apis|endpoints?|models?|customers?)', 'tải lên',
    'tải về', 'tải xuống', 'upload(?:s|ed|ing)?', 'download(?:s|ed|ing)?', 'xuất file', 'export(?:s|ed|ing)?',
    // settings
    'cấu hình', 'config(?:s|ure|ures|ured|uring|uration|urations)?', 'settings?', 'thiết lập',
    // acting on its own
    `(?<!(?:ký|kí|thứ|tương|trật|tuần|văn) )${exact('tự')}(?! (?:nhiên|tin|do|nguyện|giác|hào|sự|truyện|điển|tại))`, 'tự động',
    'auto', 'automatic(?:ally)?', 'automat(?:e|es|ed|ing|ion)', 'yourself', 'on (?:your|its) own', 'tự mình', 'unattended',
  ],
  file: [
    'copy', 'cop(?:ies|ied|ying)', 'chép', 'sao chép', exact('dán'), 'paste[sd]?', 'pasting', 'lưu(?! ý)', 'sav(?:e|es|ed|ing)',
    'stor(?:e|es|ed|ing)', 'ghi vào', 'ghi đè', 'ghi ra', 'ghi lên', 'writ(?:e|es|ing) (?:it |them )?(?:to|into|in)',
    'wrote (?:to|into|in)', 'overwrit(?:e|es|ing|ten)', 'thêm vào', 'đưa vào', 'nhét vào', 'add(?:s|ed|ing)? (?:it |them )?(?:to|into)',
    'put(?:s|ting)? (?:it |them )?in(?:to)?', 'commit(?:s|ted|ting)?', 'push(?:es|ed|ing)?',
  ],
});

export const TOPICS = Object.freeze({
  verification: {
    always: [
      'kiểm thử', 'bộ test', 'test ?suites?', 'unit ?tests?', 'unittests?', 'pretests?', 'retests?', 'ci', 'cicd', 'ci/cd',
      'qa', 'e2e', 'smoke', 'lint(?:s|ing|er|ers)?', 'eslint', 'lint-staged', 'type-?check(?:s|ing|er)?', 'tsc', 'vitest',
      'jest', 'playwright', 'pytest', 'kiểm chứng', 'xác minh', 'verif(?:y|ies|ied|ying|ication)', 'duyệt', 'rà soát',
      'github actions', 'git hooks?', 'pre-?commit', 'pre-?push', 'husky', 'no-verify', 'coverage', 'ts-ignore', 'ts-nocheck',
      'ts-expect-error', 'it\\.skip', 'describe\\.skip', 'test\\.skip', 'flaky',
    ],
    action: [
      'tests?', 'testing', 'tested', 'reviews?', 'reviewed', 'reviewing', 'reviewers?', 'checks?', 'checking', 'kiểm tra',
      'soát', 'specs?', 'suites?', 'chạy thử', 'strict', 'hooks?', 'pipelines?',
    ],
  },
  release: {
    always: [
      'deploy(?:s|ed|ing|ment|ments)?', 'redeploy(?:s|ed|ing)?', 'triển khai', 'merg(?:e|es|ed|ing)', 'force-?push(?:es|ed|ing)?',
      'force push(?:es|ed|ing)?', '--force', '-f', 'git push', 'git reset', 'reset --hard', '--hard', '--admin',
      'rewrit(?:e|es|ing) (?:the )?history', 'rebase', 'go live', 'go-live', 'đẩy code', 'roll(?:s|ed|ing)? ?out', 'rollout',
      'nhánh chính', 'hotfix(?:es)?', 'vps', 'môi trường thật', 'bump version',
    ],
    git: ['main', 'master', 'prod', 'production', 'live'],
    action: [
      'push(?:es|ed|ing)?', 'releas(?:e|es|ed|ing)', 'phát hành', 'publish(?:es|ed|ing)?', 'ship(?:s|ped|ping)?',
      'land(?:s|ed)?', 'tag(?:s|ged|ging)?', 'betas?', 'installers?', 'upload(?:s|ed|ing)?', 'github', 'bản mới',
      'versions?', 'phiên bản',
    ],
  },
  security: {
    always: [
      'security', 'bảo mật', 'auth', 'oauth', 'authentication', 'authori[sz]ation', 'xác thực', '2fa', 'mfa', 'tls', 'ssl',
      'csrf', 'cors', 'encryption', 'mã hoá', 'mã hóa', 'firewall', 'sandbox', 'rate ?-?limit(?:s|ing)?', 'insecure',
      'curl -k', 'unsigned', 'code ?signing', 'ký số', 'gpg', 'no-gpg-sign', 'sudo', 'chmod', 'rm -rf', 'bearer', 'jwt',
    ],
    action: ['(?<!đăng )ký(?! tự)', 'signatures?', 'certificates?', 'chứng chỉ'],
  },
  secrets: {
    always: [
      'secrets?', 'api ?-?keys?', 'apikeys?', 'private keys?', 'khoá api', 'khóa api', 'access tokens?', 'api tokens?',
      'credentials?', 'passwords?', 'passwd', 'mật khẩu', '\\.env', 'env', 'env files?', 'biến môi trường', 'service ?role',
      'request headers?', 'authorization headers?',
    ],
    secret: ['tokens?', 'keys?', 'khoá', 'khóa', 'headers?', 'tài khoản', 'accs?', 'accounts?', 'cookies?'],
  },
  permission: {
    always: [
      'xin phép', 'phê duyệt', 'approv(?:e|es|ed|ing|al|als)', 'sign-?off', 'human gate', 'cổng duyệt', 'chờ duyệt',
      'tự duyệt', 'được duyệt', 'dangerously-skip-permissions', 'bypasspermissions', '--yolo', 'yolo',
      'auto-?accept(?:s|ed|ing)?', 'auto-?merg(?:e|es|ed|ing)', 'quyền admin', 'admin rights',
    ],
    action: ['quyền', 'permissions?', 'install(?:s|ed|ing)?', 'cài đặt'],
  },
  data: {
    always: [
      'migrations?', 'migrat(?:e|es|ed|ing)', 'xoá bảng', 'xóa bảng', 'drop (?:the )?(?:old )?tables?', 'drop database',
      'truncat(?:e|es|ed|ing)', 'live db', 'production db',
    ],
    data: ['xoá', 'xóa', 'delet(?:e|es|ed|ing|ion)', 'drop(?:s|ped|ping)?', 'wip(?:e|es|ed|ing)', 'purg(?:e|es|ed|ing)'],
  },
  payment: {
    always: ['refund(?:s|ed|ing)?', 'hoàn tiền', 'trừ tiền', 'chuyển tiền', 'nạp tiền', 'auto-?renew(?:s|ed|al)?', 'chargebacks?'],
    action: [
      'thanh toán', 'payments?', 'pay(?:s|ing)?', 'paid', 'charg(?:e|es|ed|ing)', 'mua gói', 'mua thêm', 'mua credit',
      'purchas(?:e|es|ed|ing)', 'buy(?:s|ing)?', 'gia hạn', 'credits?', 'subscriptions?', 'invoices?', 'billing',
      'top ?-?up', 'chuyển khoản',
    ],
  },
  customer_contact: {
    always: ['blast(?:s|ed|ing)?', 'auto-?repl(?:y|ies)', 'mass (?:e-?mails?|messages?|messaging|dms?)', 'spam(?:s|med|ming)?'],
    action: [
      'nhắn khách', 'nhắn tin', 'gửi tin(?: nhắn)?', 'gửi email', 'gửi mail', 'e-?mails?', 'send(?:s|ing)?', 'sent', 'dms?',
      'inbox', 'zalo', 'messenger', 'trả lời khách', 'reply to (?:the )?customers?', 'noti', 'notifications?', 'thông báo đẩy',
      'đăng bài', 'lên bài', 'bài đăng', 'fanpage', 'pages?', 'posts?', 'posted', 'posting',
    ],
  },
  reporting: {
    always: [
      'báo anh', 'nói với anh', 'làm phiền', 'ping(?:ing)? me', 'loop(?:ing)? me in', 'tell(?:ing)? me', 'notify(?:ing)? me',
      'keep me posted', 'red (?:specs?|tests?|builds?|pipelines?|ci|checks?)',
    ],
    action: [
      'báo', 'báo cáo', 'báo lại', 'reports?', 'reported', 'reporting', 'fail(?:s|ed|ing)?', 'failures?', 'thất bại',
      'cảnh báo', 'warnings?', 'thông báo', 'lỗi', 'errors?', 'bugs?', 'sự cố', 'incidents?', 'ping(?:s|ed|ing)?',
      'mention(?:s|ed|ing)?',
    ],
  },
  asking_owner: {
    always: [
      'the owner', "owner's", 'go-ahead', 'xin ý kiến', 'chờ anh', 'đợi anh', 'tự quyết(?: định)?', 'tự ý', 'tự tiện',
      'autonomous(?:ly)?', 'unilateral(?:ly)?',
    ],
    action: ['hỏi', 'ask(?:s|ed|ing)?', 'confirm(?:s|ed|ing|ation)?', 'xác nhận', 'đồng ý', 'agre(?:e|es|ed)', 'consent(?:s|ed)?'],
  },
  // Loosening verbs on their own: a skipped object the floor cannot read ("Bỏ qua te st") still counts.
  loosening: {
    always: [
      'skip(?:s|ped|ping)?', 'bỏ qua', 'bypass(?:es|ed|ing)?', 'lược bỏ', 'omit(?:s|ted|ting)?', 'phớt lờ', 'lờ đi', 'mặc kệ',
      `kệ${CLAUSE_END}`, 'ignor(?:e|es|ed|ing)', 'disabl(?:e|es|ed|ing)', 'turn(?:s|ed|ing)? off', '(?<!(?:tóm|viết) )tắt',
      'không cần', 'ko cần', 'k cần', 'khỏi cần', 'chẳng cần', '(?<!ra )khỏi', 'no need', "don't need", "needn't",
      "don't bother", 'comment(?:s|ed|ing)? out',
    ],
  },
  // Whether the agent says it is automated: Luật 134/2025/QH15 Điều 11.1 requires an AI talking to customers to say so,
  // so any rule about it ("đừng nói mình là AI", "xưng là nhân viên thật", or a tightening) goes to the owner. "ai" is
  // also Vietnamese for "who"; it is read as AI anyway, which only sends the text to the owner.
  disclosure: {
    always: [
      'ai', 'a\\.i\\.?', 'trí tuệ nhân tạo', 'artificial intelligence', 'bots?', 'chatbots?', 'robots?', 'người máy',
      'trợ lý ảo', 'virtual assistants?', 'tự động', 'automat(?:ed|ic|ically|ion)', 'người thật', 'nhân viên thật',
      'real (?:person|people|humans?)', 'humans?', 'disclos(?:e|es|ed|ing|ure)', 'công bố', 'tiết lộ',
    ],
  },
});

export const TOPIC_NAMES = Object.freeze(Object.keys(TOPICS));
