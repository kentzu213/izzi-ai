import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * M1 token layer contract (izzi-ai-redesign-handoff-v1 spec/02, 05, 06).
 *
 * 1. Isolation: every rule in styles/v2/*.css is scoped to `.izzi-v2` and every
 *    custom property uses the `--v2-` prefix, so nothing outside a v2 subtree
 *    can change (spec/06 M1 acceptance). The exceptions are skin.css and legacy.css
 *    remapping legacy variables, which must keep their names to take effect.
 * 2. Fidelity: the dark and light token values match spec/02.
 */

const V2_DIR = fileURLToPath(new URL('./', import.meta.url));

interface CssRule {
  file: string;
  selector: string;
  declarations: Map<string, string>;
}

function parseRules(file: string): CssRule[] {
  const css = readFileSync(`${V2_DIR}${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const part of match[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().toLowerCase());
    }
    rules.push({ file, selector: match[1].trim(), declarations });
  }
  return rules;
}

const cssFiles = readdirSync(V2_DIR).filter((name) => name.endsWith('.css'));
const allRules = cssFiles.flatMap(parseRules);

function tokensFor(selector: string): Map<string, string> {
  const rule = allRules.find((candidate) => candidate.selector === selector);
  if (!rule) throw new Error(`missing rule ${selector}`);
  return rule.declarations;
}

/** Splits a selector list on its top-level commas, so `:is(a, b)` stays one selector. */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

// skin.css re-skins the legacy Agent Marketing `--cmr-*` custom properties, and legacy.css the index.css
// and izzi-optimized.css globals, from V2 tokens. They must keep their legacy names for the old stylesheets
// to read them; the scoping test guarantees each declaration sits under `.izzi-v2`, so nothing outside a v2
// subtree can change.
const LEGACY_PREFIXES = ['--color-', '--izzi-', '--izzo-', '--glass-', '--radius-', '--shadow-', '--font-', '--gradient-'];
const isLegacyRemap = (rule: CssRule, name: string) =>
  (rule.file === 'skin.css' && name.startsWith('--cmr-')) ||
  (rule.file === 'legacy.css' && LEGACY_PREFIXES.some((prefix) => name.startsWith(prefix)));

describe('v2 token isolation', () => {
  it('finds the v2 stylesheets', () => {
    expect(cssFiles).toContain('tokens.css');
    expect(allRules.length).toBeGreaterThan(0);
  });

  it('scopes every selector to .izzi-v2', () => {
    const unscoped = allRules
      .flatMap((rule) => splitSelectorList(rule.selector).map((selector) => `${rule.file}: ${selector.trim()}`))
      .filter((entry) => !/^[^:]+: \.izzi-v2(?![\w-])/.test(entry));
    expect(unscoped).toEqual([]);
  });

  it('prefixes every custom property with --v2-', () => {
    const foreign = allRules.flatMap((rule) =>
      [...rule.declarations.keys()]
        .filter((name) => name.startsWith('--') && !name.startsWith('--v2-') && !isLegacyRemap(rule, name))
        .map((name) => `${rule.file}: ${name}`),
    );
    expect(foreign).toEqual([]);
  });
});

describe('v2 token values match spec/02', () => {
  const dark = tokensFor('.izzi-v2');
  const light = tokensFor(".izzi-v2[data-theme='light']");

  it('defines the dark palette', () => {
    expect(Object.fromEntries(dark)).toMatchObject({
      'color-scheme': 'dark',
      '--v2-bg-canvas': '#17181c',
      '--v2-bg-deep': '#101115',
      '--v2-bg-panel': '#1d1e23',
      '--v2-bg-panel-hover': '#24252b',
      '--v2-border-default': 'rgba(255, 255, 255, 0.08)',
      '--v2-border-strong': 'rgba(255, 255, 255, 0.14)',
      '--v2-text-primary': '#f4f2f7',
      '--v2-text-secondary': '#aaa7b2',
      '--v2-text-muted': '#777480',
      '--v2-shadow': '0 12px 32px rgba(0, 0, 0, 0.2)',
    });
  });

  it('overrides the palette for light without leaking dark-only surfaces', () => {
    expect(Object.fromEntries(light)).toMatchObject({
      'color-scheme': 'light',
      '--v2-bg-canvas': '#f6f6f9',
      '--v2-bg-panel': '#ffffff',
      '--v2-bg-subtle': '#f1f0f5',
      '--v2-bg-deep': 'initial',
      '--v2-bg-panel-hover': 'initial',
      '--v2-border-default': '#e7e5ec',
      '--v2-border-strong': '#d8d4e1',
      '--v2-text-primary': '#1e1c24',
      '--v2-text-secondary': '#6f6a79',
      '--v2-text-muted': '#9993a3',
      '--v2-shadow': '0 8px 24px rgba(31, 24, 45, 0.06)',
    });
  });

  it('defines brand, semantic, radius, spacing and layout tokens once', () => {
    expect(Object.fromEntries(dark)).toMatchObject({
      '--v2-brand-primary': '#7c4dff',
      '--v2-brand-primary-hover': '#6b3fea',
      '--v2-brand-soft': '#eee8ff',
      '--v2-brand-pink': '#e776f3',
      '--v2-brand-gradient': 'linear-gradient(90deg, #7c4dff, #e776f3)',
      '--v2-success': '#2bb673',
      '--v2-warning': '#eaa23a',
      '--v2-danger': '#e55363',
      '--v2-info': '#4d8dff',
      '--v2-radius-control': '8px',
      '--v2-radius-card': '12px',
      '--v2-radius-panel': '16px',
      '--v2-radius-pill': '999px',
      '--v2-layout-rail': '60px',
      '--v2-layout-navigator': '236px',
      '--v2-layout-inspector': '344px',
      '--v2-layout-titlebar': '42px',
      '--v2-layout-content-max': '1440px',
    });
    const spacing = [...dark.entries()]
      .filter(([name]) => name.startsWith('--v2-space-'))
      .map(([, value]) => value);
    expect(spacing).toEqual(['4px', '8px', '12px', '16px', '20px', '24px', '32px', '40px', '48px']);
    const themeIndependent = [...light.keys()].filter((name) =>
      /^--v2-(brand|success|warning|danger|info|radius|space|layout|font|text-\w+-(size|line))/.test(name),
    );
    expect(themeIndependent).toEqual([]);
  });

  it('defines the type scale as size/line-height pairs', () => {
    const scale = ['hero', 'page', 'section', 'body-strong', 'body', 'meta', 'label'].map(
      (step) => `${dark.get(`--v2-text-${step}-size`)}/${dark.get(`--v2-text-${step}-line`)}`,
    );
    expect(scale).toEqual(['32px/38px', '24px/30px', '18px/24px', '15px/22px', '14px/20px', '12px/16px', '11px/14px']);
  });
});
