# Nối Chăm sóc khách hàng vào MyGraph cho agent izzi

Trạng thái: chủ shop **đã duyệt Slice 1** (2026-11-19). Slice 1 đã code xong (desktop), chưa phát hành.

Nối tiếp `CARE-FACEBOOK-PHASE-C-AUTO-REPLY.md` (izzi tự trả lời khách trên Page, live từ 2026-11-19 trên Hồng Hưng).

## 0. Hiện trạng

- Chăm sóc khách hàng đang tách rời. Module `main/customer-care/*` và màn `CustomerCareWorkspace.tsx` không ghi gì vào MyGraph.
- MyGraph (`/api/aibase/nodes`, bảng `user_nodes`) là graph **cá nhân của từng tài khoản**. Mỗi lần tạo hoặc sửa node đều đổi ETag. Lần sync 5 phút kế tiếp vì vậy tải lại cả danh sách node (khoảng 0,37 MB thô, khoảng 90 KB nén, với 331 node).
- Backend prod (`rc-f3bc034`) chèn node mới ở mỗi `POST`, không chống trùng theo url, không tự gắn tag, không embed node. Nhánh `integration/pricing-security-e5a1c47` có các tính năng đó nhưng chưa lên prod. Code ở đây không dựa vào chúng, nhưng vẫn chịu được trường `tags` nếu sau này backend gộp vào metadata.
- **AI Marketing Director không đọc MyGraph.** Prompt của Director chỉ có:
  - Product Marketing Context (proof claims);
  - hồ sơ onboarding;
  - một SKILL.md.

  Với Care, Director chỉ gọi `resolveCustomerCareAuthority`, tức tra vai trò.
- Thiết lập Care (thông tin đã duyệt, người nhận bàn giao) được **mã hoá trên máy** (safeStorage). Thông tin đã duyệt chỉ lên máy chủ khi bật "Tự động trả lời khách".

## 1. Mục tiêu

1. Mở Graph view là thấy quy trình chăm sóc khách của shop: đang bật hay tắt, đủ thông tin gì, kết quả ra sao.
2. Director đọc phần đó **qua MyGraph** khi lập kế hoạch chiến dịch:
   - biết Page có tự trả lời không, để chọn CTA "Nhắn tin Page";
   - biết số khách để lại số, để đặt KPI;
   - biết chủ đề nào chưa có thông tin đã duyệt (ví dụ giá), để đề xuất bổ sung.
3. Không làm lộ gì của khách và không làm tăng đáng kể egress Supabase.

## 2. Luật cứng

- **Không bao giờ** đưa vào graph, embedding hay log: tin nhắn của khách, PSID, tên khách, SĐT, Zalo, ID lead. Đây là chính sách Meta Platform và điều kiện App Review (`CARE-FACEBOOK-APP-REVIEW-PACKET.md`).
- Graph chỉ nhận **số đếm, trạng thái dạng mã cố định, tên chủ đề và mốc thời gian**.
- **Không đưa nguyên văn thông tin đã duyệt** lên graph. Lý do:
  - thông tin "Liên hệ" chứa số điện thoại của shop;
  - thiết lập đang được mã hoá trên máy có chủ đích;
  - Director chỉ cần biết chủ đề nào thiếu, không cần chữ;
  - Content Agent đã có proof claims để viết.
- Không đưa "người nhận bàn giao" dạng chữ (đây là chữ tự do, có thể chứa tên người hoặc số điện thoại). Graph chỉ ghi "đã cài" hoặc "chưa cài".
- ID tài khoản và ID workspace không nằm trong graph. Node mang `wsKey` = 16 chữ cái (a–p) lấy từ SHA-256(tài khoản, workspace). Có tài khoản trong khoá, nên danh sách node còn cache của tài khoản khác không bao giờ khớp.

## 3. Node và cạnh: tối đa 3 node, 2 cạnh cho mỗi tài khoản và workspace

Màu teal nhạt `#5B8AA6`, cùng kiểu node hub agent. `nodeType: 'note'`.

Mỗi node chỉ có một nguồn, để hai máy của cùng một tài khoản không ghi đè nhau bằng dữ liệu kém hơn:

