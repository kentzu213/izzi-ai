import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrmGraphBoundary } from './CustomerCrmGraphSlot';

function findButton(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.type === 'button') return element as ReactElement<{ onClick: () => void }>;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  for (const child of children as ReactNode[]) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
}

describe('CrmGraphBoundary (the lazy graph cannot take the page down)', () => {
  it('renders the graph while nothing failed', () => {
    const html = renderToStaticMarkup(createElement(CrmGraphBoundary, { onRetry: () => undefined, children: createElement('p', null, 'sơ đồ') }));
    expect(html).toBe('<p>sơ đồ</p>');
  });

  it('turns a failed chunk or render into "Không tải được sơ đồ" with "Thử lại", which resets and retries', () => {
    const onRetry = vi.fn();
    const boundary = new CrmGraphBoundary({ onRetry, children: createElement('p', null, 'sơ đồ') });
    boundary.state = CrmGraphBoundary.getDerivedStateFromError(new Error('Failed to fetch dynamically imported module'));
    const fallback = boundary.render();
    const html = renderToStaticMarkup(fallback as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Không tải được sơ đồ');
    expect(html).toContain('>Thử lại</button>');
    expect(html).not.toContain('sơ đồ</p>');

    const setState = vi.fn();
    boundary.setState = setState as typeof boundary.setState;
    findButton(fallback)!.props.onClick();
    expect(setState).toHaveBeenCalledWith({ failed: false });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
