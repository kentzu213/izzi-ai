import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesktopUpdaterState } from '../../main/updater/types';
import {
  RESTART_INSTALL_HINT,
  UpdateBanner,
  describeUpdateError,
  describeUpdaterStatus,
  getUpdateBannerMessage,
} from './UpdateBanner';

describe('describeUpdateError', () => {
  it('does not blame the network for an unrelated error that mentions releases', () => {
    const message = describeUpdateError('Something failed while reading https://github.com/kentzu213/izzi-ai/releases');

    expect(message).not.toContain('kết nối');
  });

  it('maps connectivity failures to a network message', () => {
    expect(describeUpdateError('net::ERR_INTERNET_DISCONNECTED')).toContain('kết nối mạng');
    expect(describeUpdateError('getaddrinfo ENOTFOUND github.com')).toContain('kết nối mạng');
    expect(describeUpdateError('connect ETIMEDOUT 140.82.112.3:443')).toContain('kết nối mạng');
  });

  it('maps server-side HTTP failures to a retry message', () => {
    expect(describeUpdateError('HttpError: 503 Service Unavailable')).toContain('thử lại sau');
    expect(describeUpdateError('HttpError: 406 Not Acceptable')).toContain('thử lại sau');
  });

  it('explains a missing update configuration and a checksum mismatch', () => {
    expect(describeUpdateError('Desktop update configuration is unavailable.')).toContain('cài lại');
    expect(describeUpdateError('sha512 checksum mismatch, expected abc')).toContain('tải lại');
  });

  it('truncates long unknown errors', () => {
    const message = describeUpdateError('x'.repeat(300));

    expect(message).toHaveLength(121);
    expect(message.endsWith('…')).toBe(true);
  });
});

describe('describeUpdaterStatus', () => {
  it('reports up to date only after a completed check', () => {
    expect(describeUpdaterStatus({ state: 'idle', version: '1.0.0' })).toBe('Chưa kiểm tra');
    expect(describeUpdaterStatus({ state: 'idle', version: '1.0.0', checkedAt: '2026-09-30T00:00:00Z' }))
      .toBe('Bạn đang dùng bản mới nhất');
  });

  it('names the version that is available', () => {
    expect(describeUpdaterStatus({ state: 'available', availableVersion: '1.0.1' })).toContain('1.0.1');
  });
});

describe('getUpdateBannerMessage', () => {
  it('stays hidden while idle or checking', () => {
    expect(getUpdateBannerMessage({ state: 'idle', version: '1.0.0' })).toBeNull();
    expect(getUpdateBannerMessage({ state: 'checking', version: '1.0.0' })).toBeNull();
  });

  it('announces a downloaded update with its version', () => {
    const message = getUpdateBannerMessage({ state: 'downloaded', version: '1.0.0', availableVersion: '1.0.1' });

    expect(message).toContain('1.0.1');
    expect(message).toContain('khởi động lại');
  });

  it('describes an error state through describeUpdateError', () => {
    expect(getUpdateBannerMessage({ state: 'error', error: 'net::ERR_NAME_NOT_RESOLVED' })).toContain('kết nối mạng');
  });
});

describe('RESTART_INSTALL_HINT', () => {
  const noop = () => undefined;
  const renderBanner = (updaterState: DesktopUpdaterState) =>
    renderToStaticMarkup(
      createElement(UpdateBanner, { updaterState, onCheck: noop, onDownload: noop, onRestart: noop }),
    );

  it('warns that the silent install closes and reopens the app by itself', () => {
    expect(RESTART_INSTALL_HINT).toBe('App sẽ tự đóng, cài đặt và mở lại sau vài phút — đừng mở lại thủ công.');
  });

  it('shows the hint beside the restart button only once the update is downloaded', () => {
    expect(renderBanner({ state: 'downloaded', version: '1.0.0', availableVersion: '1.0.1' })).toContain(
      RESTART_INSTALL_HINT,
    );
    expect(renderBanner({ state: 'available', version: '1.0.0', availableVersion: '1.0.1' })).not.toContain(
      RESTART_INSTALL_HINT,
    );
  });

  it.each(['./UpdateNotification.tsx', '../pages/Settings.tsx'])('%s shows the hint with its restart button', (rel) => {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

    expect(source).toContain('RESTART_INSTALL_HINT');
  });
});
