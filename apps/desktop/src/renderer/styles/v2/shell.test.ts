import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * M2 shell cascade contract. The button reset must never outrank the
 * component rules that give rail/navigator/header/inspector buttons their
 * padding and color (audit: `.izzi-v2 .v2-navigator button` (0,2,1) beat
 * `.izzi-v2 .v2-navigator__item` (0,2,0)).
 */

const css = readFileSync(fileURLToPath(new URL('./shell.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  declarations: Map<string, string>;
}

const rules: Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
  const declarations = new Map<string, string>();
  for (const part of match[2].split(';')) {
    const colon = part.indexOf(':');
    if (colon !== -1) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return match[1].split(',').map((selector) => ({ selector: selector.trim(), declarations }));
});

type Specificity = [number, number, number];

/** Enough of Selectors Level 4 for this file: :where() counts zero. */
function specificity(selector: string): Specificity {
  const rest = selector.replace(/:where\([^)]*\)/g, ' ').replace(/::[\w-]+/g, ' ');
  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  const classes = (rest.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (rest.replace(/[.#:][\w-]+|\[[^\]]*\]/g, ' ').match(/[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, types];
}

function compare(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const REGIONS = ['v2-rail', 'v2-navigator', 'v2-header', 'v2-inspector'];
const COMPONENT_BUTTONS = [
  '.v2-rail__item',
  '.v2-navigator__item',
  '.v2-navigator__close',
  '.v2-navigator__recent',
  '.v2-header__toggle',
  '.v2-inspector__close',
];

// The `button` type selector only; `\b` would also match class names like `.v2-button`.
const resetRules = rules.filter((rule) => /(^|[\s>+~])button$/.test(rule.selector));

describe('v2 shell button reset', () => {
  it('covers every shell region through :where()', () => {
    for (const region of REGIONS) {
      expect(resetRules.map((rule) => rule.selector)).toContain(`.izzi-v2 :where(.${region}) button`);
    }
    expect(rules.filter((rule) => /\.v2-(rail|navigator|header|inspector) button/.test(rule.selector))).toEqual([]);
  });

  it('loses to every component rule that sets padding or color', () => {
    const componentRules = rules.filter(
      (rule) =>
        COMPONENT_BUTTONS.some((name) => new RegExp(`${name.replace('.', '\\.')}$`).test(rule.selector)) &&
        (rule.declarations.has('padding') || rule.declarations.has('color')),
    );
    expect(componentRules.map((rule) => rule.selector)).toEqual(
      expect.arrayContaining(COMPONENT_BUTTONS.map((name) => `.izzi-v2 ${name}`)),
    );

    const outranked = resetRules.flatMap((reset) =>
      componentRules
        .filter((component) => compare(specificity(reset.selector), specificity(component.selector)) >= 0)
        .map((component) => `${reset.selector} >= ${component.selector}`),
    );
    expect(outranked).toEqual([]);
  });

  it('keeps the audited regression detectable', () => {
    expect(compare(specificity('.izzi-v2 .v2-navigator button'), specificity('.izzi-v2 .v2-navigator__item'))).toBeGreaterThan(0);
    expect(compare(specificity('.izzi-v2 :where(.v2-navigator) button'), specificity('.izzi-v2 .v2-navigator__item'))).toBeLessThan(0);
  });
});

describe('v2 shell drawer and update indicator styles', () => {
  it('overlays the drawer beside the rail without reserving workspace width', () => {
    const drawer = rules.find((rule) => rule.selector === '.izzi-v2 .v2-navigator.v2-navigator--drawer');
    expect(drawer?.declarations.get('position')).toBe('absolute');
    expect(drawer?.declarations.get('left')).toBe('var(--v2-layout-rail)');
    expect(rules.some((rule) => rule.selector === '.izzi-v2 .v2-drawer-scrim')).toBe(true);
  });

  it('styles the extension badge and the header dot', () => {
    expect(rules.some((rule) => rule.selector === '.izzi-v2 .v2-navigator__badge')).toBe(true);
    expect(rules.some((rule) => rule.selector === '.izzi-v2 .v2-header__dot')).toBe(true);
  });
});

describe('v2 Home and Projects surface styles (M3-A)', () => {
  const SURFACE_SELECTORS = [
    '.v2-visually-hidden',
    '.v2-surface',
    '.v2-surface__title',
    '.v2-home__composer',
    '.v2-home__prompt',
    '.v2-button',
    '.v2-button--primary',
    '.v2-chip',
    '.v2-card-grid',
    '.v2-project-row',
    '.v2-tab.is-active',
    '.v2-empty',
    '.v2-header__project-select',
  ];

  it('scopes every surface rule under .izzi-v2', () => {
    for (const name of SURFACE_SELECTORS) {
      expect(rules.map((rule) => rule.selector)).toContain(`.izzi-v2 ${name}`);
    }
    expect(rules.filter((rule) => /^\.v2-(surface|home|project|button|chip|tab|empty)/.test(rule.selector))).toEqual([]);
  });
});

describe('v2 project workspace styles (M3-B1)', () => {
  const WORKSPACE_SELECTORS = [
    '.v2-project-tabs',
    '.v2-project-panel',
    '.v2-project-overview',
    '.v2-project-runs',
    '.v2-project-feed',
    '.v2-project-feed__item',
    '.v2-project-feed__meta',
    '.v2-project-steps',
    '.v2-project-chat',
    '.v2-project-chat__bar',
    '.v2-project-chat__thread',
  ];

  it('scopes every workspace rule under .izzi-v2', () => {
    for (const name of WORKSPACE_SELECTORS) {
      expect(rules.map((rule) => rule.selector)).toContain(`.izzi-v2 ${name}`);
    }
  });

  it('forces feed text colors past the legacy text overrides', () => {
    for (const name of ['.v2-project-feed__item', '.v2-project-feed__meta', '.v2-project-steps']) {
      const colored = rules.filter((rule) => rule.selector === `.izzi-v2 ${name}` && rule.declarations.has('color'));
      expect(colored.length).toBeGreaterThan(0);
      for (const rule of colored) {
        expect(rule.declarations.get('color')).toMatch(/^var\(--v2-[a-z-]+\) !important$/);
        expect(rule.declarations.get('-webkit-text-fill-color')).toBe('currentColor !important');
      }
    }
  });
});

/*
 * Computed-style regression for the M3-A light/dark leak: legacy
 * `.main-content { background: transparent !important }` exposed the dark body
 * behind Home/Projects, and legacy `input, textarea, select` `!important` rules
 * painted dark fields and pinned -webkit-text-fill-color. The overrides must
 * win with existing tokens only and stay scoped to the V2 surfaces.
 */
describe('v2 surface legacy-leak overrides (M3-A)', () => {
  /** Later rules for the exact selector win, like the cascade at equal specificity. */
  const declarationsFor = (selector: string): Map<string, string> => {
    const merged = new Map<string, string>();
    for (const rule of rules.filter((candidate) => candidate.selector === selector)) {
      for (const [property, value] of rule.declarations) merged.set(property, value);
    }
    return merged;
  };

  const SURFACE = '.izzi-v2 .v2-workspace--surface';
  const CONTROLS = [
    `${SURFACE} .v2-field__select`,
    `${SURFACE} .v2-field__input`,
    `${SURFACE} .v2-home__prompt`,
    '.izzi-v2 .v2-header__project-select',
  ];

  it('paints the surface backdrop over the transparent legacy .main-content', () => {
    expect(declarationsFor(SURFACE).get('background')).toBe('var(--v2-bg-canvas) !important');
  });

  it('gives every surface control token color, fill color and background', () => {
    for (const selector of CONTROLS) {
      const declarations = declarationsFor(selector);
      expect(declarations.get('color'), selector).toBe('var(--v2-text-primary) !important');
      expect(declarations.get('-webkit-text-fill-color'), selector).toBe('currentColor !important');
      expect(declarations.get('background'), selector).toMatch(/!important$/);
    }
  });

  it('falls back to the panel token where light leaves --v2-bg-deep initial', () => {
    for (const selector of [`${SURFACE} .v2-field__select`, `${SURFACE} .v2-field__input`]) {
      expect(declarationsFor(selector).get('background')).toBe('var(--v2-bg-deep, var(--v2-bg-panel)) !important');
    }
  });

  it('keeps a visible token focus ring on every surface control', () => {
    for (const selector of CONTROLS) {
      expect(declarationsFor(`${selector}:focus-visible`).get('outline'), selector).toBe(
        '2px solid var(--v2-brand-primary) !important',
      );
    }
  });

  it('keeps a single focus-visible rule for the header project select (M8)', () => {
    const focus = rules.filter((rule) => rule.selector === '.izzi-v2 .v2-header__project-select:focus-visible');

    expect(focus).toHaveLength(1);
  });

  it('keeps Home/Projects paragraph copy on the secondary token over the legacy global p rule', () => {
    // Legacy izzi-optimized.css `p { color: var(--izzo-muted) !important }` rendered
    // near-white empty-state copy on the light canvas (audit 06:17).
    for (const selector of ['.izzi-v2 .v2-empty', '.izzi-v2 .v2-empty p', '.izzi-v2 .v2-surface__status']) {
      const declarations = declarationsFor(selector);
      expect(declarations.get('color'), selector).toBe('var(--v2-text-secondary) !important');
      expect(declarations.get('-webkit-text-fill-color'), selector).toBe('currentColor !important');
    }
    expect(compare(specificity('.izzi-v2 .v2-empty p'), specificity('p'))).toBeGreaterThan(0);
  });

  it('never targets bare elements, legacy pages or the legacy .main-content', () => {
    const offenders = rules.filter(
      (rule) =>
        /(^|[\s>+~(])(input|textarea|select)\b/.test(rule.selector) ||
        rule.selector.includes('.cmr-') ||
        rule.selector.includes('.main-content'),
    );
    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it('only styles the surface itself or V2 descendants under the surface modifier', () => {
    for (const rule of rules.filter((candidate) => candidate.selector.includes('v2-workspace--surface'))) {
      expect(rule.selector === SURFACE || rule.selector.startsWith(`${SURFACE} .v2-`), rule.selector).toBe(true);
    }
  });

  it('uses tokens, not raw colors, in every !important override', () => {
    const rawColors = rules.flatMap((rule) =>
      [...rule.declarations].filter(([, value]) => value.includes('!important') && value.includes('#')),
    );
    expect(rawColors).toEqual([]);
  });
});

describe('v2 Project Chat reset over the reused legacy chat (M3-B1 audit)', () => {
  const declarationsFor = (selector: string): Map<string, string> => {
    const merged = new Map<string, string>();
    for (const rule of rules.filter((candidate) => candidate.selector === selector)) {
      for (const [property, value] of rule.declarations) merged.set(property, value);
    }
    return merged;
  };

  const CHAT = '.izzi-v2 .v2-project-chat';
  const SURFACES = [`${CHAT} .chat-message-list`, `${CHAT} .chat-composer`];
  const BUBBLES = [
    `${CHAT} .chat-message__bubble`,
    `${CHAT} .chat-message__bubble--assistant`,
    `${CHAT} .chat-message__bubble--system`,
    `${CHAT} .chat-message__bubble--user`,
  ];
  const CONTROLS = [`${CHAT} .chat-composer__input`, `${CHAT} .chat-composer__perm-select`, `${CHAT} .v2-project-chat__select`];

  it('replaces the dark-glass list, composer and cyan bubbles with token surfaces', () => {
    // Light audit: the chat frame stayed dark glass and the user bubble cyan.
    for (const selector of [...SURFACES, ...BUBBLES]) {
      const declarations = declarationsFor(selector);
      expect(declarations.get('background'), selector).toMatch(/^var\(--v2-bg-[\w-]+.*\) !important$/);
      expect(declarations.get('border-color'), selector).toBe('var(--v2-border-default) !important');
      expect(declarations.get('box-shadow'), selector).toBe('none !important');
      expect(declarations.get('color'), selector).toBe('var(--v2-text-primary) !important');
      expect(declarations.get('-webkit-text-fill-color'), selector).toBe('currentColor !important');
    }
  });

  it('gives the composer textarea and selects token text and background over the global control rule', () => {
    // Light audit: controls rendered rgb(243,241,234) text on rgba(1,3,6,0.56).
    for (const selector of CONTROLS) {
      const declarations = declarationsFor(selector);
      expect(declarations.get('background'), selector).toBe('var(--v2-bg-deep, var(--v2-bg-panel)) !important');
      expect(declarations.get('border'), selector).toBe('1px solid var(--v2-border-default) !important');
      expect(declarations.get('color'), selector).toBe('var(--v2-text-primary) !important');
      expect(declarations.get('-webkit-text-fill-color'), selector).toBe('currentColor !important');
      expect(compare(specificity(selector), specificity('.chat-composer__input'))).toBeGreaterThan(0);
    }
  });

  it('keeps the placeholder muted and a token focus ring on every control', () => {
    const placeholder = declarationsFor(`${CHAT} .chat-composer__input::placeholder`);
    expect(placeholder.get('color')).toBe('var(--v2-text-muted) !important');
    expect(placeholder.get('-webkit-text-fill-color')).toBe('currentColor !important');
    for (const selector of CONTROLS) {
      expect(declarationsFor(`${selector}:focus-visible`).get('outline'), selector).toBe(
        '2px solid var(--v2-brand-primary) !important',
      );
      expect(declarationsFor(`${selector}:focus`).get('border-color'), selector).toBe('var(--v2-brand-primary) !important');
    }
    expect(declarationsFor(`${CHAT} .chat-composer:focus-within`).get('border-color')).toBe(
      'var(--v2-brand-primary) !important',
    );
  });

  it('scopes every legacy chat override to the V2 Project Chat only', () => {
    for (const rule of rules.filter((candidate) => /\.chat-(message|composer)/.test(candidate.selector))) {
      expect(rule.selector.startsWith(`${CHAT} .`), rule.selector).toBe(true);
    }
  });

  it('keeps navigator empty copy and inspector notes on role tokens over the global p rule', () => {
    const empty = declarationsFor('.izzi-v2 .v2-navigator__empty');
    expect(empty.get('color')).toBe('var(--v2-text-muted) !important');
    expect(empty.get('-webkit-text-fill-color')).toBe('currentColor !important');
    const note = declarationsFor('.izzi-v2 .v2-inspector__note');
    expect(note.get('color')).toBe('var(--v2-text-secondary) !important');
    expect(note.get('-webkit-text-fill-color')).toBe('currentColor !important');
  });
});

describe('v2 native select options', () => {
  // Dark audit: the native popup painted light option text on the default white list.
  const OPTION_SELECTORS = [
    '.izzi-v2 .v2-field__select option',
    '.izzi-v2 .v2-header__project-select option',
    '.izzi-v2 .v2-project-row__select option',
    '.izzi-v2 .v2-project-chat__select option',
    '.izzi-v2 .v2-project-chat .chat-composer__perm-select option',
  ];

  it.each(OPTION_SELECTORS)('paints %s on the panel token with primary text', (selector) => {
    const declarations = new Map(rules.filter((rule) => rule.selector === selector).flatMap((rule) => [...rule.declarations]));
    expect(declarations.get('background-color')).toBe('var(--v2-bg-panel)');
    expect(declarations.get('color')).toBe('var(--v2-text-primary)');
  });
});

describe('v2 conversation model selector', () => {
  // Beta.74 audit: legacy.css skips surface workspaces and index.css paints the
  // picker with unscoped !important glass, so V2 chats need their own override.
  const MS = '.izzi-v2 .v2-project-chat .model-selector';
  const declarationsFor = (selector: string) =>
    new Map(rules.filter((rule) => rule.selector === selector).flatMap((rule) => [...rule.declarations]));

  it('paints the trigger and its hover on panel tokens', () => {
    const trigger = declarationsFor(`${MS}__trigger`);
    expect(trigger.get('border')).toBe('1px solid var(--v2-border-strong) !important');
    expect(trigger.get('background')).toBe('var(--v2-bg-panel) !important');
    expect(trigger.get('color')).toBe('var(--v2-text-secondary) !important');

    const hover = declarationsFor(`${MS}__trigger:hover`);
    expect(hover.get('border-color')).toBe('var(--v2-border-strong) !important');
    expect(hover.get('background')).toBe('var(--v2-bg-panel-hover, var(--v2-bg-subtle)) !important');
    expect(hover.get('color')).toBe('var(--v2-text-primary) !important');
  });

  it('opens an opaque dropdown instead of the legacy glass panel', () => {
    const dropdown = declarationsFor(`${MS}__dropdown`);
    expect(dropdown.get('background')).toBe('var(--v2-bg-panel) !important');
    expect(dropdown.get('border')).toBe('1px solid var(--v2-border-strong) !important');
    expect(dropdown.get('border-radius')).toBe('var(--v2-radius-card) !important');
    expect(dropdown.get('box-shadow')).toBe('var(--v2-shadow) !important');
    expect(dropdown.get('backdrop-filter')).toBe('none !important');
    expect(dropdown.get('-webkit-backdrop-filter')).toBe('none !important');
  });

  it('marks the active option with the brand color', () => {
    const active = declarationsFor(`${MS}__option--active`);
    expect(active.get('background')).toBe('var(--v2-bg-subtle) !important');
    expect(active.get('border-color')).toBe('var(--v2-border-strong) !important');
    expect(active.get('color')).toBe('var(--v2-brand-primary) !important');
    expect(active.get('box-shadow')).toBe('none !important');
  });

  it('colors the picker with V2 tokens only', () => {
    const values = rules.filter((rule) => rule.selector.startsWith(MS)).flatMap((rule) => [...rule.declarations.values()]);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((value) => value.includes('#'))).toEqual([]);
  });
});

describe('v2 Project Chat detail controls (M3-B1 audit follow-up)', () => {
  // Light audit m3-chat-details-audit/1790555452591: steps, copy, composer
  // buttons, attachment menu and footer rendered legacy cream/dark values.
  const CHAT = '.izzi-v2 .v2-project-chat';
  const start = css.indexOf(`${CHAT} .chat-step__label {`);
  const detail = css.slice(start);
  const detailRules = rules.filter((rule) => rule.selector.startsWith(`${CHAT} .chat-`) && detail.includes(rule.selector));
  const declarationsFor = (selector: string): Map<string, string> => {
    const merged = new Map<string, string>();
    for (const rule of rules.filter((candidate) => candidate.selector === selector)) {
      for (const [property, value] of rule.declarations) merged.set(property, value);
    }
    return merged;
  };
  const HOVER = 'var(--v2-bg-panel-hover, var(--v2-bg-subtle)) !important';
  const COLORED = [
    ['.chat-step__label', 'var(--v2-text-primary) !important'],
    ['.chat-step__detail', 'var(--v2-text-secondary) !important'],
    ['.chat-step__glyph', 'var(--v2-text-secondary) !important'],
    ['.chat-step--running .chat-step__glyph', 'var(--v2-info) !important'],
    ['.chat-step--done .chat-step__glyph', 'var(--v2-success) !important'],
    ['.chat-step--error .chat-step__glyph', 'var(--v2-danger) !important'],
    ['.chat-message__copy', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__add', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__inject', 'var(--v2-text-primary) !important'],
    ['.chat-composer__submit', 'var(--v2-brand-soft) !important'],
    ['.chat-composer__stop', 'var(--v2-danger) !important'],
    ['.chat-composer__menu', 'var(--v2-text-primary) !important'],
    ['.chat-composer__menu-label', 'var(--v2-text-muted) !important'],
    ['.chat-composer__menu-hint', 'var(--v2-text-muted) !important'],
    ['.chat-composer__menu-item-label', 'var(--v2-text-primary) !important'],
    ['.chat-composer__menu-item-desc', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__footer', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__perm-icon', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__wd-btn', 'var(--v2-text-secondary) !important'],
    ['.chat-composer__wd-clear', 'var(--v2-text-secondary) !important'],
  ] as const;
  const BUTTONS = ['add', 'submit', 'stop', 'inject', 'menu-item', 'wd-btn', 'wd-clear'].map(
    (name) => `${CHAT} .chat-composer__${name}`,
  );

  it('keeps the follow-up block present, token-only and scoped to the V2 Project Chat', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(detail).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(detail).not.toContain('.cmr-');
    expect(detail).not.toContain('.main-content');
    for (const [, selectors] of detail.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of selectors.split(',')) {
        expect(selector.trim().startsWith(`${CHAT} .`), selector.trim()).toBe(true);
      }
    }
    expect(detailRules.length).toBeGreaterThan(0);
  });

  it('puts every rendered step, copy, composer, menu and footer element on a role token', () => {
    for (const [target, color] of COLORED) {
      const declarations = declarationsFor(`${CHAT} ${target}`);
      expect(declarations.get('color'), target).toBe(color);
      expect(declarations.get('-webkit-text-fill-color'), target).toBe('currentColor !important');
    }
  });

  it('drops the legacy fade, gradient, glass and dark shadows', () => {
    expect(declarationsFor(`${CHAT} .chat-message__copy`).get('opacity')).toBe('1 !important');
    const submit = declarationsFor(`${CHAT} .chat-composer__submit`);
    expect(submit.get('background')).toBe('var(--v2-brand-primary) !important');
    expect(submit.get('background-image')).toBe('none !important');
    expect(submit.get('box-shadow')).toBe('none !important');
    const menu = declarationsFor(`${CHAT} .chat-composer__menu`);
    expect(menu.get('background')).toBe('var(--v2-bg-panel) !important');
    expect(menu.get('box-shadow')).toBe('var(--v2-shadow) !important');
    expect(menu.get('backdrop-filter')).toBe('none !important');
    expect(menu.get('-webkit-backdrop-filter')).toBe('none !important');
    for (const name of ['add', 'inject', 'stop']) {
      const declarations = declarationsFor(`${CHAT} .chat-composer__${name}`);
      expect(declarations.get('background'), name).toBe('var(--v2-bg-panel) !important');
      expect(declarations.get('background-image'), name).toBe('none !important');
      expect(declarations.get('box-shadow'), name).toBe('none !important');
    }
  });

  it('gives every control hover, focus-visible and disabled states with the light hover fallback', () => {
    for (const selector of BUTTONS) {
      expect(declarationsFor(`${selector}:focus-visible`).get('outline'), selector).toBe(
        '2px solid var(--v2-brand-primary) !important',
      );
      expect(declarationsFor(`${selector}:disabled`).get('opacity'), selector).toBe('0.5 !important');
      expect(declarationsFor(`${selector}:hover:not(:disabled)`).get('background'), selector).toMatch(/^var\(--v2-/);
    }
    for (const name of ['add', 'inject', 'stop', 'menu-item', 'wd-btn', 'wd-clear']) {
      expect(declarationsFor(`${CHAT} .chat-composer__${name}:hover:not(:disabled)`).get('background'), name).toBe(HOVER);
    }
    expect(declarationsFor(`${CHAT} .chat-composer__submit:hover:not(:disabled)`).get('background')).toBe(
      'var(--v2-brand-primary-hover) !important',
    );
    expect(declarationsFor(`${CHAT} .chat-message__copy:hover`).get('background')).toBe(HOVER);
    expect(declarationsFor(`${CHAT} .chat-message__copy:focus-visible`).get('outline')).toBe(
      '2px solid var(--v2-brand-primary) !important',
    );
  });
});

describe('v2 Agent Marketing workspace (M4)', () => {
  const AGENT_MARKETING = [
    '.v2-agent-marketing',
    '.v2-agent-marketing__main',
    '.v2-agent-marketing__inspector',
    '.v2-agent-marketing__guard',
    '.v2-agent-marketing__files',
    '.v2-agent-marketing__files li',
    '.v2-agent-marketing__files span',
  ];

  it('scopes every Agent Marketing rule under .izzi-v2', () => {
    const selectors = rules.map((rule) => rule.selector);
    for (const name of AGENT_MARKETING) expect(selectors).toContain(`.izzi-v2 ${name}`);
    for (const rule of rules.filter((candidate) => candidate.selector.includes('v2-agent-marketing'))) {
      expect(rule.selector.startsWith('.izzi-v2 '), rule.selector).toBe(true);
    }
  });

  it('forces token text colors over the legacy cmr rules', () => {
    for (const [target, color] of [
      ['.v2-agent-marketing__guard', 'var(--v2-text-secondary) !important'],
      ['.v2-agent-marketing__files li', 'var(--v2-text-primary) !important'],
      ['.v2-agent-marketing__files span', 'var(--v2-text-secondary) !important'],
    ]) {
      const declarations = new Map<string, string>();
      for (const rule of rules.filter((candidate) => candidate.selector === `.izzi-v2 ${target}`)) {
        for (const [property, value] of rule.declarations) declarations.set(property, value);
      }
      expect(declarations.get('color'), target).toBe(color);
      expect(declarations.get('-webkit-text-fill-color'), target).toBe('currentColor !important');
    }
  });

  it('overrides the legacy cmr frame, keeps [hidden] panels hidden and gives tabs a V2 focus ring', () => {
    const decl = (selector: string) => rules.find((rule) => rule.selector === selector)?.declarations;

    expect(decl('.izzi-v2 .v2-agent-marketing-room')?.get('background')).toBe('var(--v2-bg-canvas)');
    expect(decl('.izzi-v2 .v2-agent-marketing-room')?.get('color')).toBe('var(--v2-text-primary)');
    expect(compare(specificity('.izzi-v2 .v2-agent-marketing-room'), specificity('.cmr-page'))).toBeGreaterThan(0);
    expect(decl('.izzi-v2 .v2-agent-marketing .v2-project-panel[hidden]')?.get('display')).toBe('none');
    expect(decl('.izzi-v2 .v2-agent-marketing .v2-tab:focus-visible')?.get('outline'))
      .toBe('2px solid var(--v2-brand-primary)');
  });

  it('lets the [hidden] panel rule outrank the flex panel display', () => {
    const flex = rules.filter((rule) => rule.declarations.get('display') === 'flex'
      && /\.v2-project-panel$/.test(rule.selector));
    const hidden = specificity('.izzi-v2 .v2-agent-marketing .v2-project-panel[hidden]');

    expect(flex.length).toBeGreaterThan(0);
    for (const rule of flex) expect(compare(hidden, specificity(rule.selector)), rule.selector).toBeGreaterThan(0);
  });
});

describe('v2 Affiliate workspace (M6)', () => {
  const affiliateRules = rules.filter((rule) => rule.selector.includes('v2-affiliate'));

  it('scopes every Affiliate rule under .izzi-v2', () => {
    const selectors = rules.map((rule) => rule.selector);
    for (const name of ['.v2-affiliate', '.v2-affiliate__card', '.v2-affiliate__tiles', '.v2-affiliate__row',
      '.v2-affiliate__badge', '.v2-affiliate__notice--err']) {
      expect(selectors).toContain(`.izzi-v2 ${name}`);
    }
    for (const rule of affiliateRules) expect(rule.selector.startsWith('.izzi-v2 '), rule.selector).toBe(true);
  });

  it('forces every Affiliate text color with !important and a matching text-fill', () => {
    const colored = affiliateRules.filter((rule) => rule.declarations.has('color'));

    expect(colored.length).toBeGreaterThan(0);
    for (const rule of colored) {
      expect(rule.declarations.get('color'), rule.selector).toMatch(/^var\(--v2-[\w-]+\) !important$/);
      expect(rule.declarations.get('-webkit-text-fill-color'), rule.selector).toBe('currentColor !important');
    }
  });

  it('colors error notices and rejected badges with the danger token', () => {
    const decl = (selector: string) => rules.find((rule) => rule.selector === selector)?.declarations;

    expect(decl('.izzi-v2 .v2-affiliate__notice--err')?.get('color')).toBe('var(--v2-danger) !important');
    expect(decl('.izzi-v2 .v2-affiliate__badge--rejected')?.get('color')).toBe('var(--v2-danger) !important');
  });
});

describe('v2 MyGraph frame (M7)', () => {
  const graphRules = rules.filter((rule) => rule.selector.includes('v2-mygraph'));
  const decl = (selector: string) => rules.find((rule) => rule.selector === selector)?.declarations;

  it('scopes every MyGraph rule under .izzi-v2', () => {
    expect(graphRules.length).toBeGreaterThan(0);
    for (const rule of graphRules) expect(rule.selector.startsWith('.izzi-v2 '), rule.selector).toBe(true);
  });

  it('never targets the package token island', () => {
    expect(css).not.toContain('graphview-scope');
  });

  it('uses only --v2 tokens and forces text colors with a matching text-fill', () => {
    for (const rule of graphRules) {
      for (const value of rule.declarations.values()) {
        for (const token of value.match(/var\(--[\w-]+/g) ?? []) expect(token, rule.selector).toMatch(/^var\(--v2-/);
      }
      if (rule.declarations.has('color')) {
        expect(rule.declarations.get('color'), rule.selector).toMatch(/^var\(--v2-[\w-]+\) !important$/);
        expect(rule.declarations.get('-webkit-text-fill-color'), rule.selector).toBe('currentColor !important');
      }
    }
  });

  it('gives the graph a bounded, positioned stage for its absolute panels', () => {
    expect(decl('.izzi-v2 .v2-mygraph')?.get('height')).toBe('100%');
    expect(decl('.izzi-v2 .v2-mygraph__stage')?.get('position')).toBe('relative');
    expect(decl('.izzi-v2 .v2-mygraph__stage')?.get('min-height')).toBe('0');
    expect(decl('.izzi-v2 .v2-mygraph__stage')?.get('overflow')).toBe('hidden');
    expect(decl('.izzi-v2 .v2-mygraph__canvas')?.get('position')).toBe('relative');
  });
});
