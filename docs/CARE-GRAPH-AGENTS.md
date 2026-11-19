# Nối Chăm sóc khách hàng vào MyGraph cho agent izzi

Trạng thái: **bản thiết kế, chờ chủ shop duyệt**. Chưa có dòng code nào.

Nối tiếp `CARE-FACEBOOK-PHASE-C-AUTO-REPLY.md` (izzi tự trả lời khách trên Page, live từ 2026-11-19 trên Hồng Hưng).

## 0. Hiện trạng

- Chăm sóc khách hàng đang tách rời. Module `main/customer-care/*` và màn `CustomerCareWorkspace.tsx` không ghi gì vào MyGraph.
- MyGraph (`/api/aibase/nodes`, bảng `user_nodes`) là graph **cá nhân của từng tài khoản**. Mỗi lần tạo hoặc sửa nội dung node, backend tự gắn tag, embed `title + content` để nối "liên quan", và đổi ETag. Lần sync 5 phút kế tiếp vì vậy tải lại cả danh sách node (khoảng 0,37 MB thô, khoảng 90 KB nén, với 331 node).
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
- ID workspace không nằm trong graph. Node mang `wsKey` = 16 ký tự đầu của SHA-256(workspaceId).

## 3. Node và cạnh: 3 node, 2 cạnh cho mỗi workspace

Màu teal nhạt `#5B8AA6`, cùng kiểu node hub agent. `nodeType: 'note'`.

| Node (`metadata.kind`) | Tiêu đề | Nội dung hiển thị | Đổi khi |
|---|---|---|---|
| `care-process` | `Chăm sóc khách · Quy trình` | Luật Phase C rút gọn: trả lời bằng câu cố định + thông tin đã duyệt rồi xin SĐT/Zalo; tối đa 3 tin/khách/24 giờ trong cửa sổ 23 giờ; dừng khi khách để số, từ chối, hoặc người/ứng dụng khác trả lời; câu hỏi chưa có thông tin thì hẹn nhân viên báo lại; khách để số thì vào "Khách để lại số". Dòng trạng thái: Page đã kết nối hay chưa, tự trả lời bật từ lúc nào hay đang tắt, bàn giao đã cài hay chưa. | Bật/tắt công tắc, kết nối hoặc ngắt Page, đổi phiên bản luật |
| `care-facts` | `Chăm sóc khách · Thông tin đã duyệt` | Số thông tin theo chủ đề (Danh mục, Giá, Chất lượng, Chính sách, Liên hệ), số đã hết hạn, chủ đề còn thiếu, lần gửi lên máy chủ gần nhất | Lưu thiết lập, gửi thông tin lên máy chủ |
| `care-results` | `Chăm sóc khách · Kết quả` | 24 giờ qua: số tin izzi gửi, số khách izzi đã dừng. 7 ngày qua: số khách để số, số khách chưa gọi lại. Lý do lần gần nhất không gửi được. Cập nhật lúc nào. | Số đếm đổi (tối đa 1 lần/6 giờ), hoặc làm mới mốc thời gian mỗi 24 giờ |

Cạnh: `care-process → care-facts` (nhãn "dùng") và `care-process → care-results` (nhãn "kết quả"). Cạnh chỉ được tạo lúc node con được tạo mới.

Ví dụ với Hồng Hưng hôm nay: Danh mục 4 · Giá 1 · Chất lượng 0 · Chính sách 0 · Liên hệ 3. Còn thiếu: Chất lượng, Chính sách.

**Tên Page** (tên công khai của shop) chỉ được ghi trong nội dung node `care-process`. Mọi dãy từ 8 chữ số trở lên trong tên Page bị thay bằng `[số]` trước khi ghi.

`metadata` của mỗi node chứa đúng phần dữ liệu có cấu trúc cho agent đọc:

```ts
type CareGraphMeta =
  | { kind: 'care-process'; schema: 1; wsKey: string; processVersion: 'phase-c-1';
      page: 'connected' | 'needs_reauth' | 'not_connected' | 'unknown';
      autoReply: 'on' | 'off' | 'unavailable'; autoReplySince: string | null; handoffSet: boolean }
  | { kind: 'care-facts'; schema: 1; wsKey: string;
      byTopic: Record<'catalog'|'price'|'quality'|'policy'|'contact', number>;
      expired: number; missing: CareTopic[]; uploadedAt: string | null }
  | { kind: 'care-results'; schema: 1; wsKey: string; asOf: string;
      sent24h: number | null; stopped24h: number | null;
      leads24h: number | null; leads7d: number | null; leadsOpen: number | null; leadsCapped: boolean;
      lastProblem: CustomerCareAutoReplyProblem | null };
```

