/**
 * Chat bubbles render plain text, so these notices use line breaks and quotes
 * for structure instead of markdown markers.
 */
export function customEndpointErrorMessage(err: string, endpointLabel: string): string {
  if (err === 'not-configured' || err === 'disabled') {
    return (
      '⚠️ Chưa cấu hình kết nối model. Chọn một model Izzi ở ô chọn model để chat ngay, ' +
      'hoặc mở tab "Kết nối Model" để nối codex-lb / 9router rồi thử lại.'
    );
  }
  if (/econnrefused|econnreset|\bconnect\b|fetch|time|unreachable|network|endpoint/i.test(err)) {
    return (
      `⚠️ Không kết nối được ${endpointLabel}.\n\nLỗi: ${err}\n\n` +
      'Cách nhanh nhất: chọn một model Izzi ở ô chọn model phía trên khung chat. ' +
      'Hoặc kiểm tra codex-lb / 9router đang chạy đúng cổng, hoặc chỉnh lại trong tab "Kết nối Model".'
    );
  }
  return `⚠️ Model chưa trả lời được.\n\nLỗi: ${err}`;
}

export function agentReplyErrorMessage(displayName: string, rawErr: string): string {
  const isConnErr = /econnrefused|econnreset|\bconnect\b|fetch failed|socket hang up|network|timed? ?out/i.test(rawErr);
  // Empty reply = the container ran but has no model behind it (upstream not
  // configured). The real fix is wiring a model in the "Kết nối Model" tab.
  const isEmptyReply = /rỗng|empty|chưa cấu hình model|provider/i.test(rawErr);
  if (isConnErr) {
    return (
      `⚠️ ${displayName} chưa kết nối được (agent chưa chạy hoặc đang khởi động).\n\nLỗi: ${rawErr}\n\n` +
      'Thử gửi lại sau vài giây (agent có thể đang khởi động), hoặc mở Agent Hub → chạy lại agent. ' +
      'Đảm bảo Docker đang chạy.'
    );
  }
  if (isEmptyReply) {
    return (
      `⚠️ ${displayName} phản hồi rỗng (chưa có model phía sau).\n\nLỗi: ${rawErr}\n\n` +
      'Cách khắc phục nhanh: mở tab "Kết nối Model" ở thanh bên → nối codex-lb (hoặc 9router) → "Lưu & Bật", ' +
      'rồi chat lại. Khi đã bật, mọi agent sẽ chat qua model đó.'
    );
  }
  return (
    `⚠️ ${displayName} chưa trả lời được.\n\nLỗi: ${rawErr}\n\n` +
    'Thử mở tab "Kết nối Model" để nối codex-lb / 9router, hoặc cấu hình model provider rồi thử lại.'
  );
}
