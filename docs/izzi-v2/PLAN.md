# izzi 2.0 agent maturity: kế hoạch thực thi

Ngày 2026-11-20. Nhánh epic `feature/izzi-v2-agent-maturity`. Đọc kèm `AGENT-MATURITY-RESEARCH.md` (báo cáo, c2d29ce) và `TRACKER.md` (theo dõi tiến độ).

Ký hiệu: **[kiểm]** = đã đối chiếu file hoặc chạy lệnh hôm nay. **[suy luận]** = chưa kiểm, cần đo.

## 0. Anh đã chốt (20/11)

(1) Dùng thang L0–L6 của báo cáo §2. (2) Chạy thử vòng tự học trên phiên Claude Code của anh trước (D-track), rồi mới đưa vào sản phẩm (P-track). (3) Xong việc anh ưng thì agent chủ động hỏi có nâng cấp cách làm không: **checkpoint nâng cấp** (§2). (4) Giải thích lại V-1 (§1.1). (5) Bỏ trần gọi model cố định, thay bằng cầu chì (§1.2). (6) Mỗi slice = 1 nhánh + 1 worktree + 1 phiên + 1 PR, theo dõi ở `TRACKER.md` (§3.1).

## 1. Trả lời hai câu anh hỏi

Từ viết tắt: **S1–S4** là 4 bước bộ nhớ agent trong app izzi đã làm tháng 11 (S4 = agent đọc hồ sơ đã duyệt). **L0–L6** là thang trưởng thành anh đã chốt (L4 = agent dùng trí nhớ khi làm việc). **D-track** là phần chạy thử trên phiên Claude Code của anh; **P-track** là phần đưa vào app izzi 2.0.

### 1.1 "V-1" là gì (câu 4)

- Trong app izzi, trang **Bộ nhớ** (Memory), mục **Hồ sơ agent**, có 4 thẻ: Director, Designer, Hermes, Socrates. Mỗi thẻ là bản tóm tắt app tự viết từ các lần anh chat trước, đang **chờ anh duyệt**. [theo ghi chép 19–20/11, chưa mở app kiểm lại hôm nay]
- Tính năng "agent đọc hồ sơ khi trả lời" (S4) đã có từ bản beta.117–118, nhưng **chỉ đọc thẻ anh đã bấm "Dùng"**. Chưa thẻ nào được bấm, nên tính năng này chưa từng chạy với dữ liệu thật.
- V-1 nghĩa là: anh mở trang đó, đọc các dòng "Thêm:/Bỏ:" trên từng thẻ, bấm **Dùng** thẻ thấy đúng, **Bỏ** thẻ sai. Sau đó em chat thử với agent đó và so câu trả lời trước/sau. Khoảng 5 phút của anh, không viết code.
- Thẻ Hermes: Hermes không đọc hồ sơ (`AGENT_IDS_NOT_READING_PROFILE` = hermes và content agent [kiểm]), nên bấm Dùng thẻ này hiện không đổi gì. Ưu tiên Designer và Socrates (đọc trong chat), rồi Director (chỉ nhận dưới dạng gợi ý).
- Đã chọn dev trước thì còn cần không? **Có, nhưng không chặn D-track.** Đây là cách duy nhất biết L4 trong sản phẩm chạy đúng (không lộ dữ liệu khách, không làm hỏng câu trả lời) trước khi xây tiếp P-track. Small Release Loop trong CLAUDE.md cũng bắt chạy thử bản đã phát hành rồi mới xây tiếp. Anh làm lúc rảnh; D-track chạy song song.

### 1.2 Ngân sách gọi model (câu 5)

**Vì sao từng có luật "1 lần/ngày".** Agent đề xuất trong thiết kế S2, anh duyệt ngày 19/11 ("Duyệt theo đề xuất"). Đây không phải giới hạn kỹ thuật hay của nhà cung cấp. Ba lý do lúc đó: (1) mỗi lần gọi model trong app tiêu **credit của chủ shop**, nên việc chạy nền cần chi phí đoán trước được; (2) lỗi hết credit 402 đã xảy ra thật, model dự phòng `gpt-4o-mini` từng gặp 402; (3) hồ sơ agent không cần làm mới hơn một lần mỗi ngày. Code hiện thật ra cho nút "Cập nhật hồ sơ ngay" **3 lượt và 6 lần gọi mỗi ngày** (`agent-profile-store.ts`, `AGENT_PROFILES_MAX_RUNS_PER_DAY = 3`, `AGENT_PROFILES_MAX_CALLS_PER_DAY = 6`) [kiểm]; "1 lần/ngày" là mục tiêu cho job tự chạy S3, chưa có code.

**Một giới hạn khác, không liên quan model:** việc ghi MyGraph. Bản thân lần ghi rất nhỏ. Cái tốn là mỗi lần ghi làm ETag mất hiệu lực, nên mọi máy phải tải lại toàn bộ danh sách node (khoảng 0,37 MB JSON). Tổ chức Supabase Free đang vượt quota: ân hạn hết 24/11, sau đó database *có thể* trả 402; theo ghi chép, hạn chế được gỡ ngày 26/11.

**Đề xuất: bỏ trần cố định, chuyển sang "có việc mới gọi" kèm cầu chì.**
1. Chỉ gọi khi có việc thật: hoạt động mới, ứng viên cần phản biện, hoặc anh bấm "Tra cứu thêm". Không có việc thì 0 lần gọi. Cùng một đầu vào không trả tiền hai lần (giữ luật S2).
2. Cầu chì: gặp 402 thì dừng ngay, không thử model dự phòng, báo anh · mỗi lần gọi hết hạn sau 90 giây, mỗi lúc một lượt (như S2) · mỗi ứng viên tối đa 1 lần phản biện + 1 lần viết lại; R1 ≤2 nguồn, R2 ≤1 lần chạy sâu · **bộ phát hiện vòng lặp** thay cho trần theo giờ: cùng một fingerprint đầu vào bị gọi lại, hoặc N lần gọi liền nhau mà không có hoạt động mới, thì tạm dừng và báo. Bộ này chỉ áp cho lần gọi nền, không bao giờ chặn lần gọi do anh bấm, và có nút "Tiếp tục" · trần chi tiêu theo tháng: **tắt** (anh chốt 21/11: hiện chỉ anh dùng). Khi có khách hàng khác dùng thì xét lại.
3. **Giữ riêng** luật ghi MyGraph: chỉ ghi khi fingerprint nội dung đổi, tối đa 1 lần/ngày/tài khoản. Điều kiện kết thúc: khi quota Supabase hết bị hạn chế, hoặc khi đồng bộ không còn tải lại toàn bộ danh sách mỗi lần ETag đổi.

