// Protected-topic vocabulary of the code floor (floor.mjs). These are LABELS for the owner's warning, not the safety
// boundary: pass is an allowlist (a preference with no review flag), and a topic hit only keeps a preference out of
// pass. The checkpoint question shows the topics next to the exact text.
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

export const VIETNAMESE_ASCII = Object.freeze(['ngay', 'ko', LATER_VI]);

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
});

export const TOPIC_NAMES = Object.freeze(Object.keys(TOPICS));
