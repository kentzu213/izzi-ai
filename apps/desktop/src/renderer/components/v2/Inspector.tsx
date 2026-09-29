import React from 'react';
import { findNavItem, type V2PageId } from './navModel';

/*
 * Inspector (spec/03): right-side context panel, closed by default. In M2 it
 * only describes the mounted legacy page; domain details arrive with M3+.
 */

interface InspectorProps {
  currentPage: V2PageId;
  onClose: () => void;
}

export function Inspector({ currentPage, onClose }: InspectorProps) {
  const match = findNavItem(currentPage);

  return (
    <aside className="v2-inspector" aria-label="Thông tin trang">
      <div className="v2-inspector__head">
        <h2 className="v2-inspector__title">Thông tin trang</h2>
        <button type="button" className="v2-inspector__close" aria-label="Đóng bảng thông tin" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <dl className="v2-inspector__meta">
        <dt>Trang</dt>
        <dd>{match?.item.label ?? currentPage}</dd>
        <dt>Nhóm</dt>
        <dd>{match?.group.label ?? '—'}</dd>
        <dt>Page ID</dt>
        <dd>
          <code>{currentPage}</code>
        </dd>
      </dl>
      <p className="v2-inspector__note">
        Trang legacy được giữ nguyên bên trong shell V2. Nội dung ngữ cảnh theo dự án sẽ có từ M3.
      </p>
    </aside>
  );
}