| Node (`metadata.kind`) | Tiêu đề | Nguồn, khi nào được dựng | Nội dung hiển thị | Đổi khi |
|---|---|---|---|---|
| `care-process` | `Chăm sóc khách · Quy trình` | Trạng thái trên máy chủ. Luôn dựng. | Luật Phase C rút gọn: trả lời bằng câu cố định + thông tin đã duyệt rồi xin SĐT/Zalo; tối đa 3 tin/khách/24 giờ trong cửa sổ 23 giờ; dừng khi khách để số, từ chối, hoặc người/ứng dụng khác trả lời; câu hỏi chưa có thông tin thì hẹn nhân viên báo lại; khách để số thì vào "Khách để lại số". Dòng trạng thái: Page đã kết nối hay chưa, tự trả lời bật từ lúc nào hay đang tắt, máy chủ đang trả lời bằng bao nhiêu thông tin và gửi lên lúc nào. | Bật/tắt công tắc, kết nối hoặc ngắt Page, gửi thông tin lên máy chủ, đổi phiên bản luật |
| `care-facts` | `Chăm sóc khách · Thông tin đã duyệt` | Thiết lập đã lưu (mã hoá) trên máy này. Chỉ dựng khi máy có thiết lập, và khi tự trả lời đang bật thì số thông tin còn hiệu lực trên máy phải bằng số máy chủ đang dùng (máy cầm thiết lập cũ hơn hoặc mới hơn thì không ghi). | Số thông tin theo chủ đề (Danh mục, Giá, Chất lượng, Chính sách, Liên hệ), số đã hết hạn, chủ đề còn thiếu, bàn giao nhân viên đã cài hay chưa | Lưu thiết lập |
| `care-results` | `Chăm sóc khách · Kết quả` | Số đếm trên máy chủ + lần đọc lead mới nhất trên máy này. Chỉ dựng khi lần đọc lead chưa quá 15 phút. | 24 giờ qua: số tin izzi gửi, số khách izzi đã dừng. 7 ngày qua: số khách để số, số khách chưa gọi lại. Lý do lần gần nhất không gửi được. Cập nhật lúc nào. | Số đếm đổi (tối đa 1 lần/6 giờ), hoặc làm mới mốc thời gian mỗi 24 giờ |

Node không được dựng ở một lượt thì giữ nguyên nội dung đang có trong graph.

Cạnh: `care-process → care-facts` (nhãn "dùng") và `care-process → care-results` (nhãn "kết quả"). Cạnh chỉ được tạo lúc node con hoặc node quy trình được tạo mới. Một cạnh tạo hỏng không được thử lại.

Ví dụ với Hồng Hưng hôm nay: Danh mục 4 · Giá 1 · Chất lượng 0 · Chính sách 0 · Liên hệ 3. Còn thiếu: Chất lượng, Chính sách.

**Tên Page** (tên công khai của shop) chỉ được ghi trong nội dung node `care-process`. Mọi dãy từ 8 chữ số trở lên trong tên Page bị thay bằng `[số]` trước khi ghi.

`metadata` của mỗi node chứa đúng phần dữ liệu có cấu trúc cho agent đọc:

```ts
type CareGraphMeta =
  | { kind: 'care-process'; schema: 1; wsKey: string; processVersion: 'phase-c-1';
      page: 'connected' | 'needs_reauth' | 'not_connected' | 'unknown';
      autoReply: 'on' | 'off' | 'unavailable' | 'unknown'; autoReplySince: string | null;
      factsUploadedAt: string | null; serverFactCount: number | null }
  | { kind: 'care-facts'; schema: 1; wsKey: string; handoffSet: boolean;
      byTopic: Record<'catalog'|'price'|'quality'|'policy'|'contact', number>;
      expired: number; missing: CareTopic[] }
  | { kind: 'care-results'; schema: 1; wsKey: string; asOf: string;
      sent24h: number | null; stopped24h: number | null;
      leads24h: number | null; leads7d: number | null; leadsOpen: number | null; leadsCapped: boolean;
      lastProblem: CustomerCareAutoReplyProblem | null };
```

`autoReply: 'unknown'` nghĩa là máy này không có route tự trả lời. `sent24h`/`stopped24h` bằng `null` khi Page chưa có binding trên máy chủ. `leadsCapped` bằng `true` khi trang lead đầu đã đầy 50, lúc đó con số hiện là "50+".

**Chưa có "tỉ lệ trả lời → để số".** Máy chủ hiện chỉ trả số tin đã gửi và số khách đã dừng trong 24 giờ, không tách theo lý do dừng. Lead lại gồm cả khách tự để số mà không cần izzi trả lời. Ghép hai số đó thành tỉ lệ sẽ sai. Xem Slice 2 ở mục 8.

## 4. Ai đọc và để làm gì