Vì sao an toàn: giá niêm yết `gpt-6-luna` là $0,10 vào / $0,50 ra cho 1 triệu token (`MYGRAPH-AGENT-MEMORY.md` §4). 100 lần gọi/ngày, mỗi lần 20 nghìn token vào và 2 nghìn ra, tốn khoảng $0,30/ngày [suy luận: giá niêm yết, chưa phải giá credit izzi; model phản biện khác họ có giá khác]. Rủi ro thật là vòng lặp và 402, không phải giá mỗi lần gọi; cầu chì nhắm đúng hai rủi ro đó. Đổi code sản phẩm là slice **PB** (§3.3); phát hành cần anh OK như mọi bản desktop.

**Phía dev, "ngân sách" không phải credit sản phẩm** mà là: sự chú ý của anh (hỏi nhiều quá thì anh mỏi); token và ngữ cảnh của gói Claude (mỗi lần gọi socrates tốn khoảng 16–26 nghìn token chỉ để khởi động, theo routing card); và thời gian chờ. Cầu chì phía dev: tối đa 1 câu hỏi mỗi việc; socrates chỉ chạy sau khi anh chọn "Nâng cấp"; R2 chỉ cho quy trình hoặc cổng chất lượng.

## 2. Checkpoint nâng cấp trong phiên dev

Khi xong một việc anh ưng, agent hỏi **một** câu: "có muốn biến bài học của việc này thành chuẩn làm việc không?" Câu hỏi phải kèm bằng chứng; không có bằng chứng thì không hỏi.

### 2.1 Khi nào được hỏi

| Tín hiệu trong câu anh gõ | Ví dụ | Xử lý |
|---|---|---|
| Quyết định ngắn (≤60 ký tự) | phát hành, merge, đồng ý, duyệt theo, sửa ở đây | **Mốc hoàn tất**: có thể hỏi |
| Khen rõ (≤80 ký tự) | được rồi, ổn rồi, đẹp rồi, tuyệt | **Mốc hoàn tất**: có thể hỏi |
| Điều khiển luồng | tiếp tục, làm tiếp, ok | Không bao giờ hỏi |
| Cam chịu | thôi được rồi, cũng được, tạm được | **Không bao giờ** tính là duyệt; ghi là "chưa rõ hoặc tiêu cực" |
| Sửa, từ chối, chưa hiểu | làm lại, không phải, chưa được, đừng…, chưa hiểu… nói rõ hơn | Không hỏi; ghi làm **bằng chứng** cho lần hỏi sau |
| Câu hỏi, phủ định | "merge chưa?", "đừng phát hành", "chưa đồng ý" | Không tính là duyệt |

"Sửa ở đây" thực chất là chọn cách sửa, có thể chưa phải lúc xong việc; vẫn giữ vì anh nêu, D0 đo lại. Trường hợp agent tự xong quy trình (PR đã merge, phát hành xong) mà anh không gõ câu quyết định nào: D1 chưa bắt; D2 đo tần suất, nhiều thì thêm Stop hook (§2.7).

### 2.2 Khi nào không hỏi

- **Không hỏi giữa việc.** Câu hỏi chỉ đặt cuối câu trả lời, sau khi việc anh giao đã xong. Việc còn kéo sang lượt sau (chờ CI, chờ build) thì để tới báo cáo cuối.
- **Mỗi việc tối đa 1 lần.** Chỉ hỏi lại khi có bằng chứng mới (một lần sửa mới sau lần hỏi trước) và cách lần trước ≥3 câu lệnh. Mỗi phiên tối đa 3 lần.
- **Không có ứng viên có bằng chứng thì im lặng.** Bằng chứng mạnh = cặp đối chứng trong phiên: anh sửa hoặc từ chối, rồi sau đó duyệt. Bằng chứng yếu = không có lần sửa, nhưng agent đã dùng một cách làm mới và kết quả đã kiểm chứng; tối đa 1 lần mỗi phiên. Câu khen đơn lẻ không bao giờ đủ (báo cáo §3.3).
- **Chống mỏi:** trong 10 lần hỏi gần nhất, nếu "Bỏ qua" cộng "không trả lời" ≥6, tự chuyển sang chế độ chặt (chỉ cặp đối chứng, ≤1 lần/phiên) và báo root.
- **Tắt nhanh:** biến môi trường `AGENT_MATURITY=off`, hoặc `"enabled": false` trong `~/.claude/agent-maturity/config.json`.

### 2.3 Câu hỏi trông thế nào

