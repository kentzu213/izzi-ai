/**
 * Pure Care Page-connection rules: map the backend status to the renderer view, derive Page blockers
 * and the Care mode. Phase A never leaves shadow mode, whatever the connection state.
 */
import type { CustomerCarePageConnection, CustomerCareSetup } from '../../shared/customer-care-types';
import type { CareFacebookConnection, CareFacebookResult, CareFacebookStatus } from './care-facebook-client';

export const CARE_BLOCKER_PAGE_NOT_CONNECTED = 'Page Facebook chưa kết nối. Chế độ thử chỉ tạo nháp, không gửi tin.';
export const CARE_BLOCKER_PAGE_UNVERIFIED =
  'Page chưa kết nối. Page ID được nhập thủ công, chưa được xác minh; chế độ thử không gửi tin.';
export const CARE_BLOCKER_PAGE_NEEDS_REAUTH = 'Kết nối Page Facebook cần cấp phép lại. Hãy bấm “Kết nối lại”.';
export const CARE_BLOCKER_PAGE_MISMATCH =
  'Page ID trong thiết lập khác Page Facebook đã kết nối. Hãy lưu lại thiết lập để dùng Page đã kết nối.';
export const CARE_BLOCKER_PAGE_NOT_SAVED =
  'Page Facebook đã kết nối nhưng chưa được lưu vào thiết lập. Hãy lưu lại thiết lập.';
export const CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE =
  'Chưa kiểm tra được kết nối Page Facebook với máy chủ izzi. Thử lại sau ít phút.';
export const CARE_BLOCKER_PAGE_UNSUPPORTED =
  'Máy chủ chưa bật kết nối Page Facebook. Page chưa kết nối; chế độ thử không gửi tin.';

export const CARE_MODE_REASON_PHASE =
  'Bản nháp ở đây không gửi tin. Tin Messenger chỉ được gửi khi chủ sở hữu hoặc quản lý bật "Tự động trả lời khách".';
export const CARE_MODE_REASON_PAGE = 'Chưa có Page Facebook đã xác minh với đủ quyền cho Chăm sóc khách hàng.';

export interface CareModeDecision {
  mode: 'shadow';
  outboundEnabled: false;
  reasons: string[];
}

function missingScopesBlocker(scopes: readonly string[]): string {
  return `Page Facebook còn thiếu quyền: ${scopes.join(', ')}. Hãy kết nối lại và cấp đủ quyền.`;
}

export function connectedPage(connection: CareFacebookConnection): CustomerCarePageConnection {
  return {
    state: 'connected',
    pageId: connection.pageId,
    pageName: connection.pageName,
    status: connection.status,
    missingScopes: [...connection.missingScopes],
    verifiedAt: connection.verifiedAt,
  };
}

/** 404 means the backend has no Care routes yet; every other failure is reported as unavailable. */
export function toCustomerCarePageConnection(
  result: CareFacebookResult<CareFacebookStatus>,
): CustomerCarePageConnection {
  if (!result.ok) return { state: result.error === 'unsupported' ? 'unsupported' : 'unavailable' };
  return result.value.connection ? connectedPage(result.value.connection) : { state: 'not_connected' };
}

function isReadyPage(connection: CustomerCarePageConnection): boolean {
  return connection.state === 'connected' && connection.status === 'active' && connection.missingScopes.length === 0;
}

export function derivePageBlockers(
  connection: CustomerCarePageConnection,
  setup: CustomerCareSetup | null,
): string[] {
  const manualPageId = setup !== null && setup.pageId !== '';
  switch (connection.state) {
    case 'connected': {
      const blockers: string[] = [];
      if (connection.status === 'needs_reauth') blockers.push(CARE_BLOCKER_PAGE_NEEDS_REAUTH);
      if (connection.missingScopes.length > 0) blockers.push(missingScopesBlocker(connection.missingScopes));
      if (!manualPageId) blockers.push(CARE_BLOCKER_PAGE_NOT_SAVED);
      else if (setup.pageId !== connection.pageId) blockers.push(CARE_BLOCKER_PAGE_MISMATCH);
      return blockers;
    }
    case 'not_connected':
      return [manualPageId ? CARE_BLOCKER_PAGE_UNVERIFIED : CARE_BLOCKER_PAGE_NOT_CONNECTED];
    case 'unavailable':
      return manualPageId
        ? [CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE, CARE_BLOCKER_PAGE_UNVERIFIED]
        : [CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE];
    case 'unsupported':
      return manualPageId ? [CARE_BLOCKER_PAGE_UNSUPPORTED, CARE_BLOCKER_PAGE_UNVERIFIED] : [CARE_BLOCKER_PAGE_UNSUPPORTED];
  }
}

/** Phase A: always shadow with outbound off; the reasons explain why to the operator. */
export function deriveCareMode(input: { pageConnection: CustomerCarePageConnection }): CareModeDecision {
  const reasons = [CARE_MODE_REASON_PHASE];
  if (!isReadyPage(input.pageConnection)) reasons.push(CARE_MODE_REASON_PAGE);
  return { mode: 'shadow', outboundEnabled: false, reasons };
}