| Agent | Đọc gì | Dùng để |
|---|---|---|
| **AI Marketing Director** (lập kế hoạch, `customer-marketing-service.ts`) | `metadata` của 3 node có `wsKey` khớp workspace đang hoạt động, lấy từ danh sách node MyGraph đã sync (`graph_nodes` cache, không gọi thêm mạng) | Xem các luật ngay dưới bảng này |
| **Agent trong Graph view** (chat nhánh trên node) | Nội dung node khi người dùng chọn node đó | Hỏi đáp về quy trình chăm sóc. Phần này có sẵn, không cần code. |

Luật cho Director:

- Tự trả lời đang bật **và** node Kết quả còn mới (dưới 48 giờ): được dùng CTA "Nhắn tin Page để được tư vấn". KPI tuần có "số khách để lại số qua Messenger".
- Tự trả lời đang bật nhưng chưa có số liệu mới: không hứa trả lời ngay trên Messenger cho tới khi chủ shop kiểm tra lại.
- Tự trả lời đang tắt hoặc Page chưa kết nối: không hứa trả lời tức thì trên Messenger.
- Chủ đề có 0 thông tin đã duyệt (nhất là Giá): thêm vào mục "Cần khách hàng duyệt" một việc "Bổ sung thông tin đã duyệt về …", vì khách hỏi chủ đề đó sẽ phải chờ nhân viên.
- `lastProblem` là `standby` hoặc `other_app`: đề xuất chỉnh Conversation Routing (Pancake đang giữ hội thoại).
- `asOf` cũ hơn 48 giờ: ghi rõ "số liệu chăm sóc khách đã cũ" và không đặt KPI dựa trên số đó.
- Khối Care không phải proof claim. Director không được dùng nó để khẳng định điều gì về sản phẩm.

Khối thêm vào `prompt` của Director (cả chế độ kế hoạch lẫn chế độ JSON):

```
Chăm sóc khách trên Facebook Page (từ MyGraph, cập nhật 19/11/2026 12:00):
- Tự trả lời khách: đang bật từ 19/11/2026 10:05; Page đã kết nối.
- Thông tin đã duyệt: Danh mục 4, Giá 1, Chất lượng 0, Chính sách 0, Liên hệ 3; còn thiếu: Chất lượng, Chính sách; bàn giao nhân viên đã cài.
- 24 giờ qua: izzi gửi 5 tin, dừng với 2 khách. 7 ngày qua: 1 khách để lại số, 1 khách chưa được gọi lại.
Cách dùng khối Chăm sóc khách:
- Tự trả lời đang bật: được dùng CTA "Nhắn tin Page để được tư vấn"; KPI tuần có "số khách để lại số qua Messenger".
- Trong mục "Cần khách hàng duyệt", thêm việc bổ sung thông tin đã duyệt về: Chất lượng, Chính sách (...).
- Khối này là số liệu vận hành, không phải proof claim: không dùng nó để khẳng định điều gì về sản phẩm.
```

Director nhận khối này qua `CustomerMarketingService.setCareContextReader`, với tài khoản và workspace của lượt lập kế hoạch. Hàm đọc nằm ở `careDirectorContextFromCache` và không gọi mạng.

Không có node (chưa sync, không có quyền Care, lỗi đọc), thì không có khối này và Director chạy như hiện nay.

## 5. Giữ node luôn mới

Thành phần mới (đều chạy trong main):

- **`care-graph-digest.ts`** (thuần, không mạng): nhận setup, kết nối Page, trạng thái tự trả lời và tóm tắt lead, rồi trả về `CareGraphMeta` và nội dung từng node. Không có đường nào để chữ của khách lọt vào: tóm tắt lead chỉ gồm số đếm.
- **`CareGraphPublisher`**: quyết định khi nào ghi và ghi qua `GraphClient`.
- **`care-graph-reader.ts`** (thuần): đọc `graph_nodes` cache, kiểm từng trường, rồi dựng khối prompt cho Director.

Nguồn số liệu, không thêm route backend nào:

| Số liệu | Nguồn | Chi phí mạng thêm |
|---|---|---|
| Setup, chủ đề, hết hạn, bàn giao | `CustomerCareService.readGraphSnapshot()` (giải mã trên máy) | 1 request đọc kết nối Page mỗi lần chạy |
| Công tắc, gửi/dừng 24 giờ, `lastProblem` | `GET /auto-reply` sẵn có | 1 request mỗi lần chạy |
| Lead 24 giờ / 7 ngày / chưa gọi | `CareLeadNotifier` vốn đọc trang lead đầu mỗi phút. Thêm callback `onLeadSummary` chỉ trả số đếm, SĐT không rời notifier. | 0 |

Khi nào chạy:

