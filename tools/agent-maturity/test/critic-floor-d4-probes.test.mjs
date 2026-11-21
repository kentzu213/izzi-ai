// D4 round 4 (review BLOCK: "rewording can never reach pass" was false). pass is now an allowlist: only a
// preference with no review flag, no protected topic, no floor phrase and nothing unreadable passes. Every reviewer
// probe is a case here; loosenings are checked as kind 'preference', the only kind that can pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { classifyFloor, prepareFloorText } from '../critic/floor.mjs';

const PROBES = JSON.parse(readFileSync(new URL('./fixtures/d4-floor-probes.json', import.meta.url), 'utf8')).groups;
const PREF = { kind: 'preference' };
const floorOf = (text, opts = PREF) => classifyFloor(text, opts).floor;
const countBy = (texts) => texts.reduce((acc, t) => ({ ...acc, [floorOf(t)]: (acc[floorOf(t)] ?? 0) + 1 }), {});

for (const [group, { expect, texts }] of Object.entries(PROBES)) {
  if (expect !== 'not_pass') continue;
  test(`reviewer probes ${group}: no loosening passes, even as a preference`, (t) => {
    // Arrange + Act
    const leaks = texts.filter((text) => floorOf(text) === 'pass');

    // Assert
    t.diagnostic(`${group} ${texts.length}: ${JSON.stringify(countBy(texts))}`);
    assert.deepEqual(leaks, []);
  });
}

test('harmless or tightening domain rules: at least 25 of 30 pass as preferences', (t) => {
  // Arrange
  const { texts, minPass } = PROBES.harmless_or_tightening;

  // Act
  const passed = texts.filter((text) => floorOf(text) === 'pass');

  // Assert
  t.diagnostic(`harmless pass ${passed.length}/${texts.length}: held ${JSON.stringify(texts.filter((x) => !passed.includes(x)))}`);
  assert.equal(texts.length, 30);
  assert.ok(passed.length >= minPass, `${passed.length}/${texts.length} pass`);
  for (const tightening of ['Luôn hỏi anh trước khi deploy.', 'Never skip tests.']) assert.notEqual(floorOf(tightening), 'pass');
});

test('pass is an allowlist: only kind preference, and no changesWorkflow, touchesSecurity or touchesLaw flag', () => {
  // Arrange
  const plain = 'Viết câu ngắn gọn hơn.';

  // Act + Assert
  assert.equal(floorOf(plain), 'pass');
  for (const kind of ['procedure', 'quality_gate', 'pitfall', undefined]) assert.equal(floorOf(plain, { kind }), 'owner_review_required', kind);
  assert.equal(classifyFloor(plain).floor, 'owner_review_required', 'no kind given is not a preference');
  for (const flag of ['changesWorkflow', 'touchesSecurity', 'touchesLaw']) {
    assert.equal(floorOf(plain, { kind: 'preference', flags: { [flag]: true } }), 'owner_review_required', flag);
    assert.equal(floorOf(plain, { kind: 'preference', flags: { [flag]: false } }), 'pass', `${flag}: false`);
  }
  assert.equal(floorOf(plain, { kind: 'preference', flags: { contentClaim: true, ownerPrivate: true } }), 'pass');
});

test('reviewReasons name why a text is off the allowlist, as fixed labels only', () => {
  // Arrange + Act
  const r = classifyFloor('Skip ᴛᴇsᴛs.', { kind: 'procedure', flags: { changesWorkflow: true } });

  // Assert
  assert.equal(r.floor, 'owner_review_required');
  assert.deepEqual(r.reviewReasons, ['kind_not_preference', 'flag_changesWorkflow', 'protected_topic', 'unreadable']);
  assert.deepEqual(classifyFloor('Viết câu ngắn gọn hơn.', PREF).reviewReasons, []);
});

test('underscores and markdown emphasis or code markers are read as spaces', () => {
  // Arrange + Act + Assert
  assert.equal(prepareFloorText('_Push_ without _asking_.'), ' push without asking .');
  assert.equal(prepareFloorText('Bỏ qua `test`, **review** và ~~CI~~.'), 'bỏ qua test , review và ci .');
  assert.equal(prepareFloorText('NODE_TLS_REJECT_UNAUTHORIZED=0'), 'node tls reject unauthorized=0');
  assert.equal(prepareFloorText('Push‿without asking'), 'push without asking');
  assert.equal(classifyFloor('_Push_ without _asking_.').floor, 'hard_reject');
  assert.equal(classifyFloor('Bỏ qua `test`.').floor, 'hard_reject');
});

test('English topic words are also read without diacritics; Vietnamese ones keep them', () => {
  // Arrange + Act + Assert
  for (const text of ['Skip tést.', 'Skip tẹsts.', 'Bỏ qua tẹst.']) assert.ok(classifyFloor(text, PREF).topics.includes('verification'), text);
  assert.equal(floorOf('Tóm tắt tiến độ tối đa 5 gạch đầu dòng.'), 'pass', 'tóm tắt is not tắt (turn off)');
  assert.equal(floorOf('Chụp ảnh tất cả sản phẩm trên nền trắng.'), 'pass', 'tất (all) is not tắt (turn off)');
  assert.equal(floorOf('Viết lời chào ngắn.'), 'pass', 'lời (words) is not lỗi (error)');
});

test('unreadable: Latin letters outside ASCII and Vietnamese, pictographs, foreign digits, symbols inside a word', () => {
  // Arrange
  const unreadable = ['Skip ᴛᴇsᴛs.', 'Bỏ qua tȩst.', 'Skip the 🧪.', 'Viết gọn ✅.', 'Sk!p tests.', 'Ship t*sts later.', 'Skip ٣ tests.', 'Pսsh.'];
  const readable = ['Trả lời bằng tiếng Việt có dấu, tối đa 5 ý.', 'A/B test hai tiêu đề.', 'Explain internal codes in plain words.'];

  // Act + Assert
  for (const text of unreadable) {
    assert.equal(classifyFloor(text, PREF).unreadable, true, text);
    assert.notEqual(floorOf(text), 'pass', text);
  }
  for (const text of readable) assert.equal(classifyFloor(text, PREF).unreadable, false, text);
});

test('M1: an ambiguous domain word counts only next to a context word', () => {
  // Arrange: [harmless, loosening] pairs around the same word
  const pairs = [
    ['Màu main của brand là xanh navy.', 'Commit thẳng lên main.'],
    ['Ảnh chất lượng production, không watermark.', 'Deploy code lên production luôn.'],
    ['Dùng design tokens cho màu sắc.', 'Paste the API token into config.'],
    ['A/B test hai tiêu đề quảng cáo.', 'Khỏi test.'],
    ['Trả lời review của khách lịch sự.', 'Không cần review.'],
    ['Thông báo cho khách bằng giọng thân thiện.', 'Tắt thông báo lỗi.'],
    ['Hiển thị lỗi thân thiện cho người dùng.', 'Lỗi nhỏ thì kệ.'],
    ['Quyền lợi khách hàng ghi rõ trong bài.', 'Bỏ qua quyền truy cập.'],
    ['Trang thanh toán ghi rõ phí ship.', 'Thanh toán tự động cho khách.'],
    ['Hỏi khách tên trước khi tư vấn.', 'Khỏi hỏi.'],
  ];

  // Act + Assert
  for (const [harmless, loose] of pairs) {
    assert.equal(floorOf(harmless), 'pass', harmless);
    assert.notEqual(floorOf(loose), 'pass', loose);
  }
});