`null` nghĩa là chưa đọc được. Ví dụ: Page chưa kết nối, hoặc vai trò không được xem lead. `leadsCapped` bằng `true` khi trang lead đầu đã đầy 50, lúc đó con số hiện là "50+".

**Chưa có "tỉ lệ trả lời → để số".** Máy chủ hiện chỉ trả số tin đã gửi và số khách đã dừng trong 24 giờ, không tách theo lý do dừng. Lead lại gồm cả khách tự để số mà không cần izzi trả lời. Ghép hai số đó thành tỉ lệ sẽ sai. Xem Slice 2 ở mục 8.

## 4. Ai đọc và để làm gì

| Agent | Đọc gì | Dùng để |
|---|---|---|
| **AI Marketing Director** (lập kế hoạch, `customer-marketing-service.ts`) | `metadata` của 3 node có `wsKey` khớp workspace đang hoạt động, lấy từ danh sách node MyGraph đã sync (`graph_nodes` cache, không gọi thêm mạng) | Xem các luật ngay dưới bảng này |
| **Agent trong Graph view** (chat nhánh trên node) | Nội dung node khi người dùng chọn node đó | Hỏi đáp về quy trình chăm sóc. Phần này có sẵn, không cần code. |

Luật cho Director:

- Tự trả lời đang bật: được dùng CTA "Nhắn tin Page để được tư vấn". KPI tuần có "số khách để lại số qua Messenger".
- Tự trả lời đang tắt hoặc Page chưa kết nối: không hứa trả lời tức thì trên Messenger.
- Chủ đề có 0 thông tin đã duyệt (nhất là Giá): thêm vào mục "Cần khách hàng duyệt" một việc "Bổ sung thông tin đã duyệt về …", vì khách hỏi chủ đề đó sẽ phải chờ nhân viên.
- `lastProblem` là `standby` hoặc `other_app`: đề xuất chỉnh Conversation Routing (Pancake đang giữ hội thoại).
- `asOf` cũ hơn 48 giờ: ghi rõ "số liệu chăm sóc khách đã cũ" và không đặt KPI dựa trên số đó.
- Khối Care không phải proof claim. Director không được dùng nó để khẳng định điều gì về sản phẩm.

Khối thêm vào `prompt` của Director (cả chế độ kế hoạch lẫn chế độ JSON):

```
Chăm sóc khách trên Facebook Page (từ MyGraph, cập nhật 19/11 12:00):
- Tự trả lời: đang bật từ 19/11/2026; Page đã kết nối; bàn giao đã cài.
- Thông tin đã duyệt: Danh mục 4, Giá 1, Chất lượng 0, Chính sách 0, Liên hệ 3; thiếu: Chất lượng, Chính sách.
- 24 giờ qua: izzi gửi 5 tin, dừng với 2 khách. 7 ngày qua: 1 khách để số, 1 khách chưa được gọi lại.
```

Không có node (chưa sync, không có quyền Care, lỗi đọc), thì không có khối này và Director chạy như hiện nay.

## 5. Giữ node luôn mới

Thành phần mới (đều chạy trong main):

- **`care-graph-digest.ts`** (thuần, không mạng): nhận setup, kết nối Page, trạng thái tự trả lời và tóm tắt lead, rồi trả về `CareGraphMeta` và nội dung từng node. Không có đường nào để chữ của khách lọt vào: tóm tắt lead chỉ gồm số đếm.
- **`CareGraphPublisher`**: quyết định khi nào ghi và ghi qua `GraphClient`.
- **`care-graph-reader.ts`** (thuần): đọc `graph_nodes` cache, kiểm từng trường, rồi dựng khối prompt cho Director.

Nguồn số liệu, không thêm route backend nào:

| Số liệu | Nguồn | Chi phí mạng thêm |
|---|---|---|
| Setup, chủ đề, hết hạn, bàn giao | `CustomerCareService.getSnapshot()` (giải mã trên máy) | 1 request đọc kết nối Page mỗi lần chạy |
| Công tắc, gửi/dừng 24 giờ, `lastProblem` | `GET /auto-reply` sẵn có | 1 request mỗi lần chạy |
| Lead 24 giờ / 7 ngày / chưa gọi | `CareLeadNotifier` vốn đọc trang lead đầu mỗi phút. Thêm callback `onLeadSummary` chỉ trả số đếm, SĐT không rời notifier. | 0 |

