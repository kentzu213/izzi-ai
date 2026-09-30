import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorComposer } from '../../pages/CustomerMarketingRoom';
import { useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { cancelPendingHandoff } from './composerHandoff';
import { HomeSurface } from './HomeSurface';
import { applyV2Identity } from './identity';
import { cancelMarketingPrefill } from './marketingPrefill';

/*
 * Runtime Home → Agent Marketing → Director flow (M3 capability routing).
 * Unlike the source checks in marketingPrefill.test.ts, this runs the real
 * HomeSurface and DirectorComposer: their hooks, effects and event handlers.
 * The node environment has no DOM, so the small hook runtime below stands in
 * for react-dom: a state update re-renders its component synchronously,
 * effects run after render and clean up on unmount, and `strict` replays
 * mount effects the way StrictMode does.
 */

const runtime = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    deps?: readonly unknown[];
    effect?: () => unknown;
    cleanup?: unknown;
  }
  interface Instance {
    slots: Slot[];
    cursor: number;
    queue: Array<() => void>;
    alive: boolean;
    tree: unknown;
    render: () => void;
  }

  let current: Instance | null = null;

  const nextSlot = () => {
    if (!current) throw new Error('hook called outside a component render');
    const inst = current;
    const index = inst.cursor++;
    const isNew = !inst.slots[index];
    if (isNew) inst.slots[index] = {};
    return { inst, slot: inst.slots[index], isNew };
  };

  const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

  const runCleanup = (slot: Slot) => {
    if (typeof slot.cleanup === 'function') slot.cleanup();
    slot.cleanup = undefined;
  };

  function useState<T>(init: T | (() => T)) {
    const { inst, slot, isNew } = nextSlot();
    if (isNew) slot.value = typeof init === 'function' ? (init as () => T)() : init;
    const setState = (next: T | ((prev: T) => T)) => {
      slot.value = typeof next === 'function' ? (next as (prev: T) => T)(slot.value as T) : next;
      if (current !== inst) inst.render();
    };
    return [slot.value as T, setState] as const;
  }

  function useEffect(effect: () => unknown, deps?: readonly unknown[]) {
    const { inst, slot, isNew } = nextSlot();
    if (!isNew && sameDeps(slot.deps, deps)) return;
    slot.deps = deps;
    slot.effect = effect;
    inst.queue.push(() => {
      runCleanup(slot);
      slot.cleanup = effect();
    });
  }

  // Shared by the useMemo/useCallback stand-ins. Not named use*, so the
  // exhaustive-deps lint does not treat this runtime as a component calling hooks.
  const memoSlot = <T>(factory: () => T, deps?: readonly unknown[]) => {
    const { slot, isNew } = nextSlot();
    if (isNew || !sameDeps(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value as T;
  };

  function useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
    return memoSlot(factory, deps);
  }

  function useRef<T>(initial: T) {
    const { slot, isNew } = nextSlot();
    if (isNew) slot.value = { current: initial };
    return slot.value as { current: T };
  }

  function useCallback<T>(callback: T, deps?: readonly unknown[]) {
    return memoSlot(() => callback, deps);
  }

  function mount<P>(component: (props: P) => unknown, props: () => P, { strict = false } = {}) {
    const inst: Instance = { slots: [], cursor: 0, queue: [], alive: true, tree: null, render: () => undefined };
    inst.render = () => {
      if (!inst.alive) return;
      const previous = current;
      current = inst;
      inst.cursor = 0;
      try {
        inst.tree = component(props());
      } finally {
        current = previous;
      }
      for (const run of inst.queue.splice(0)) run();
    };
    inst.render();
    if (strict) {
      const effects = inst.slots.filter((slot) => slot.effect);
      effects.forEach(runCleanup);
      for (const slot of effects) slot.cleanup = slot.effect?.();
    }
    return {
      get tree() {
        return inst.tree;
      },
      rerender: () => inst.render(),
      unmount: () => {
        inst.alive = false;
        inst.slots.forEach(runCleanup);
      },
    };
  }

  return { hooks: { useState, useEffect, useMemo, useRef, useCallback }, mount };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, ...runtime.hooks, default: { ...actual, ...runtime.hooks } };
});

