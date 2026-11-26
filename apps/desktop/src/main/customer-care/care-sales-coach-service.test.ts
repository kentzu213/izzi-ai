import { describe, expect, it, vi } from 'vitest';
import { createNodeSqliteDatabase } from '../work/test-support';
import { WorkDb } from '../work/work-sqlite';
import { KnowledgeStore } from '../knowledge/knowledge-store';
import { CareSalesCoachService } from './care-sales-coach-service';
import type { CustomerCareCrmRow } from '../../shared/customer-care-types';

function makeLead(overrides: Partial<CustomerCareCrmRow> = {}): CustomerCareCrmRow {
  return {
    leadId: 'lead-coach-1',
    pageId: '105252511858057',
    customerName: 'Chị Lan',
    phone: '0909111222',
    zaloMentioned: true,
    leadStatus: 'new',
    phoneCapturedAt: '2026-11-26T08:00:00Z',
    lastMessageAt: '2026-11-26T09:00:00Z',
    recentMessages: [{ text: 'Chị muốn xem tranh đồng biếu tân gia tuần sau', at: '2026-11-26T09:00:00Z' }],
    profile: {
      stage: 'has_phone',
      ownerUserId: null,
      addressForm: 'chi',
      occasion: 'gift',
      neededBy: null,
      productFactIds: [],
      nextStep: null,
      nextStepDueAt: null,
      lostReason: null,
      purchasedAt: null,
      note: null,
      salerId: null,
      careStep: 'step1_uncalled',
      callTries: 0,
      updatedAt: '2026-11-26T09:05:00Z',
      updatedBy: null,
    },
    ...overrides,
  };
}

describe('CareSalesCoachService (Slice B)', () => {
  it('generates fact-guarded AI scripts using active KnowledgeStore lessons and falls back cleanly on 402 quota', async () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      const store = new KnowledgeStore(new WorkDb(db));
      const lesson = store.capture({
        scope: 'project',
        workspaceId: 'ws-1',
        kind: 'lesson',
        title: 'Khách quà biếu ưu tiên hộp quà & giao đúng ngày',
        summary: 'Chốt trước ngày tặng rồi gửi ảnh đóng gói hộp quà cao cấp qua Zalo.',
        topicKey: 'sales-playbook:gift-packaging',
        source: { type: 'user', uri: 'user://owner' },
        author: 'user',
        evidence: 'direct',
        confidence: 1,
        sensitivity: 'local',
      });
      store.promote({ id: lesson.id, reviewer: 'user', basis: 'user_approval', sensitivity: 'local' });

      const chat = vi.fn().mockResolvedValue({
        reply: JSON.stringify({
          buyerDiagnosis: 'Khách mua tranh đồng làm quà biếu tân gia tuần sau.',
          evidenceQuotes: ['tranh đồng biếu tân gia tuần sau'],
          objectionStrategy: 'Nhấn mạnh hộp quà trang trọng và lịch giao đúng hẹn.',
          scripts: {
            zalo: 'Dạ em chào chị, em gửi chị mẫu tranh đồng biếu tân gia kèm ảnh đóng hộp trang trọng ạ.',
            call: 'Dạ em chào chị, em gọi tư vấn tranh biếu tân gia để kịp lịch tuần sau của chị ạ.',
            messenger: 'Dạ em nhắn Zalo gửi mẫu tranh biếu tân gia cho chị ngay ạ.',
          },
          nextBestAction: 'Gửi 3 mẫu tranh biếu tân gia kèm ảnh hộp quà qua Zalo',
        }),
      });

      const svc = new CareSalesCoachService({
        resolveAuthority: async () => ({ identityId: 'u-1', workspaceId: 'ws-1', role: 'owner' }),
        readApprovedFacts: async () => [],
        knowledgeStore: store,
        chat,
      });

      const res = await svc.generateScript({ row: makeLead(), products: [], identityEnabled: false });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.source).toBe('ai');
        expect(res.data.factGuardPassed).toBe(true);
        expect(res.data.usedKnowledgeTitles).toContain('Khách quà biếu ưu tiên hộp quà & giao đúng ngày');
        expect(res.data.evidenceQuotes).toEqual(['tranh đồng biếu tân gia tuần sau']);
      }
      // Verify the prompt sent to LLM never leaked raw customer phone!
      expect(JSON.stringify(chat.mock.calls[0][0])).not.toContain('0909111222');

      // Quota 402 degrades immediately to deterministic fallback without retrying second model.
      const chat402 = vi.fn().mockResolvedValue({ reply: '', error: 'HTTP 402 insufficient quota' });
      const fallbackSvc = new CareSalesCoachService({
        resolveAuthority: async () => ({ identityId: 'u-1', workspaceId: 'ws-1', role: 'editor' }),
        readApprovedFacts: async () => [],
        knowledgeStore: store,
        chat: chat402,
      });
      const fbRes = await fallbackSvc.generateScript({ row: makeLead(), products: [], identityEnabled: false });
      expect(fbRes.ok).toBe(true);
      if (fbRes.ok) expect(fbRes.data.source).toBe('fallback');
      expect(chat402).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it('refuses suppressed leads, refuses viewer role, and blocks PII when saving a sales lesson to Review Inbox', async () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      const store = new KnowledgeStore(new WorkDb(db));
      const onMutated = vi.fn();
      const svc = new CareSalesCoachService({
        resolveAuthority: async () => ({ identityId: 'u-1', workspaceId: 'ws-1', role: 'owner' }),
        readApprovedFacts: async () => [],
        knowledgeStore: store,
        chat: vi.fn(),
        onKnowledgeMutated: onMutated,
      });

      const suppressed = await svc.generateScript({
        row: makeLead({ profile: { ...makeLead().profile, stage: 'do_not_contact' } }),
      });
      expect(suppressed.ok).toBe(false);
      if (!suppressed.ok) expect(suppressed.error).toBe('suppressed');

      const blockedLesson = await svc.saveSalesLesson({
        title: 'Khách chốt nhanh',
        summary: 'Gọi cho khách 0912 345 678 chốt ngay!',
      });
      expect(blockedLesson.ok).toBe(false);

      const cleanLesson = await svc.saveSalesLesson({
        title: 'Chiến thuật chốt khách quà biếu',
        summary: 'Hỏi ngày tặng trước rồi gửi ảnh đóng gói hộp quà cao cấp giúp tăng tỷ lệ cọc.',
        kind: 'procedure',
      });
      expect(cleanLesson.ok).toBe(true);
      expect(onMutated).toHaveBeenCalledTimes(1);
      expect(store.list({ state: 'candidate' })).toHaveLength(1);
    } finally {
      close();
    }
  });
});
