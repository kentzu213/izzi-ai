import React, { useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/v2/tokens.css';
import './demo.css';

/*
 * Dev-only M1 demo: renders every V2 token in a dark and a light `.izzi-v2`
 * root side by side. Colors come only from var(--v2-*) references; the value
 * column is read back from the computed style so the page shows what the
 * cascade actually resolved (an unset light token reads "unset").
 */

type Theme = 'dark' | 'light';

const COLOR_GROUPS: Array<{ title: string; tokens: string[] }> = [
  {
    title: 'Surfaces',
    tokens: ['--v2-bg-canvas', '--v2-bg-deep', '--v2-bg-panel', '--v2-bg-panel-hover', '--v2-bg-subtle'],
  },
  { title: 'Borders', tokens: ['--v2-border-default', '--v2-border-strong'] },
  { title: 'Text', tokens: ['--v2-text-primary', '--v2-text-secondary', '--v2-text-muted'] },
  {
    title: 'Brand',
    tokens: ['--v2-brand-primary', '--v2-brand-primary-hover', '--v2-brand-soft', '--v2-brand-pink'],
  },
  { title: 'Semantic', tokens: ['--v2-success', '--v2-warning', '--v2-danger', '--v2-info'] },
];

const TYPE_SCALE = ['hero', 'page', 'section', 'body-strong', 'body', 'meta', 'label'];
const SPACING = ['1', '2', '3', '4', '5', '6', '8', '10', '12'];
const RADII = ['control', 'card', 'panel', 'pill'];
const LAYOUT = ['rail', 'navigator', 'inspector', 'titlebar', 'content-max'];

function useTokenValues(tokens: string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (!ref.current) return;
    const computed = getComputedStyle(ref.current);
    setValues(Object.fromEntries(tokens.map((token) => [token, computed.getPropertyValue(token).trim() || 'unset'])));
  }, [tokens]);
  return { ref, values };
}

const ALL_TOKENS = [
  ...COLOR_GROUPS.flatMap((group) => group.tokens),
  ...SPACING.map((step) => `--v2-space-${step}`),
  ...RADII.map((name) => `--v2-radius-${name}`),
  ...LAYOUT.map((name) => `--v2-layout-${name}`),
];

function ThemePanel({ theme }: { theme: Theme }) {
  const { ref, values } = useTokenValues(ALL_TOKENS);
  return (
    <div ref={ref} className="izzi-v2 v2-demo" data-theme={theme === 'light' ? 'light' : undefined}>
      <header className="v2-demo__header">
        <h1 className="v2-demo__title">Izzi AI V2 tokens</h1>
        <span className="v2-demo__badge">{theme}</span>
      </header>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="v2-demo__section">
          <h2 className="v2-demo__heading">{group.title}</h2>
          <ul className="v2-demo__swatches">
            {group.tokens.map((token) => (
              <li key={token} className="v2-demo__swatch">
                <span className="v2-demo__chip" style={{ background: `var(${token})` }} />
                <code className="v2-demo__name">{token}</code>
                <code className="v2-demo__value">{values[token]}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="v2-demo__section">
        <h2 className="v2-demo__heading">Brand gradient</h2>
        <div className="v2-demo__gradient" />
      </section>

      <section className="v2-demo__section">
        <h2 className="v2-demo__heading">Type scale</h2>
        {TYPE_SCALE.map((step) => (
          <p
            key={step}
            className="v2-demo__type"
            style={{ fontSize: `var(--v2-text-${step}-size)`, lineHeight: `var(--v2-text-${step}-line)` }}
          >
            {step} — Trợ lý AI cho doanh nghiệp
          </p>
        ))}
      </section>

      <section className="v2-demo__section">
        <h2 className="v2-demo__heading">Spacing (4px base)</h2>
        {SPACING.map((step) => (
          <div key={step} className="v2-demo__row">
            <code className="v2-demo__name">--v2-space-{step}</code>
            <span className="v2-demo__bar" style={{ width: `var(--v2-space-${step})` }} />
            <code className="v2-demo__value">{values[`--v2-space-${step}`]}</code>
          </div>
        ))}
      </section>

      <section className="v2-demo__section">
        <h2 className="v2-demo__heading">Radius</h2>
        <div className="v2-demo__radii">
          {RADII.map((name) => (
            <div key={name} className="v2-demo__radius" style={{ borderRadius: `var(--v2-radius-${name})` }}>
              {name} · {values[`--v2-radius-${name}`]}
            </div>
          ))}
        </div>
      </section>

      <section className="v2-demo__section">
        <h2 className="v2-demo__heading">Layout</h2>
        {LAYOUT.map((name) => (
          <div key={name} className="v2-demo__row">
            <code className="v2-demo__name">--v2-layout-{name}</code>
            <code className="v2-demo__value">{values[`--v2-layout-${name}`]}</code>
          </div>
        ))}
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="izzi-v2 v2-demo-page">
      <ThemePanel theme="dark" />
      <ThemePanel theme="light" />
    </main>
  </React.StrictMode>,
);