1. Ngay sau khi lưu thiết lập Care thành công, hoặc bật/tắt công tắc thành công. Dùng một callback `onCareChanged` mới trong `CustomerCareService`.
2. Mỗi 6 giờ khi đang đăng nhập, và một lần sau khi app mở, trễ 2 phút để không chen lần sync đầu.

Một lượt bị bỏ qua hẳn, không ghi gì, khi:

- vai trò không được đọc lead (reviewer, viewer), hoặc không có quyền hợp lệ;
- workspace không dùng Care trên máy này: chưa lưu thiết lập **và** Page chưa kết nối;
- không đọc được kết nối Page hoặc trạng thái công tắc. Lỗi tạm thời không được ghi đè trạng thái tốt bằng "chưa rõ".

Khi nào ghi:

- Mỗi node có hash nội dung lưu trong settings cục bộ, theo khoá `care_graph:v1:<identity>:<wsKey>:<kind>`. Hash không đổi thì không gửi gì.
- Riêng `care-results`: ghi tối đa 1 lần/6 giờ, và làm mới `asOf` khi lần ghi trước đã quá 24 giờ.
- Ước tính: khoảng 5 lần ghi/ngày/máy. Mỗi lần ghi kéo theo 1 lần đọc lại đầy đủ danh sách node (khoảng 90 KB nén), tức dưới 0,5 MB/ngày, so với ngân sách khoảng 167 MB/ngày.

Cách ghi một node. Backend prod (`rc-f3bc034`) **không** chống trùng: mỗi `POST /api/aibase/nodes` đều chèn node mới, và `PATCH` vào id đã bị xoá vẫn trả ok. Vì vậy desktop tự tìm node:

1. Mỗi node có `url` cố định `https://izziapi.com/aibase/graph?care=<kind>&ws=<wsKey>`. Bấm vào url chỉ mở trang graph web.
2. Tìm node theo url trong danh sách node mà lần sync 5 phút đã cache (`graph_nodes`). Không tốn request.
3. Nếu một node sắp ghi không có trong cache (lần đầu, cache cũ, hoặc người dùng đã xoá), đọc lại danh sách node đúng **một lần** (`GraphClient.readNodes`). Lần đọc lỗi thì **không tạo gì**, chờ lượt sau. Thà không ghi còn hơn tạo node đôi.
4. Có node: `PATCH` nội dung và `metadata` theo id. Có nhiều node cùng url (node đôi cũ) thì sửa node mới nhất.
5. Không có: `POST` tạo mới, rồi tạo cạnh từ `care-process`.

Dùng các hàm có sẵn của `GraphClient` (`readNodes`, `createNode`, `updateNode`, `createLink`), không sửa `GraphClient`. Mọi lần ghi dùng `queueOnOffline: false`: mất mạng thì lần chạy sau thử lại, hàng đợi offline không phình.

Giới hạn đã biết:

- Nếu người dùng xoá một node Care trong 5 phút trước khi cache kịp sync, lượt ghi đó `PATCH` vào id đã mất (prod vẫn trả ok). Node được tạo lại ở lần ghi kế tiếp có thay đổi. Với node Kết quả, chậm nhất là sau 24 giờ.
- Hai máy cùng tài khoản cùng ghi lần đầu đúng một lúc có thể tạo hai node cùng url. Người đọc và lần ghi sau luôn chọn node mới nhất, nên node thừa chỉ nằm yên.
- Một cạnh tạo hỏng không được thử lại.
- `GET /api/aibase/nodes` trả tối đa số dòng của PostgREST (mặc định Supabase là 1000), node mới nhất đứng trước. Khi graph lớn hơn mức đó, node Care cũ có thể rơi khỏi danh sách. Lúc ấy:
  - publisher không tạo node mới, vì danh sách không chứng minh được node đã mất (log `care graph list incomplete`);
  - Director có thể không thấy khối Care.

  Cách sửa gốc là phân trang hoặc trả danh sách nhẹ ở backend, hoặc bớt node transcript thô.

An toàn khi chạy:

- Danh tính và workspace được kiểm lại ngay trước khi ghi. Đổi tài khoản hoặc workspace giữa chừng thì huỷ lượt đó.
- Mọi lỗi đều được nuốt: Care và Director không bao giờ hỏng vì graph.
- Log chỉ có chuỗi cố định, ví dụ `care graph write failed`.
- Viewer và reviewer không đọc được lead, nên không có node nào được ghi.

## 6. Kiểm thử (TDD)