// Same live-state selector hooks as surfaces.test.ts, without zustand's React binding.
vi.mock('../../store/projectWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/projectWorkspace')>();
  const store = actual.useProjectWorkspaceStore;
  type State = ReturnType<typeof store.getState>;
  return { ...actual, useProjectWorkspaceStore: Object.assign(<T>(select: (state: State) => T) => select(store.getState()), store) };
});

vi.mock('../../store/agentGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/agentGateway')>();
  const store = actual.useAgentGatewayStore;
  type State = ReturnType<typeof store.getState>;
  return { ...actual, useAgentGatewayStore: Object.assign(<T>(select: (state: State) => T) => select(store.getState()), store) };
});

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

// Walks rendered host elements; child components (icons) are never called.
function findAll(node: unknown, match: (el: Element) => boolean, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, match, out);
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as Element;
    if (match(el)) out.push(el);
    findAll(el.props.children, match, out);
  }
  return out;
}

function find(node: unknown, match: (el: Element) => boolean): Element {
  const [el] = findAll(node, match);
  if (!el) throw new Error('element not rendered');
  return el;
}

const fire = (el: Element, handler: string, event?: unknown) => (el.props[handler] as (event?: unknown) => unknown)(event);
const byType = (type: string) => (el: Element) => el.type === type;
const byClass = (className: string) => (el: Element) => el.props.className === className;
const noop = () => undefined;

const TEXT = 'Chiến dịch tháng 10 cho khách mới';
const views: Array<{ unmount: () => void }> = [];

// Home with its draft owned outside it, like AppShellV2's homeDraft.
function openHome(owner = { draft: '' }) {
  const onDraftChange = vi.fn((next: string) => {
    owner.draft = next;
    view.rerender();
  });
  const onNavigate = vi.fn();
  const view = runtime.mount(HomeSurface, () => ({
    draft: owner.draft,
    onDraftChange,
    onNavigate,
    onSelectSurface: noop,
    isNavigatorOpen: true,
    onToggleNavigator: noop,
  }));
  views.push(view);
  return {
    owner,
    onDraftChange,
    onNavigate,
    cleared: () => onDraftChange.mock.calls.filter(([value]) => value === '').length,
    prompt: () => find(view.tree, byType('textarea')).props.value,
    status: () => find(view.tree, byClass('v2-surface__status')).props.children,
    type: (value: string) => fire(find(view.tree, byType('textarea')), 'onChange', { target: { value } }),
    choose: (value: 'chat' | 'marketing') => fire(find(view.tree, byType('select')), 'onChange', { target: { value } }),
    chip: () => fire(find(view.tree, byClass('v2-chip')), 'onClick'),
    submit: () => fire(find(view.tree, byType('form')), 'onSubmit', { preventDefault: noop }),
    unmount: view.unmount,
  };
}

function openDirector(options: { strict?: boolean } = {}) {
  const onSubmit = vi.fn(async (_goal: string) => undefined);
  const view = runtime.mount(DirectorComposer, () => ({ onSubmit, busy: false }), options);
  views.push(view);
  return {
    onSubmit,
    goal: () => find(view.tree, byType('textarea')).props.value,
    submit: () => fire(find(view.tree, byType('form')), 'onSubmit', { preventDefault: noop }),
  };
}

// Offers TEXT from Home and leaves Home, as the navigation to Marketing does.
function offerFromHome() {
  const home = openHome({ draft: TEXT });
  home.choose('marketing');
  home.submit();
  home.unmount();
  return home;
}

afterEach(() => {
  views.splice(0).forEach((view) => view.unmount());
  cancelMarketingPrefill();
  cancelPendingHandoff();
  useProjectWorkspaceStore.getState().setIdentity(null);
});

