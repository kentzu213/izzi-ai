import React from 'react';
import type { DesktopUpdaterState } from '../../main/updater/types';

const ERROR_PREVIEW_LENGTH = 120;

// Raw updater errors carry URLs and stack text; map the known classes to plain Vietnamese.
export function describeUpdateError(error: string): string {
  if (/update configuration is unavailable/i.test(error)) {
    return 'Bản cài này không có cấu hình cập nhật. Hãy cài lại từ trang phát hành izzi AI.';
  }
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i.test(error)) {
    return 'Không có kết nối mạng. Vui lòng kiểm tra internet.';
  }
  if (/sha512 checksum mismatch/i.test(error)) {
    return 'Bản tải về không khớp chữ ký kiểm tra. Hãy tải lại bản cập nhật.';
  }
  if (/\b(?:403|406|429|5\d\d)\b/.test(error)) {
    return 'Máy chủ cập nhật đang bận. Vui lòng thử lại sau.';
  }
  return error.length > ERROR_PREVIEW_LENGTH ? `${error.slice(0, ERROR_PREVIEW_LENGTH)}…` : error;
}

export function describeUpdaterStatus(state: DesktopUpdaterState): string {
  switch (state.state) {
    case 'checking':
      return 'Đang kiểm tra…';
    case 'available':
      return `Có bản mới ${state.availableVersion || ''}`.trim();
    case 'downloading':
      return 'Đang tải bản cập nhật';
    case 'downloaded':
      return 'Đã tải xong — khởi động lại để cài đặt';
    case 'error':
      return 'Không kiểm tra được';
    default:
      return state.checkedAt ? 'Bạn đang dùng bản mới nhất' : 'Chưa kiểm tra';
  }
}

export function getUpdateBannerMessage(state: DesktopUpdaterState): string | null {
  if (state.state === 'available') {
    return `Bản cập nhật ${state.availableVersion || 'mới'} đã sẵn sàng để tải xuống.`;
  }
  if (state.state === 'downloading') {
    return `Đang tải bản cập nhật ${state.availableVersion || ''}`.trim();
  }
  if (state.state === 'downloaded') {
    return `Bản cập nhật ${state.availableVersion || ''} đã tải xong. Cần khởi động lại để cài đặt.`.trim();
  }
  if (state.state === 'error' && state.error) {
    return describeUpdateError(state.error);
  }
  return null;
}

export function UpdateBanner({
  updaterState,
  onCheck,
  onDownload,
  onRestart,
}: {
  updaterState: DesktopUpdaterState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: () => void;
}) {
  const message = getUpdateBannerMessage(updaterState);

  if (!message) {
    return null;
  }

  return (
    <div className={`update-banner glass-panel update-banner--${updaterState.state}`}>
      <div className="update-banner__copy">
        <strong>Desktop update</strong>
        <span>{message}</span>
      </div>

      <div className="update-banner__actions">
        {(updaterState.state === 'error' || updaterState.state === 'idle') && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCheck}>
            Kiểm tra lại
          </button>
        )}
        {updaterState.state === 'available' && (
          <button type="button" className="btn btn--primary btn--sm" onClick={onDownload}>
            Tải xuống
          </button>
        )}
        {updaterState.state === 'downloaded' && (
          <button type="button" className="btn btn--primary btn--sm" onClick={onRestart}>
            Khởi động lại
          </button>
        )}
      </div>
    </div>
  );
}
