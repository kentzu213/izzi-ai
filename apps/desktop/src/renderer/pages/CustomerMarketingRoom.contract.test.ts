import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const roomPath = fileURLToPath(new URL('./CustomerMarketingRoom.tsx', import.meta.url));
const roomSource = readFileSync(roomPath, 'utf8');

describe('Customer Marketing Room Product Context editor contract', () => {
  it('keeps BrandView mounted while another workspace view is active', () => {
    expect(roomSource).toMatch(
      /<div\s+hidden=\{activeView !== 'brand'\}\s+aria-hidden=\{activeView !== 'brand'\}\s*>[\s\S]*?<BrandView[\s\S]*?<\/div>/,
    );
    expect(roomSource).not.toContain("{activeView === 'brand' && (\n            <BrandView");
  });

  it('labels the monthly quota as credits instead of a number of months', () => {
    expect(roomSource).toContain("monthlyQuota.toLocaleString('vi-VN')} credit/tháng");
    expect(roomSource).not.toContain("monthlyQuota.toLocaleString('vi-VN')} tháng");
  });
});
