import { describe, expect, it } from 'vitest';
import { PROJECT_TONE_COUNT, projectTone } from './projectTone';

describe('projectTone', () => {
  it('returns the same tone for the same project id', () => {
    expect(projectTone('project-abc')).toBe(projectTone('project-abc'));
  });

  it('always stays within the six tile tones', () => {
    for (const id of ['', 'a', 'p1', 'p2', 'Chiến dịch A', 'f3b9c2d0-1234-4abc-9def-000000000000']) {
      const tone = projectTone(id);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(PROJECT_TONE_COUNT);
    }
  });

  it('spreads different ids over more than one tone', () => {
    const tones = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(projectTone));
    expect(tones.size).toBeGreaterThan(1);
  });
});