Khi nào chạy:

1. Ngay sau khi lưu thiết lập Care thành công, hoặc bật/tắt công tắc thành công. Dùng một callback `onCareChanged` mới trong `CustomerCareService`.
2. Mỗi 6 giờ khi đang đăng nhập, và một lần sau khi app mở, trễ 2 phút để không chen lần sync đầu.

Khi nào ghi:

- Mỗi node có hash nội dung lưu trong settings cục bộ, theo khoá `care_graph:v1:<identity>:<wsKey>:<kind>`. Hash không đổi thì không gửi gì.
- Riêng `care-results`: ghi tối đa 1 lần/6 giờ, và làm mới `asOf` khi lần ghi trước đã quá 24 giờ.
- Ước tính: khoảng 5 lần ghi/ngày/máy. Mỗi lần ghi kéo theo 1 lần đọc lại đầy đủ danh sách node (khoảng 90 KB nén), tức dưới 0,5 MB/ngày, so với ngân sách khoảng 167 MB/ngày.

Cách ghi một node:

1. `POST /api/aibase/nodes` với `url` cố định `https://izziapi.com/aibase/graph?care=<kind>&ws=<wsKey>`. Backend đã chống trùng theo (người dùng, url). Vì vậy:
   - gửi lại cũng không tạo node đôi;
   - hai máy cùng tài khoản cũng không tạo node đôi;
   - người dùng xoá node thì lần sau node được tạo lại;
   - bấm vào url chỉ mở trang graph web.
2. Node đã có sẵn: `PATCH` nội dung và `metadata`.
3. Node vừa tạo mới: tạo cạnh từ `care-process`.

Thêm `GraphClient.findOrCreateNodeByUrl()` trả về `{ id, created }`. Hàm `createNode` hiện tại bỏ mất cờ `deduped` của backend. Mọi lần ghi dùng `queueOnOffline: false`: mất mạng thì lần chạy sau thử lại, hàng đợi offline không phình.

An toàn khi chạy:

- Danh tính và workspace được kiểm lại ngay trước khi ghi. Đổi tài khoản hoặc workspace giữa chừng thì huỷ lượt đó.
- Mọi lỗi đều được nuốt: Care và Director không bao giờ hỏng vì graph.
- Log chỉ có mã cố định, ví dụ `care-graph: write failed 500`.
- Viewer không có quyền Care, nên không có node nào được ghi.

## 6. Kiểm thử (TDD)

- **`care-graph-digest.test.ts`**:
  - đếm theo chủ đề, chủ đề thiếu, thông tin hết hạn;
  - cửa sổ 24 giờ và 7 ngày của lead, trường hợp đủ 50 lead;
  - Page chưa kết nối;
  - **bất biến riêng tư:** cho input chứa SĐT, Zalo, PSID, tin nhắn và tên khách, kiểm rằng chuỗi JSON của mọi payload POST/PATCH không chứa giá trị nào trong số đó, cũng không có dãy từ 8 chữ số trở lên.
- **`care-graph-publisher.test.ts`**:
  - hash không đổi thì không ghi;
  - giới hạn 6 giờ và làm mới mỗi 24 giờ;
  - tạo cạnh chỉ khi `created`;
  - đổi danh tính giữa chừng thì không ghi;
  - lỗi mạng không ném lỗi và không vào hàng đợi offline;
  - log không có dữ liệu.
- **`care-graph-reader.test.ts`**: bỏ qua node của `wsKey` khác, metadata sai kiểu hoặc có trường lạ, số âm hay quá lớn. Kiểm khối prompt cho dữ liệu cũ hơn 48 giờ.
- **`graph-client` test** cho `findOrCreateNodeByUrl`.
- **Test Director:** có node thì prompt có khối Care, không có node thì prompt giữ nguyên như cũ.
- Chạy toàn bộ desktop vitest, `tsc` (main và renderer), eslint. Trước khi sửa mỗi hàm có sẵn, chạy `gitnexus_impact` lên `GraphClient`, `CareLeadNotifier`, `CustomerCareService.saveSetup/setAutoReply` và hàm dựng prompt Director.

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
