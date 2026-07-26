import { describe, expect, it } from 'vitest';
import { isVerifiedZeroSpend, parseCsv, parseHumanGates } from './marketing-workspace';

describe('parseCsv', () => {
  it('parses quoted commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('id,title,notes\r\n1,"Demo, launch","He said ""go"""\r\n');
    expect(rows).toEqual([{ id: '1', title: 'Demo, launch', notes: 'He said "go"' }]);
  });

  it('keeps new lines inside quoted fields', () => {
    const rows = parseCsv('id,copy\n1,"line one\nline two"\n');
    expect(rows[0]).toEqual({ id: '1', copy: 'line one\nline two' });
  });

  it('removes a UTF-8 BOM from the first header', () => {
    expect(parseCsv('\uFEFFid,status\nMKT-001,done\n')).toEqual([{ id: 'MKT-001', status: 'done' }]);
  });

  it('requires evidence and a named human for zero-spend verification', () => {
    expect(isVerifiedZeroSpend({
      verified_no_spend: 'true',
      reviewer: 'Nguyen Van A',
      review_date: '2026-07-16',
      source_checked: 'billing portal',
    })).toBe(true);
    expect(isVerifiedZeroSpend({
      verified_no_spend: 'true',
      reviewer: 'AI Agent',
      review_date: '2026-07-16',
      source_checked: 'billing portal',
    })).toBe(false);
  });
});
describe('parseHumanGates', () => {
  it('maps current gates and keeps external actions fail-closed', () => {
    const gates = parseHumanGates(JSON.stringify({
      external_actions_allowed: false,
      gates: [{
        id: 'seo_06_review',
        source_id: 'seo_starizzi-autopost-workflow',
        status: 'pending_named_human_review',
        source: 'seo/06-starizzi-autopost-workflow.md',
        proof_assets: 7,
        noindex: true,
        publish_allowed: false,
      }],
    }));
    expect(gates).toEqual([expect.objectContaining({
      kind: 'seo',
      sourcePath: 'seo/06-starizzi-autopost-workflow.md',
      externalActionsAllowed: false,
    })]);
  });

  it('falls back to the handoff file for unsafe paths and rejects malformed JSON', () => {
    const gates = parseHumanGates(JSON.stringify({
      gates: [{ id: 'weekly_spend_close', source_id: 'week', status: 'pending', packet: '../../outside.txt' }],
    }));
    expect(gates[0].sourcePath).toBe('tasks/HUMAN-GATES-NOW.md');
    expect(parseHumanGates('{bad')).toEqual([]);
  });
});