Mỗi lần một ứng viên, đặt cuối câu trả lời, theo đúng khung:

    [Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?
    - Đề xuất: <một câu chuẩn, ≤200 ký tự>
    - Áp dụng cho: <vai trò/agent> · <loại việc> · <dự án này | mọi dự án>
    - Cách kiểm: <điều kiện kiểm được trước khi giao>
    - Bằng chứng: <lúc trước anh sửa/từ chối gì, ≤15 từ> → <sau đó anh duyệt gì>
    - Loại: sở thích | quy trình | cổng chất lượng · Tra cứu: R0 | R1 | R2
    Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua

Ví dụ từ chính phiên hôm nay (chỉ minh hoạ, chưa ghi vào kho, chỉ đúng nếu anh duyệt bản giải thích ở §1):

    - Đề xuất: Khi xin anh quyết định, nói bằng lời thường: việc gì, anh bấm/chọn ở đâu, chọn A hay B thì hệ quả gì, em đề xuất gì.
    - Áp dụng cho: orchestrator/root · câu hỏi xin quyết định · mọi dự án
    - Cách kiểm: mỗi câu hỏi có đủ 4 ý; không dùng mã nội bộ (V-1, S4) mà không giải thích.
    - Bằng chứng: anh nói "chưa hiểu… nói rõ hơn" (V-1) và "ko hiểu lắm" (ngân sách) → anh duyệt bản giải thích lại
    - Loại: quy trình · Tra cứu: R0

Dòng đầu `[Checkpoint nâng cấp]` là dấu cố định: hook dựa vào nó để đếm số lần hỏi và trả lời.

### 2.4 Sau khi anh trả lời

- **Bỏ qua:** không ghi gì vào kho; hook ghi một dòng số đo.
- **Chỉnh:** câu anh sửa thay câu đề xuất, rồi đi tiếp như "Nâng cấp".
- **Nâng cấp:**
  1. Root ghi **ứng viên** vào kho chuẩn (§2.5). Nguồn là tin nhắn của anh (session id + thời điểm), không chép nguyên văn hội thoại. Subagent không ghi kho, chỉ trả đề xuất cho root.
  2. Socrates phản biện một lần, dựa trên bằng chứng và các chuẩn đang có cùng chủ đề, ra ACCEPT / NARROW / NEED-MORE / REJECT. Socrates kiểm: bằng chứng có đỡ câu chuẩn không; phạm vi có quá rộng không; có mâu thuẫn chuẩn cũ không; tầng research đúng chưa.
  3. Research theo tầng: R0 (sở thích) không tra; R1 (nội dung, quảng cáo, tuyên bố) 1–2 nguồn; R2 (quy trình đổi cách làm việc, hoặc chạm luật/bảo mật) tra sâu rồi socrates xem lại. Tối đa 1 lần phản biện + 1 lần viết lại.
  4. ACCEPT và câu không đổi: root **promote** (anh đã duyệt đúng câu đó). NARROW hoặc câu bị đổi: cho anh xem phần khác, anh OK mới promote. NEED-MORE: giữ ứng viên, hẹn ngày xem lại. REJECT: giữ ứng viên, nói lý do; anh vẫn có thể ép duyệt.
  5. Chuẩn mới mâu thuẫn chuẩn cũ: ghi chuẩn mới rồi `supersede` chuẩn cũ (giữ lịch sử, không xoá). Anh muốn bỏ một chuẩn: `retract` kèm lý do.
  6. Sau mỗi promote/supersede/retract: xuất lại danh sách chuẩn đang dùng để phiên sau đọc được (D3).

### 2.5 Một kho chuẩn duy nhất: Codex KnowledgeMemory

Nơi ghi duy nhất cho chuẩn phía dev: `F:/Ai Tools/Codex/KnowledgeMemory/memory.sqlite3`, qua CLI `~/.codex/bin/project-memory.py`. Lý do:
- Kho đã có đúng vòng đời báo cáo cần: candidate → promote → supersede/retract, ID bất biến, nguồn, lịch sử sự kiện, phạm vi project/role/user (`~/.codex/skills/project-memory/references/storage.md`). Báo cáo §5.2 cũng chọn vòng đời này.
- Kho đang chạy thật: 193 ghi nhớ (báo cáo §1), 40 dự án đã đăng ký [kiểm]. Starizzi gốc có id `2a906db6-a103-5375-b672-ad090f686c7e` [kiểm].
- CLI chạy bằng Python đi kèm Codex (`~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`) [kiểm `--help`]. Trên Windows phải đặt `PYTHONIOENCODING=utf-8`; thiếu biến này lệnh `projects` lỗi `UnicodeEncodeError` [kiểm]. Hook không bao giờ gọi CLI; chỉ root gọi, sau khi anh trả lời.

Quan hệ với các kho khác:
- **Claude auto-memory** (`~/.claude/projects/<thư mục dự án>/memory/`) giữ việc đang giữ: trạng thái phát hành, sự cố, bẫy kỹ thuật. **Không ghi chuẩn vào đây**, để không có hai nguồn sự thật. Thêm nữa, mỗi worktree có thư mục dự án riêng và không có `memory/` [kiểm 2 worktree], nên phiên trong worktree slice nhiều khả năng không thấy MEMORY.md chính [suy luận]. Ghi chú cũ mang tính chuẩn (ví dụ "kiểm sha backend đang chạy trước khi deploy") được đưa vào kho làm ứng viên ở D3; anh duyệt từng cái.
- **Phiên Claude đọc chuẩn** qua SessionStart hook (D3): đọc bản xuất `~/.claude/agent-maturity/standards.json`, chọn chuẩn đang dùng của phạm vi user và của dự án hiện tại (worktree quy về dự án gốc), chèn ≤1200 ký tự.
- **Phiên Codex** đọc thẳng bằng `recall` như hiện nay.
- **Phạm vi (anh chốt 21/11: áp cho mọi dự án):** chuẩn mặc định ghi ở phạm vi **user**, để mọi dự án anh đang làm đều được nâng cấp liên tục, kể cả chuẩn quy trình kỹ thuật. Chỉ ghi phạm vi project khi chuẩn rõ ràng gắn với một codebase (nhắc file, lệnh hay hạ tầng riêng của dự án đó); khi đó ghi cho dự án gốc, không ghi cho worktree, vì kho coi mỗi worktree là một dự án khác. Hook đã cài ở cấp user nên chạy ở mọi dự án.

### 2.6 Đo

| Số đo | Định nghĩa | Slice |
|---|---|---|
| Lỗi bị nhắc lại | Số lần sửa/từ chối trên 100 việc mà checker xác định trùng phạm vi và nội dung với một chuẩn đã có từ trước (đang dùng hoặc ứng viên); định nghĩa ở báo cáo §2. Checker phải được chấm trên ≥30 cặp có nhãn trước khi dùng số | D5 |
| Duyệt ngay lần đầu | Tỉ lệ việc đạt mốc hoàn tất mà không có lần sửa nào. Một "việc" = các câu lệnh từ sau mốc hoàn tất trước (hoặc đầu phiên) tới mốc này | D1 ghi, D5 tính |
| Tỉ lệ checkpoint | Trong các lần hook nhắc: agent hỏi / tự bỏ qua. Trong các lần hỏi: Nâng cấp / Chỉnh / Bỏ qua / không trả lời | D1 |
| Sức khoẻ hook | Thời gian chạy (mục tiêu ngang hook `@agent` hiện có, khoảng 130 ms theo ghi chép 10/11), số lỗi đã nuốt | D1 |

Baseline lấy từ lịch sử ở D0; so sánh sau 14 ngày chạy thật ở D6.

### 2.7 Phần nào là hook, phần nào là skill

| Mảnh | Loại | Slice |
|---|---|---|
| Phân loại câu anh gõ, giữ trạng thái phiên, nhắc agent đúng lúc, ghi kết quả checkpoint | Hook `UserPromptSubmit` (node) | D1 |
| Khung câu hỏi và quy trình sau khi anh trả lời | Skill `upgrade-checkpoint` | D1 |
| Ghi, promote, supersede chuẩn | CLI KnowledgeMemory, chỉ root gọi | D3 |
| Chèn chuẩn đang dùng vào đầu phiên | Hook `SessionStart` (node) | D3 |
| Bắt "agent xong quy trình mà anh không gõ gì" | Hook `Stop`, chỉ khi D2 cho thấy cần; phải tôn trọng `stop_hook_active` để không lặp | sau D2 |

Luật chung cho mọi hook: chỉ node (máy không có Python trên PATH); không gọi mạng; **fail-open** (lỗi gì cũng thoát 0 và không in gì; không bao giờ thoát 2, vì mã 2 chặn câu lệnh của anh); timeout 5 giây.

## 3. Kế hoạch slice

### 3.1 Luật nhánh và phiên (quyết định 6)

- Mỗi slice có: 1 nhánh `izzi-v2/<id>-<slug>` tách từ `feature/izzi-v2-agent-maturity`; 1 worktree `F:/Ai Tools/_wt-izzi-v2-<id>`; 1 phiên Claude Code mở trong worktree đó, câu lệnh đầu bắt đầu bằng `[<id>]`; 1 PR vào nhánh epic.
- Mỗi worktree có thư mục riêng trong `~/.claude/projects/` [kiểm trên các worktree cũ], nên transcript từng phiên nằm riêng và anh tìm lại được theo slice. Session id = tên file `.jsonl` trong thư mục đó.
- Không đụng checkout chính (đang có việc dở của phiên khác).
- Phiên slice **không sửa `TRACKER.md`**, để tránh xung đột giữa các nhánh. Phiên ghi bằng chứng vào mô tả PR; root chép sang TRACKER trên nhánh epic, và chỉ đánh "xong" sau khi tự chạy lại kiểm tra và có review độc lập.
- Mỗi tuần merge `main` vào nhánh epic. Chỉ lên `main` hoặc phát hành khi đạt cổng và anh OK.
- Worktree slice không có chỉ mục GitNexus; cần impact thì chạy trên checkout đã index, không được thì ghi rõ trong PR.

### 3.2 D-track (dev pilot, làm trước)

| Slice | Nhánh | Mục tiêu | Xong khi (đo được) | Kiểm bằng | Làm / kiểm | Phụ thuộc |
|---|---|---|---|---|---|---|
| D0 | `izzi-v2/d0-gold-set` | Tập vàng và baseline từ câu lệnh dev của anh | ≥200 câu có nhãn (8 nhãn của §4.2, trừ `abstain`), chia đôi dev/test theo hash; anh xem lại mọi câu nhãn duyệt, khen, cam chịu hoặc không chắc (khoảng 30–50 câu); có baseline số lần sửa/100 câu và tỉ lệ duyệt ngay lần đầu | `node tools/agent-maturity/eval/eval-gold.mjs <file nhãn>` in ma trận nhầm lẫn | root gắn nhãn, anh xem lại / socrates | — |
| D1 | `izzi-v2/d1-checkpoint-hook` | Bộ phân loại, hook nhắc, skill checkpoint, cài/gỡ; chưa cài thật | §4.8 | `pnpm run test:agent-maturity` | builder / reviewer + socrates | — |
| D2 | `izzi-v2/d2-live-install` | Cài vào `~/.claude/settings.json` thật, chạy 7 ngày | Cổng D0 trên tập test: precision mốc hoàn tất ≥0,9; cam chịu bị tính là duyệt = 0; phủ định hoặc câu hỏi bị tính là duyệt = 0. Smoke `claude -p` trong thư mục tạm thấy dòng log; 0 câu lệnh bị chặn; gỡ rồi cài lại sạch | eval D0; smoke (chuyển transcript test ra khỏi `~/.claude/projects` cho khỏi lệch routing card); `uninstall --dry-run` | root + verifier | D0, D1 |
| D3 | `izzi-v2/d3-standards-store` | Wrapper node ghi ứng viên vào KnowledgeMemory; xuất chuẩn đang dùng; SessionStart chèn chuẩn; nhập ghi chú auto-memory mang tính chuẩn làm ứng viên | Vòng capture → promote → export → supersede → export chạy trên kho tạm (`--store`); khối chèn ≤1200 ký tự; worktree quy đúng về dự án gốc; kho thật không đổi trong test (so sha) | `node --test` của D3 | builder / reviewer | D1 |
| D4 | `izzi-v2/d4-critic-research` | Hợp đồng phản biện socrates, tầng R0/R1/R2, chống vòng lặp | Validator verdict có test; 3 lần chạy thử trên bằng chứng có ghi (ví dụ câu 4–5 hôm nay) đều có verdict lưu kèm ứng viên; lần phản biện thứ 3 cho cùng ứng viên bị chặn | `node --test` của D4 + log chạy thử | builder / socrates | D3 |
| D5 | `izzi-v2/d5-metrics` | Báo cáo số đo, checker lỗi bị nhắc lại, báo động mỏi | Báo cáo chạy trên ≥7 ngày log; checker precision ≥0,8 trên ≥30 cặp có nhãn [ngưỡng đề xuất]; báo động mỏi có test; checker đọc transcript tại chỗ, không lưu chữ | `node tools/agent-maturity/report.mjs --since <ngày>` | builder / reviewer | D0, D2 |
| D6 | `izzi-v2/d6-pilot-review` | Đánh giá 14 ngày, quyết định mang gì sang sản phẩm | Bản ghi quyết định có số trước/sau so với baseline D0; socrates đã review; anh duyệt | đọc báo cáo D5 | root / socrates | D5 |

**D0 có phải làm trước D1 không?** Không cần trước khi *xây* D1, nhưng bắt buộc xong trước khi *cài thật* (D2). D1 chỉ quyết định lúc nào *hỏi*, không tạo luật; sai thì tốn một câu hỏi hoặc bỏ lỡ một lần hỏi. Hôm nay builder viết D1 từ ca mẫu tổng hợp; root làm D0 song song (khoảng 2–3 giờ của root, 10–15 phút của anh). Tập vàng chứa câu lệnh thật của anh, nên để ở `F:/Ai Tools/Codex/Temp/agent-maturity-gold/` (ngoài repo), che khoá và số điện thoại trước; repo chỉ nhận script eval và con số tổng. Root gắn nhãn rồi anh xem lại câu dễ sai là một thoả hiệp (nhãn không hoàn toàn độc lập với bên viết luật); kết quả ghi rõ điều này.

### 3.3 P-track (sản phẩm, sau D-track; ánh xạ V-1…V6 của báo cáo)

| Slice | Nhánh | Mục tiêu | Xong khi | Kiểm bằng | Làm / kiểm | Phụ thuộc |
|---|---|---|---|---|---|---|
| P-1 | — (không code) | V-1 (§1.1) | ≥1 hồ sơ đang dùng; ghi lại 3 lượt chat trước/sau; 0 lộ dữ liệu cá nhân; 0 câu trả lời hỏng | root kiểm trên app thật | anh + root | — |
| P0 | `izzi-v2/p0-product-gold` | V0: đếm sự kiện sản phẩm thật, tập vàng, baseline | Đã đếm đủ 5 loại sự kiện; phân loại "mạnh" có precision ≥0,9 trên tập giữ riêng; cam chịu bị tính là duyệt = 0 | script eval cục bộ | explorer + root / socrates | P-1, D0 |
| PB | `izzi-v2/pb-budget-fuses` | §1.2: bỏ trần 3 lượt/6 lần gọi, thay bằng gọi theo việc + cầu chì | Có test cho từng điều: 402 thì dừng, không gọi dự phòng; 90 giây; một lượt mỗi lúc; không có hoạt động mới thì 0 lần gọi; vòng lặp (cùng fingerprint, hoặc N lần liền không có hoạt động mới) thì dừng, nhưng lần anh bấm không bao giờ bị chặn; trần tháng (nếu bật) chặn khi chạm trần | `pnpm -C apps/desktop exec vitest run src/main/agents/memory` | builder / reviewer | — (anh đã giao agent chọn; chỉ cần OK khi phát hành) |
| P2 | `izzi-v2/p2-itemized-store` | V2: kho mục có ID + delta, tách khối chèn top-k, diff từng mục | Qua 10 lần chạy không mất mục nào; khối chèn ≤1000 ký tự; mục bị loại có ghi lý do | vitest như trên | builder / reviewer + socrates | P-1 |
| P1 | `izzi-v2/p1-feedback-ledger` | V1: sổ sự kiện phản hồi trên máy, ô lý do khi từ chối, dùng lại luồng review của Marketing Resources nếu hợp | Đủ 5 loại sự kiện, mỗi sự kiện có vai trò người duyệt; lọc PII 100% trên tập test | vitest + kiểm UI | builder + designer / reviewer | P0 |
| P3 | `izzi-v2/p3-candidates-critic` | V3: ứng viên từ cặp đối chứng, bộ đếm, phản biện, tầng research | Mọi ứng viên có ≥1 cặp đối chứng và có verdict | vitest | builder / socrates | P1, P2, PB, D6 |
| P4 | `izzi-v2/p4-apply-checker` | V4: áp dụng chuẩn + checker tuân thủ (mở rộng Brand Guardian, chỉ cảnh báo) | Đo được tỉ lệ vi phạm | vitest | builder / reviewer | P3 |
| P5 | `izzi-v2/p5-nightly-job` | V5 (= S3): job ban đêm, đánh dấu cũ/thay thế, snapshot, chiếu sang MyGraph | Lỗi bị nhắc lại giảm so với baseline P0 | số đo 30 ngày | builder + maintainer / socrates | P4, quota Supabase ổn |
| P6 | `izzi-v2/p6-auto-low-risk` | V6: tự áp dụng sở thích rủi ro thấp sau ≥3 lần xác nhận | Tỉ lệ duyệt lần đầu tăng và giữ ≥2 tháng | số đo 2 tháng | builder / socrates | P5 |

Thứ tự: hôm nay D0 và D1 song song → D2 → D3 → D4 → D5 → D6 (khoảng 14 ngày sau D2). P-1 lúc nào anh rảnh; sau P-1 thì P0 và P2 song song; PB làm được ngay (chỉ cần anh OK khi phát hành); P3 trở đi sau D6.

## 4. Spec D1 cho builder

Nhánh `izzi-v2/d1-checkpoint-hook` tách từ `feature/izzi-v2-agent-maturity`; worktree `F:/Ai Tools/_wt-izzi-v2-d1`. Chỉ thêm file mới dưới `tools/agent-maturity/` và một dòng script trong `package.json` gốc. Không đổi code sản phẩm; không cài vào `~/.claude` thật (root làm ở D2); không mạng, không Python, không thêm dependency.

### 4.1 Danh sách file

    tools/agent-maturity/
      README.md                  ≤40 dòng: làm gì, cài, gỡ, tắt
      lib/classify.mjs           chuẩn hoá + classifyPrompt (thuần)
      lib/decide.mjs             decide(state, global, cls, info) → { state, global, context, events } (thuần)
      lib/store.mjs              đường dẫn, đọc/ghi state nguyên tử, ghi log, dọn file cũ
      lib/transcript-tail.mjs    lastAssistantText(file, maxBytes = 256 KB)
      hooks/prompt-signal.mjs    điểm vào UserPromptSubmit
      skill/upgrade-checkpoint/SKILL.md
      install.mjs, uninstall.mjs
      test/*.test.mjs, test/fixtures/

`package.json`: `"test:agent-maturity": "node --test <liệt kê từng file test>"`, giống `test:socrates`. Không dùng glob, vì `engines` cho Node ≥20 và script chạy qua cmd trên Windows.

### 4.2 Bộ phân loại `classifyPrompt(text) → { label, ruleId }`

Nhãn: `approve_decision`, `praise`, `confirm`, `flow`, `resignation`, `correction`, `clarify`, `none`, `abstain`. Hàm không trả về nội dung câu.

Chuẩn hoá: NFC, `toLocaleLowerCase('vi')`, gom khoảng trắng, bỏ `.!…` ở cuối (giữ `?`). Câu có ít nhất một dấu tiếng Việt thì chỉ khớp mẫu có dấu; câu không dấu thì khớp mẫu không dấu (NFD bỏ dấu, `đ→d`). Bỏ hẳn các mẫu không dấu dễ trùng nghĩa: `dung` (đừng/dùng/đúng/dừng), `dung roi`.

Thứ tự xét, khớp cái nào trước thì lấy cái đó:
1. `abstain`: câu rỗng; bắt đầu bằng `<`, `/` hoặc `[Request interrupted`; có code fence; dài hơn 400 ký tự.
2. `resignation` (câu ≤120 ký tự): thôi được rồi, thôi được, thôi kệ, thôi bỏ, cũng được, tạm được, tạm ổn, được thôi, kệ đi. **Luôn thắng mọi nhãn duyệt và khen.**
3. `correction`, `ruleId: negated-approval`: từ phủ định (đừng, chưa, không, ko, khoan) đứng trong vòng 2 từ trước một động từ duyệt hoặc từ khen ("chưa merge", "không ưng").
4. `abstain` (câu hỏi): có động từ duyệt và câu kết thúc bằng `?` hoặc trợ từ hỏi (không, ko, chưa, hả, à, nhỉ, sao, chứ).
5. `correction` (câu ≤300 ký tự): không phải, sai rồi, chưa đúng, không đúng, ko đúng, làm lại, sửa lại, chưa được, vẫn chưa, vẫn lỗi, vẫn sai, đừng.
6. `clarify` (câu ≤300 ký tự): chưa hiểu, không hiểu, ko hiểu, nói rõ hơn, giải thích lại.
7. `approve_decision` (câu ≤60 ký tự): phát hành, merge, đồng ý, duyệt theo, duyệt đi, sửa ở đây, chốt. Loại trừ `trình duyệt`, `merge conflict`.
8. `praise` (câu ≤80 ký tự): được rồi, ổn rồi, tốt rồi, chuẩn rồi, đẹp rồi, hay rồi, ok rồi, tuyệt, perfect, ưng.
9. `confirm`: đúng rồi, đúng vậy (xác nhận, không phải mốc hoàn tất).
10. `flow` (câu ≤25 ký tự): tiếp tục, làm tiếp, tiếp đi, ok, oke, okay, continue, go.
11. Câu dài hơn 60 ký tự có động từ duyệt mà chưa vào nhãn nào ở trên: `abstain`. Còn lại: `none`.

Khớp theo ranh giới từ. `ruleId` có dạng `<nhãn>:<mẫu-không-dấu>` để D0 đo từng mẫu. Các mẫu `duyệt đi`, `chốt`, `ưng`, `tạm ổn`, `được thôi`, `kệ đi` là suy luận, không có trong số đếm báo cáo §3.1; D0 sẽ đo.

### 4.3 Quyết định nhắc `decide(...)` (hàm thuần, test không cần đĩa)

State mỗi phiên: `{ v, turn, correctionsSinceCheckpoint, nudges, weakNudges, lastNudgeTurn, pending }`. State chung: `{ recentOutcomes (≤10), strict }`. Mỗi câu lệnh, `turn += 1`, rồi xét lần lượt:
1. **Có `pending`** (lượt trước đã nhắc): nếu câu trả lời cuối của agent có `[Checkpoint nâng cấp]` thì phân loại câu này là `accept` (bắt đầu bằng nâng cấp / có / đồng ý / 1), `edit` (chỉnh / 2), `skip` (bỏ qua / không / ko / thôi / skip / 3), còn lại `ignored`; không có dấu đó thì ghi `abstained`. Xoá `pending`, đẩy kết quả vào `recentOutcomes`. Nếu agent đã hỏi thì câu này không được xét là mốc hoàn tất.
2. **`correction` hoặc `clarify`:** `correctionsSinceCheckpoint += 1`.
3. **`approve_decision` hoặc `praise`:** chỉ nhắc khi hook đang bật, có session id, `nudges < 3` (chế độ chặt: `< 1`), và `lastNudgeTurn` trống hoặc đã cách ≥3 lượt. Khi đó: `correctionsSinceCheckpoint > 0` thì nhắc **mạnh** và đặt bộ đếm về 0; ngược lại, nếu không ở chế độ chặt và `weakNudges = 0`, thì nhắc **yếu**. Mỗi lần nhắc: đặt `pending`, cập nhật `lastNudgeTurn`, tăng bộ đếm.
4. `recentOutcomes` đủ 10 mục và `skip + ignored ≥ 6` thì `strict = true`.
5. Không có session id: chỉ ghi log, không nhắc.

Nội dung nhắc bằng tiếng Anh cho model, tối đa 700 ký tự, không chép câu của anh. Nhắc mạnh: "The owner just gave a completion signal. This task had N correction/rejection signal(s) before it. First finish exactly what was asked. Then, only if those corrections teach one concrete standard you can state with scope and a check, end your reply with an upgrade checkpoint using the `upgrade-checkpoint` skill (header `[Checkpoint nâng cấp]`). If you cannot, do not ask and do not mention this note. If the work continues in a later turn, ask in that work's final report instead." Nhắc yếu: như trên, điều kiện đổi thành "you used a method not already in the active standards and its result was verified in this task".

### 4.4 Hook `prompt-signal.mjs`

- **Vào/ra:** stdin là JSON (`prompt`, `session_id`, `transcript_path`, `cwd`). Đầu ra rỗng, hoặc `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`, cùng khung với `~/.claude/agent-routing/agent-mention.js` [kiểm].
- **Fail-open:** mọi lỗi (JSON hỏng, đĩa đầy, không ghi được, transcript lạ) đều thoát 0 với stdout rỗng. Không bao giờ thoát 2, không in ra stderr; có `process.on('uncaughtException')` thoát 0.
- **Transcript:** chỉ đọc khi có `pending`, chỉ 256 KB cuối, bỏ dòng đầu bị cắt.
- **Nơi lưu** (gốc `AGENT_MATURITY_HOME`, mặc định `~/.claude/agent-maturity/`): `state/<session>.json` (tên phiên chỉ giữ `[A-Za-z0-9-]`, khác thì băm sha256), `global.json`, `<gốc>/log/events-YYYY-MM.jsonl`, `config.json`. Mọi lần ghi đều nguyên tử (file tạm + rename).
- **Tắt:** `AGENT_MATURITY=off` hoặc `config.enabled === false` thì thoát 0 ngay, không ghi gì.
- **Riêng tư:** không lưu nội dung câu lệnh hay câu trả lời ở đâu cả. Log chỉ có thời điểm, session id, lượt, nhãn, ruleId, nhóm độ dài (≤40 / ≤60 / ≤200 / >200), loại sự kiện (`prompt` / `nudge` / `checkpoint_outcome` / `error`), kết quả, thời gian chạy; lỗi chỉ ghi tên lớp lỗi. Dọn state >30 ngày và log >180 ngày, tối đa 1 lần/ngày.
- **Import:** runtime chỉ dùng `node:fs`, `node:path`, `node:os`, `node:crypto`.

### 4.5 Skill `upgrade-checkpoint`

`SKILL.md` ≤120 dòng, frontmatter `name: upgrade-checkpoint`; mô tả: dùng khi hook nhắc checkpoint, hoặc khi anh hỏi nâng cấp cách làm hay tư duy của agent. Nội dung: khung §2.3; luật §2.2 (một ứng viên, không hỏi giữa việc, không có bằng chứng thì im, khen đơn lẻ và cam chịu không phải bằng chứng); luồng §2.4. Bước ghi kho viết thành lệnh CLI cho root theo `~/.codex/skills/project-memory/references/storage.md`, kèm `PYTHONIOENCODING=utf-8` và đường dẫn Python đi kèm Codex; subagent chỉ trả đề xuất. Không chứa khoá, đường dẫn bí mật hay dữ liệu khách.

### 4.6 Cài và gỡ (root chạy ở D2; builder chỉ test trên thư mục tạm)

`node tools/agent-maturity/install.mjs [--claude-home <dir>] [--settings <file>] [--dry-run]` (mặc định `~/.claude`):
1. Đọc và parse settings; JSON hỏng thì thoát 1, không ghi gì.
2. Sao lưu nguyên byte sang `settings.json.bak-<YYYYMMDD-HHmmss>-agent-maturity`.
3. Chép `lib/` và `hooks/` vào `<claude-home>/agent-maturity/bin/` (hook trỏ vào bản chép, không trỏ vào worktree, vì worktree có thể bị xoá). Chép skill vào `<claude-home>/skills/upgrade-checkpoint/` kèm file dấu `.agent-maturity`; thư mục skill đã có mà thiếu file dấu thì dừng, không ghi đè.
4. Thêm vào `hooks.UserPromptSubmit` một nhóm `{ hooks: [{ type: "command", command: "node \"<claude-home>/agent-maturity/bin/hooks/prompt-signal.mjs\"", timeout: 5 }] }`, giữ nguyên mọi hook khác. Nhóm đã có thì không thêm: cài lại chỉ cập nhật file, không nhân đôi.
5. Ghi settings nguyên tử; ghi `<claude-home>/agent-maturity/install-manifest.json` gồm đường dẫn backup, sha256 settings sau khi cài, danh sách file đã chép.

`node tools/agent-maturity/uninstall.mjs [--claude-home] [--settings] [--dry-run] [--purge]`: nếu sha256 settings hiện tại bằng sha sau khi cài thì **khôi phục nguyên byte** từ backup; nếu khác (đã có người sửa settings sau đó) thì chỉ gỡ nhóm hook của mình, giữ thay đổi khác, giữ backup và in thông báo. Xoá file có trong manifest; giữ state và log, trừ khi có `--purge`. An toàn khi test: `AGENT_MATURITY_TEST=1` mà đích là `~/.claude` thật thì báo lỗi, không ghi.

### 4.7 Kiểm thử (node:test, không cần mạng)

- **`classify.test.mjs`**, ≥60 ca: ≥12 ca cam chịu có dấu, không dấu, kèm hậu tố ("thôi được rồi, để vậy đi", "cung duoc", "tạm được nhé"); phủ định ("chưa merge", "đừng phát hành", "ko đồng ý", "khoan merge đã", "không ưng"); câu hỏi ("merge chưa?", "phát hành được không"); luồng ("tiếp tục", "tiep tuc", "ok"); câu dài hoặc câu dán có "đừng merge… phát hành" ra `abstain`; `trình duyệt`, `merge conflict` không thành duyệt; `<command-message>`, `/verify`, code fence ra `abstain`. Kiểm tổ hợp: mọi cụm cam chịu × mọi hậu tố không bao giờ ra `approve_decision` hay `praise`. Assert **lỗi nghiêm trọng = 0**.
- **`decide.test.mjs`:** duyệt sau một lần sửa thì nhắc mạnh; duyệt không có lần sửa thì nhắc yếu, đúng 1 lần/phiên; "tiếp tục" sau lần sửa thì không nhắc; hai lần duyệt liền chỉ nhắc lần đầu; lần sửa mới và đã cách ≥3 lượt thì nhắc lại; trần 3/phiên; chế độ chặt; đủ năm kết quả checkpoint (accept, edit, skip, ignored, abstained); câu trả lời checkpoint không bị tính là mốc hoàn tất; không có session id thì không nhắc.
- **`hook.test.mjs`** (spawn tiến trình thật, `AGENT_MATURITY_HOME` tạm): đầu ra JSON đúng khung, context ≤700 ký tự; stdin hỏng thì thoát 0, stdout rỗng; home là một file (không ghi được) thì thoát 0, stdout rỗng; câu 1 MB thì thoát 0; chạy các câu có `sk-test-…` và số điện thoại rồi quét mọi file trong home tạm, không thấy hai chuỗi đó; quét mã nguồn runtime, không có `http`, `https`, `net`, `fetch(`, `child_process`.
- **`transcript-tail.test.mjs`:** lấy đúng câu assistant cuối từ JSONL mẫu nhiều loại dòng; bỏ dòng đầu bị cắt; file không có thì trả `null`.
- **`install.test.mjs`** (thư mục tạm): backup trùng byte bản gốc; hook khác giữ nguyên (deep equal); cài hai lần vẫn một nhóm; cài rồi gỡ ngay thì settings trùng byte bản gốc; gỡ sau khi bên thứ ba sửa settings thì chỉ mất nhóm của mình; `--dry-run` không ghi file nào; JSON hỏng thì thoát 1, không ghi; `AGENT_MATURITY_TEST=1` chặn ghi vào `~/.claude` thật; thư mục skill lạ không bị ghi đè.

### 4.8 D1 xong khi

1. `pnpm run test:agent-maturity` xanh, không test nào bị bỏ qua. Mô tả PR ghi số ca phân loại và số lỗi nghiêm trọng (= 0).
2. Mô tả PR ghi trung vị thời gian chạy hook qua 30 lần đo trên máy (tham chiếu: hook `@agent` khoảng 130 ms). Không assert số này trong test, để tránh chập chờn.
3. `git diff --stat` chỉ có `tools/agent-maturity/**` và một dòng `package.json`. Settings thật và `~/.claude/skills` không đổi (mô tả PR ghi mtime trước/sau).
4. PR vào nhánh epic, mô tả theo mẫu trong `TRACKER.md`. Root dispatch reviewer + socrates, và tự chạy lại test trước khi đánh "xong".

### 4.9 Sửa bắt buộc theo review Socrates (20/11): đè lên §4.1–4.8 khi khác

1. **Lượt không do anh gõ.** `UserPromptSubmit` còn chạy khi scheduled task hoặc `/loop` tới lượt, khi subagent báo về, và khi phiên khác gửi tin. Input không có trường nào cho biết nguồn (docs hooks).
   - Lượt có wrapper (text bắt đầu bằng `<`, hoặc lệnh `/…`) không tăng `turn` và không xử lý `pending`.
   - Chỉ nhắc khi `CLAUDE_CODE_ENTRYPOINT` ∈ {`cli`, `claude-desktop`}. Các trường hợp khác (`claude -p`, SDK) chỉ ghi log.
   - Mỗi điều có test.
2. **Đếm mọi lần hỏi.**
   - Ở mỗi lượt anh gõ, đọc phần cuối transcript (`transcript_path`, tối đa 256 KB tính từ cuối file) để tìm dấu `[Checkpoint nâng cấp]` trong câu assistant gần nhất. Lần agent tự hỏi cũng tính vào trần 3 lần/phiên.
   - `pending` sống tối đa 5 lượt của anh.
   - Chỉ nhận Nâng cấp / Chỉnh / Bỏ qua khi câu trả lời ≤40 ký tự hoặc mở đầu đúng từ lựa chọn. Câu kiểu "có lỗi rồi" không được tính là đồng ý.
   - Đọc transcript lỗi thì bỏ qua, fail-open.
3. **Đặt lại bằng chứng ở mỗi mốc.**
   - `correctionsSinceCheckpoint` về 0 ở **mọi** mốc hoàn tất, kể cả khi không nhắc. Mỗi mốc ghi 1 sự kiện log kèm số lần sửa.
   - Mẫu "đừng" đứng một mình bị thu hẹp. Chỉ tính "sửa" khi câu ngắn (≤120 ký tự) và có dấu hiệu phản hồi ("đừng … nữa", "đừng làm vậy", "sao lại", "không phải", "sai", "làm lại", "chưa được", "vẫn chưa").
   - Báo precision và recall của nhãn `correction` trong cổng D2.
4. **"Hoàn tất quy trình" (quyết định 3).** Skill cho phép hỏi 1 lần khi agent tự xong một quy trình anh đã giao (merge / phát hành / deploy đã kiểm chứng) và có ứng viên được một lần sửa trước đó hậu thuẫn. Lần hỏi này vẫn tính trần nhờ mục 2.
5. **Cài và gỡ an toàn.**
   - Ngay trước khi rename, đọc lại `settings.json` và so sha256. Đã đổi thì dừng và báo: Claude Code UI và việc bật/tắt plugin cũng ghi vào file này, và file watcher nạp lại hook ngay ở mọi phiên đang chạy.
   - File tạm đặt tên `<file>.<pid>.<rand>.tmp`.
   - Entry hook đã cài không có `onFailure`. Đường dẫn dùng `/`.
   - State JSON hỏng thì reset, không để hook chết im mãi.
   - Test assert thư mục `~/.claude/agent-maturity` thật vẫn chưa tồn tại sau khi chạy.
6. **Không chiều lòng.**
   - Skill ghi rõ: socrates REJECT mọi chuẩn nới lỏng kiểm chứng, bảo mật hoặc báo cáo trung thực, kể cả khi anh chọn Nâng cấp.
   - Số đo "duyệt ngay lần đầu" luôn đi kèm số đo ngược: việc đã duyệt rồi bị mở lại hoặc rollback.
7. **Cổng D2 (bổ sung).**
   - Tập test có ≥20 ca cam chịu và ≥20 ca phủ định/câu hỏi; báo cả recall.
   - Tune bộ phân loại trên phần dev trước D2.
   - Smoke trong desktop app, không chỉ bằng `claude -p`.
   - Đối chiếu số dòng log của hook với transcript, để biết tin nhắn xếp hàng (gõ Enter khi agent đang làm) có đi qua hook không.
8. **D3:** test dùng `--store` và `--vault` tạm, vì CLI tự sync projection. Note `type: feedback` trong auto-memory được nhập định kỳ, không chỉ một lần.
9. **Phiên của slice (quyết định 6).** D1 do builder chạy dưới dạng subagent của phiên root, theo yêu cầu `@builder` của anh. Vì vậy transcript nằm trong `subagents/` của phiên root. PR ghi đường dẫn đó, và mọi lệnh dùng đường dẫn tuyệt đối trong worktree slice. Các slice sau nên mở phiên Claude Code mới với thư mục là worktree của slice, để mỗi phiên có transcript riêng.

## 5. Câu hỏi còn mở cho anh

Đã chốt ngày 21/11:
1. Trần chi tiêu theo tháng: **tắt** (chỉ anh dùng).
2. Tập vàng D0: root gắn nhãn, anh chỉ xem lại 30–50 câu dễ sai: **đồng ý**.
3. Phạm vi: **mọi dự án**, cả chuẩn giao tiếp lẫn chuẩn quy trình kỹ thuật (§2.5).
4. PR D1 (#74): anh nghiệm thu "ok", đã merge vào nhánh epic.

Còn mở:
4. D-track chỉ đổi `tools/`, không đổi byte sản phẩm. Cho lên `main` sớm (không phát hành), hay đợi cùng nhánh epic? (nối với câu 6 của báo cáo)