describe('Home → Agent Marketing → Director (runtime)', () => {
  it('fills the Director textarea once and clears the Home draft only when it arrives', () => {
    const home = openHome({ draft: TEXT });
    home.choose('marketing');
    home.submit();

    expect(home.onNavigate).toHaveBeenCalledTimes(1);
    expect(home.onNavigate).toHaveBeenCalledWith('customer-marketing');
    expect(home.cleared()).toBe(0);
    expect(home.owner.draft).toBe(TEXT);

    home.unmount();
    const director = openDirector();

    expect(director.goal()).toBe(TEXT);
    expect(home.cleared()).toBe(1);
    expect(home.owner.draft).toBe('');
    expect(director.onSubmit).not.toHaveBeenCalled();

    const later = openDirector();
    expect(later.goal()).toBe('');
    expect(home.cleared()).toBe(1);
  });

  it('never submits on its own: only the user pressing submit reaches onSubmit (askDirector)', async () => {
    offerFromHome();
    const director = openDirector();
    expect(director.onSubmit).not.toHaveBeenCalled();

    await director.submit();

    expect(director.onSubmit).toHaveBeenCalledTimes(1);
    expect(director.onSubmit).toHaveBeenCalledWith(TEXT);
  });

  it('consumes once under a StrictMode effect replay', () => {
    const home = offerFromHome();
    const director = openDirector({ strict: true });

    expect(director.goal()).toBe(TEXT);
    expect(home.cleared()).toBe(1);
    expect(director.onSubmit).not.toHaveBeenCalled();
  });

  it.each(['', '   \n '])('refuses a blank draft %j: message, no navigation, nothing for Director', (draft) => {
    const home = openHome({ draft });
    home.choose('marketing');
    home.submit();

    expect(home.status()).toBe('Nhập nội dung trước khi mở Agent Marketing.');
    expect(home.onNavigate).not.toHaveBeenCalled();
    expect(home.onDraftChange).not.toHaveBeenCalled();
    expect(openDirector().goal()).toBe('');
  });

  it('keeps the draft when the Director never opens', () => {
    const home = openHome({ draft: TEXT });
    home.choose('marketing');
    home.submit();

    expect(home.onNavigate).toHaveBeenCalledWith('customer-marketing');
    expect(home.cleared()).toBe(0);
    expect(home.owner.draft).toBe(TEXT);
    expect(home.prompt()).toBe(TEXT);
  });

  it('drops the offer when Home remounts before the Director takes it', () => {
    const first = offerFromHome();
    const back = openHome(first.owner);

    expect(back.prompt()).toBe(TEXT);
    expect(openDirector().goal()).toBe('');
    expect(first.cleared()).toBe(0);
    expect(first.owner.draft).toBe(TEXT);
  });

  it.each([
    ['editing the draft', (home: ReturnType<typeof openHome>) => home.type('Nội dung mới cho tuần sau'), [['Nội dung mới cho tuần sau']]],
    ['picking a quick chip', (home: ReturnType<typeof openHome>) => home.chip(), [['Lên kế hoạch nội dung cho tuần này']]],
    ['switching back to Chat', (home: ReturnType<typeof openHome>) => home.choose('chat'), []],
  ])('drops the offer after %s, so the old text never reaches the Director', (_label, act, draftCalls) => {
    const home = openHome({ draft: TEXT });
    home.choose('marketing');
    home.submit();

    act(home);

    expect(home.onDraftChange.mock.calls).toEqual(draftCalls);
    expect(openDirector().goal()).toBe('');
    expect(home.cleared()).toBe(0);
  });

  it('hands over only the replacement draft after a resubmit', () => {
    const home = openHome({ draft: TEXT });
    home.choose('marketing');
    home.submit();
    home.type('Bản mới: khuyến mãi cuối tuần');
    home.submit();
    home.unmount();

    const director = openDirector();

    expect(director.goal()).toBe('Bản mới: khuyến mãi cuối tuần');
    expect(home.cleared()).toBe(1);
    expect(home.onNavigate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an account switch', 'user-b'],
    ['logout', null],
  ])('keeps the text out of the next context after %s', (_label, nextUserId) => {
    useProjectWorkspaceStore.getState().setIdentity('user-a');
    const home = offerFromHome();

    applyV2Identity(nextUserId);
    const director = openDirector();

    expect(director.goal()).toBe('');
    expect(home.cleared()).toBe(0);
    expect(director.onSubmit).not.toHaveBeenCalled();
  });

  it('leaves the legacy Director unchanged with the flag OFF (no V2 Home, no offer)', () => {
    const director = openDirector();

    expect(director.goal()).toBe('');
    expect(director.onSubmit).not.toHaveBeenCalled();
  });
});
