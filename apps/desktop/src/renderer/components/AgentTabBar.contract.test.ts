import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./AgentTabBar.tsx', import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');
const sourceFile = ts.createSourceFile(
  'AgentTabBar.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function hasNestedButton(): boolean {
  let nestedButtonFound = false;

  function containsButton(node: ts.Node): boolean {
    let buttonFound = false;
    node.forEachChild((child) => {
      if (
        (ts.isJsxElement(child) && child.openingElement.tagName.getText(sourceFile) === 'button') ||
        (ts.isJsxSelfClosingElement(child) && child.tagName.getText(sourceFile) === 'button')
      ) {
        buttonFound = true;
        return;
      }

      if (containsButton(child)) buttonFound = true;
    });
    return buttonFound;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'button') {
      if (node.children.some(containsButton)) nestedButtonFound = true;
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return nestedButtonFound;
}

describe('AgentTabBar HTML and keyboard contract', () => {
  it('uses a tab container so the close command is never nested in a button', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-selected={session.id === activeSessionId}');
    expect(source).toContain('tabIndex={session.id === activeSessionId ? 0 : -1}');
    expect(source).toContain('aria-label={`Đóng tab ${session.agentName}`}');
    expect(hasNestedButton()).toBe(false);
  });

  it('keeps session switching available from Enter and Space', () => {
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('onSwitchSession(session.id)');
  });
});