- **`care-graph-digest.test.ts`**:
  - đếm theo chủ đề, chủ đề thiếu, thông tin hết hạn;
  - cửa sổ 24 giờ và 7 ngày của lead, trường hợp đủ 50 lead;
  - chỉ dựng node quy trình khi máy không có thiết lập và không có lần đọc lead mới;
  - **bất biến riêng tư:** cho tên Page chứa SĐT và Zalo, kiểm rằng chuỗi JSON của mọi node không chứa các giá trị đó, ID tài khoản hay ID workspace, cũng không có dãy từ 8 chữ số trở lên.
- **`care-graph-publisher.test.ts`**, chạy với backend giả giống prod (POST luôn chèn, PATCH id mất vẫn ok):
  - lần đầu đọc lại danh sách một lần rồi tạo node và cạnh;
  - không đổi gì thì không gửi request nào;
  - node có trong cache thì `PATCH` theo id, không đọc lại, không tạo mới;
  - node chưa có trong cache nhưng có trên máy chủ thì không bị tạo đôi;
  - đọc lại lỗi thì không tạo gì, lượt sau thử lại;
  - có node đôi thì sửa node mới nhất;
  - node quy trình bị xoá rồi tạo lại thì được nối với node con còn lại;
  - giới hạn 6 giờ và làm mới mỗi 24 giờ; không có lần đọc lead mới thì không đụng node Kết quả;
  - đổi tài khoản hoặc workspace giữa chừng thì không ghi; lỗi ghi không ném lỗi và log không có dữ liệu.
- **`customer-care-service.graph.test.ts`**: snapshot không chứa chữ của thông tin, nguồn, chữ bàn giao hay Page id; vai trò không đọc lead thì không có snapshot; không dùng Care thì không có snapshot; lỗi đọc Page hoặc công tắc thì bỏ lượt; `onCareChanged` chỉ chạy sau khi lưu hoặc bật/tắt thành công.
- **`care-lead-notifier.summary.test.ts`**: chỉ số đếm rời notifier; trang đầy 50 hoặc còn trang sau thì đánh dấu "50+".
- **`care-graph-reader.test.ts`**: bỏ qua node của `wsKey` khác (kể cả tài khoản khác), metadata sai kiểu, số âm, số lẻ hay quá lớn, mã lý do lạ. Trường lạ thì bỏ qua chứ không từ chối (bản backend có auto-tag sẽ gộp `tags` vào metadata). Dữ liệu cũ hơn 48 giờ hoặc chưa có node Kết quả thì không gợi ý CTA/KPI.
- **Test Director:** có node thì prompt có khối Care, không có node hoặc đọc lỗi thì prompt giữ nguyên như cũ.
- Chạy toàn bộ desktop vitest, `tsc` (main và renderer), eslint. Trước khi sửa mỗi hàm có sẵn, chạy `gitnexus_impact` lên `CareLeadNotifier`, `CustomerCareService` và `askDirector`.

## 7. Không làm trong Slice 1

- Không sửa backend, không migration, không deploy.
- Không đưa nguyên văn thông tin đã duyệt, không đưa người nhận bàn giao, không đưa dữ liệu theo từng khách.
- Không thêm vào Content Agent (bài đăng theo lịch). Có thể làm sau: thêm một dòng CTA khi tự trả lời đang bật.
- Không phát hành desktop. Phát hành cần bạn OK riêng.
- App Review: graph chỉ nhận số đếm tổng hợp, dùng cho chính shop, nên không đổi luồng dữ liệu Meta đã khai. Có thể thêm một câu vào mục dùng dữ liệu của packet khi nộp.

## 8. Slice 2, nếu bạn muốn (cần backend và deploy riêng)

Thêm vào `GET /auto-reply` một khối `last7d`, chỉ gồm số đếm:

- `customersAnswered`;
- `stoppedBy: { phone, declined, human, other_app, ongoing }`;
- `repliesSent`;
- `missedTopics: { price, quality, policy, ... }`: số lần khách hỏi một chủ đề chưa có thông tin đã duyệt (câu "nhân viên sẽ báo lại"). Composer hiện chỉ lưu ID thông tin đã dùng, nên phải ghi thêm chủ đề bị hụt (chỉ mã chủ đề, không có chữ của khách).

Từ đó có hai chỉ số thật:

- **Tỉ lệ trả lời → để số** = `stoppedBy.phone / customersAnswered`.
- **Chủ đề khách hỏi mà shop chưa có thông tin** (`missedTopics`), để Director biết thiếu giá có thật sự làm hụt khách không.

Slice 2 cần PR backend, cắt từ đúng bản đang chạy (prod `rc-f3bc034`), và bạn OK deploy.
