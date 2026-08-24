import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const resourcesPath = fileURLToPath(new URL('./CustomerMarketingResources.tsx', import.meta.url));
const resourcesSource = readFileSync(resourcesPath, 'utf8');
const preloadPath = fileURLToPath(new URL('../../main/preload.ts', import.meta.url));
const preloadSource = readFileSync(preloadPath, 'utf8');
const rendererTypesPath = fileURLToPath(new URL('../types/global.d.ts', import.meta.url));
const rendererTypesSource = readFileSync(rendererTypesPath, 'utf8');
const stylesPath = fileURLToPath(new URL('../styles/customer-marketing-resources.css', import.meta.url));
const stylesSource = readFileSync(stylesPath, 'utf8');
const ipcPath = fileURLToPath(new URL('../../main/customer-marketing/customer-marketing-ipc.ts', import.meta.url));
const ipcSource = readFileSync(ipcPath, 'utf8');

describe('CustomerMarketingResources CMR-407 decision history contract', () => {
  it('exposes exactly one read-only audit bridge across preload, types and IPC', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:listMarketingResourceAudit', input)");
    expect(preloadSource.match(/customerMarketing:listMarketingResourceAudit/g)).toHaveLength(1);
    expect(rendererTypesSource).toContain('listMarketingResourceAudit: (');
    expect(rendererTypesSource).toContain('CustomerMarketingResourceAuditResult');
    expect(ipcSource).toContain("ipcMain.handle('customerMarketing:listMarketingResourceAudit'");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('customerMarketing:writeMarketingResourceAudit'");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('customerMarketing:listMarketingResourceAudit', workspaceId");
  });

  it('parses the audit payload behind the trusted sender guard in main', () => {
    const handler = ipcSource.slice(ipcSource.indexOf("ipcMain.handle('customerMarketing:listMarketingResourceAudit'"));
    const body = handler.slice(0, handler.indexOf('});'));
    expect(body).toContain('trusted(event)');
    expect(body).toContain('parseMarketingResourceAuditInput(payload)');
    expect(body).toContain('Payload audit marketing');
    expect(body.indexOf('trusted(event)')).toBeLessThan(body.indexOf('parseMarketingResourceAuditInput(payload)'));
  });

  it('sends only the on-screen resource identity and never renderer tenant scope', () => {
    expect(resourcesSource).toContain('api.listMarketingResourceAudit(auditTarget)');
    expect(resourcesSource).toContain('{ kind: selected.kind, resourceId: selected.id }');
    expect(resourcesSource).toContain("selected.kind === 'campaign' || selected.kind === 'content'");
    expect(resourcesSource).not.toContain('workspaceId');
    expect(resourcesSource).not.toContain('accessToken');
    expect(resourcesSource).not.toContain('authorityToken');
  });

  it('keeps the audit pane read-only and free of any review or mutation action', () => {
    const trail = resourcesSource.slice(
      resourcesSource.indexOf('function ResourceAuditTrail'),
      resourcesSource.indexOf('function ResourceDetail'),
    );
    expect(trail).toContain('aria-label="Lịch sử quyết định"');
    expect(trail).not.toContain('<button');
    expect(trail).not.toContain('onClick');
    expect(trail).not.toContain('api.');
  });

  it('paints decision, transition evidence, receipt hash and time without secret material', () => {
    expect(resourcesSource).toContain('AUDIT_ACTION_LABELS[receipt.action]');
    expect(resourcesSource).toContain('STATUS_LABELS[receipt.toStatus]');
    expect(resourcesSource).toContain('formatDate(receipt.occurredAt, true)');
    expect(resourcesSource).toContain('dateTime={receipt.occurredAt}');
    expect(resourcesSource).toContain('receipt.receiptDigest.slice(0, 16)');
    expect(resourcesSource).toContain('revision r{receipt.revision}');
    expect(resourcesSource).not.toContain('reviewerHash');
  });

  it('states an explicit loading, unavailable and empty state for the audit trail', () => {
    expect(resourcesSource).toContain("status: 'idle' | 'loading' | 'ready' | 'unavailable'");
    expect(resourcesSource).toContain('Đang tải lịch sử quyết định...');
    expect(resourcesSource).toContain('Lịch sử quyết định cần chạy trong Izzi AI Desktop.');
    expect(resourcesSource).toContain('Chưa có quyết định nào được ghi nhận cho revision này.');
    expect(resourcesSource).toContain("message: result.error || bridgeMessage(result.status)");
    expect(resourcesSource).toContain('cmrr-audit__note--warn');
  });

  it('styles the audit section it renders', () => {
    for (const selector of [
      '.cmrr-audit {',
      '.cmrr-audit__heading {',
      '.cmrr-audit__note {',
      '.cmrr-audit__note--warn {',
      '.cmrr-audit__list {',
      '.cmrr-audit__item {',
      '.cmrr-audit__transition {',
      '.cmrr-audit__time {',
      '.cmrr-audit__hash {',
    ]) {
      expect(stylesSource).toContain(selector);
    }
  });

  it('integrates private video selection and upload without exposing a local path to the renderer', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:selectMarketingAssetVideo')");
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:uploadMarketingAssetVideo', input)");
    expect(rendererTypesSource).toContain('selectMarketingAssetVideo: ()');
    expect(rendererTypesSource).toContain('uploadMarketingAssetVideo: (');
    expect(ipcSource).toContain("ipcMain.handle('customerMarketing:selectMarketingAssetVideo'");
    expect(ipcSource).toContain("ipcMain.handle('customerMarketing:uploadMarketingAssetVideo'");
    expect(resourcesSource).toContain('api.selectMarketingAssetVideo()');
    expect(resourcesSource).toContain('api.uploadMarketingAssetVideo({');
    expect(resourcesSource).toContain('selectionId: assetSelection!.selectionId');
    expect(resourcesSource).toContain('Tạo và tải video');
    expect(resourcesSource).toContain('Video được tải riêng tư');
    expect(resourcesSource).not.toContain('type="file"');
    expect(resourcesSource).not.toContain('filePath');
    expect(resourcesSource).not.toContain('sourcePath');
    expect(stylesSource).toContain('.cmrr-asset-picker {');
  });

  it('exposes one read-only Auto Post reconciliation path without renderer file access', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:selectLegacyAutoPostManifest')");
    expect(preloadSource.match(/customerMarketing:selectLegacyAutoPostManifest/g)).toHaveLength(1);
    expect(rendererTypesSource).toContain('selectLegacyAutoPostManifest: ()');
    expect(ipcSource).toContain("ipcMain.handle('customerMarketing:selectLegacyAutoPostManifest'");
    expect(ipcSource).toContain("filters: [{ name: 'Auto Post migration', extensions: ['json'] }]");
    expect(resourcesSource).toContain('api.selectLegacyAutoPostManifest()');
    expect(resourcesSource).toContain('Đối soát Auto Post');
    expect(resourcesSource).not.toContain('type="file"');
    expect(resourcesSource).not.toContain('legacyFilePath');
  });

  it('keeps the Auto Post reconciliation drawer preview-only', () => {
    expect(resourcesSource).toContain('Chỉ đọc, chưa nhập dữ liệu');
    expect(resourcesSource).toContain('Kết nối lại');
    expect(resourcesSource).toContain('Tải lại media');
    expect(resourcesSource).toContain('Cần xem xét');
    expect(resourcesSource).not.toContain('executeLegacyAutoPostImport');
    expect(resourcesSource).not.toContain('importLegacyAutoPost');
    expect(stylesSource).toContain('.cmrr-import-summary {');
    expect(stylesSource).toContain('.cmrr-import-plan {');
  });
});
