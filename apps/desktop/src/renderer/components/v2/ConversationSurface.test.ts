import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ConversationSurface', () => {
  it('shares the project-chat scope so its composer, selects and bubbles get V2 styling', () => {
    const source = readFileSync(fileURLToPath(new URL('./ConversationSurface.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('className="v2-surface v2-conversation v2-project-chat"');
  });
});
