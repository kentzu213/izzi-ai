import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./ConversationSurface.tsx', import.meta.url)), 'utf8');

describe('ConversationSurface', () => {
  it('shares the project-chat scope so its composer, selects and bubbles get V2 styling', () => {
    expect(source).toContain('className="v2-surface v2-conversation v2-project-chat"');
  });

  it('lets the user pick the model for the open conversation', () => {
    expect(source).toContain('<ModelSelector');
    expect(source).toContain('modelGroupsFor(');
    expect(source).toContain('setActiveModel(model, provider)');
    expect(source).toContain('refreshAvailableModels()');
  });

  it('surfaces model connection errors as an alert', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('{errorMessage}');
  });
});
