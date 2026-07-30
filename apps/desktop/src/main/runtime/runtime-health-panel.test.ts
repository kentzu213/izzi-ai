import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeHealthPanel } from '../../renderer/shell/RuntimeHealthPanel';

describe('RuntimeHealthPanel', () => {
  it('renders a fail-closed loading state without starting a runtime', () => {
    const html = renderToStaticMarkup(React.createElement(RuntimeHealthPanel));
    expect(html).toContain('Runtime health');
    expect(html).toContain('Checking managed runtimes');
    expect(html).not.toContain('Start');
  });
});
