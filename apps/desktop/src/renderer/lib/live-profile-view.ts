// CMR-224 Slice 2 — Live.md view model.
//
// The panel that shows Live.md is deliberately thin: everything worth asserting
// lives here as pure functions, because this repo tests renderer logic through
// plain modules and stores rather than through a DOM.
//
// The distinction that matters to the operator: "there is no file yet" is not the
// same as "there is a file this build refused to parse". In the second case we
// must not offer to save, because saving would destroy words we could not read.

import type {
  LiveProfileReadResult,
  LiveProfileWriteResult,
} from '../../shared/memory-trace/live-profile';

export interface LiveProfileViewModel {
  /** Whether the editor may offer a save action. */
  readonly canEdit: boolean;
  readonly headline: string;
  readonly hint: string;
  readonly tone: 'normal' | 'warning';
  /** Body to show in the editor. Empty when there is nothing safe to show. */
  readonly body: string;
  readonly revisionLabel: string;
}

const LOCAL_ONLY_HINT =
  'Chỉ nằm trên máy này, không đồng bộ lên server. Agent đọc file này trước khi bắt đầu việc mới.';

export function describeLiveProfile(result: LiveProfileReadResult): LiveProfileViewModel {
  if (result.status === 'ok' && result.profile) {
    return {
      canEdit: true,
      headline: 'Live.md — file của bạn',
      hint: LOCAL_ONLY_HINT,
      tone: 'normal',
      body: result.profile.body,
      revisionLabel: `bản ${result.profile.revision}`,
    };
  }

  if (result.status === 'absent') {
    return {
      canEdit: false,
      headline: 'Live.md chưa có',
      hint: 'Mở lại trang này để tạo file từ mẫu.',
      tone: 'warning',
      body: '',
      revisionLabel: '',
    };
  }

  return {
    canEdit: false,
    headline: 'Live.md không đọc được',
    hint: 'File có trên đĩa nhưng bản này không hiểu định dạng. Không ghi gì lên nó — mở thư mục để sửa tay.',
    tone: 'warning',
    body: '',
    revisionLabel: '',
  };
}

/**
 * Message after a save attempt. Every failure says what happened to the existing
 * content, because that is the operator's real question.
 */
export function describeLiveProfileWrite(result: LiveProfileWriteResult): {
  readonly tone: 'normal' | 'warning';
  readonly message: string;
} {
  switch (result.status) {
    case 'ok':
      return {
        tone: 'normal',
        message: `Đã lưu, bản ${result.profile?.revision ?? '?'}.`,
      };
    case 'rejected':
      return {
        tone: 'warning',
        message: 'Chưa lưu: nội dung không phải văn bản hoặc dài quá giới hạn. File cũ còn nguyên.',
      };
    case 'unreadable':
      return {
        tone: 'warning',
        message: 'Chưa lưu: file hiện tại không đọc được nên không ghi đè. File cũ còn nguyên.',
      };
    case 'io_error':
      return {
        tone: 'warning',
        message: 'Chưa lưu được xuống đĩa. File cũ còn nguyên.',
      };
  }
}
