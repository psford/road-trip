import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/listenerShim.js'), 'utf8');

// Cache the jsdom originals ONCE at module load, before any test runs
const JSDOM_ADD = document.addEventListener;
const JSDOM_REMOVE = document.removeEventListener;

beforeEach(() => {
  // Restore jsdom originals FIRST
  document.addEventListener = JSDOM_ADD;
  document.removeEventListener = JSDOM_REMOVE;
  // Clean up any previous ListenerShim state
  delete globalThis.ListenerShim;
  // Set up minimal DOM for postUI (loaded globally by setup.js) so it doesn't error
  if (!document.head) document.head = document.createElement('head');
  if (!document.body) document.body = document.createElement('body');
  if (!document.getElementById('errorMessage')) {
    const div = document.createElement('div');
    div.id = 'errorMessage';
    div.classList.add('hidden');
    document.body.appendChild(div);
  }
});

afterEach(() => {
  // Restore jsdom originals
  document.addEventListener = JSDOM_ADD;
  document.removeEventListener = JSDOM_REMOVE;
  // Clean up
  vi.restoreAllMocks();
  delete globalThis.ListenerShim;
});

describe('AC2.shim.1 — install() wraps document.addEventListener / removeEventListener; tracks DOMContentLoaded and load only', () => {
  it('wraps document.addEventListener and removeEventListener with trackers', () => {
    // Before eval: confirm clean starting state
    expect(document.addEventListener).toBe(JSDOM_ADD);
    expect(document.removeEventListener).toBe(JSDOM_REMOVE);

    // Eval the source (IIFE auto-invokes install())
    eval(SOURCE);

    // After eval: wrappers are in place
    expect(document.addEventListener).not.toBe(JSDOM_ADD);
    expect(document.removeEventListener).not.toBe(JSDOM_REMOVE);
    expect(ListenerShim._internals._isInstalled()).toBe(true);
  });

  it('tracks DOMContentLoaded handlers registered on document', () => {
    eval(SOURCE);

    const handler = () => {};
    document.addEventListener('DOMContentLoaded', handler);

    // Assert the handler is tracked
    const tracked = ListenerShim._internals._tracked.get('DOMContentLoaded');
    expect(tracked).toBeDefined();
    expect(tracked.size).toBe(1);

    // Check that the entry contains our handler
    const entries = Array.from(tracked);
    expect(entries[0].handler).toBe(handler);
  });

  it('tracks load handlers registered on document', () => {
    eval(SOURCE);

    const handler = () => {};
    document.addEventListener('load', handler);

    // Assert the handler is tracked
    const tracked = ListenerShim._internals._tracked.get('load');
    expect(tracked).toBeDefined();
    expect(tracked.size).toBe(1);

    const entries = Array.from(tracked);
    expect(entries[0].handler).toBe(handler);
  });

  it('install() is idempotent — calling it again does not re-wrap', () => {
    eval(SOURCE);

    const wrappedAdd = document.addEventListener;
    const wrappedRemove = document.removeEventListener;

    // Call install() again explicitly
    ListenerShim.install();

    // Assert the wrapper references are unchanged
    expect(document.addEventListener).toBe(wrappedAdd);
    expect(document.removeEventListener).toBe(wrappedRemove);

    // Assert _tracked buckets unchanged
    const handler1 = () => {};
    const handler2 = () => {};
    document.addEventListener('DOMContentLoaded', handler1);
    const sizeAfterFirstCall = ListenerShim._internals._tracked.get('DOMContentLoaded').size;

    ListenerShim.install();

    document.addEventListener('DOMContentLoaded', handler2);
    const sizeAfterSecondCall = ListenerShim._internals._tracked.get('DOMContentLoaded').size;

    // We added 2 handlers total (1 before second install, 1 after), so size should be 2
    expect(sizeAfterSecondCall).toBe(sizeAfterFirstCall + 1);
  });
});

describe('AC2.shim.2 — clearPageLifecycleListeners() removes every tracked handler and clears the map', () => {
  it('removes all tracked DOMContentLoaded and load handlers', () => {
    eval(SOURCE);

    // Register multiple handlers with spies so we can detect if they fire
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    const handler4 = vi.fn();
    const handler5 = vi.fn();

    document.addEventListener('DOMContentLoaded', handler1);
    document.addEventListener('DOMContentLoaded', handler2);
    document.addEventListener('DOMContentLoaded', handler3);
    document.addEventListener('load', handler4);
    document.addEventListener('load', handler5);

    // Verify handlers are tracked before clear
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded').size).toBe(3);
    expect(ListenerShim._internals._tracked.get('load').size).toBe(2);

    // Clear the tracked handlers
    ListenerShim.clearPageLifecycleListeners();

    // Verify the tracking maps are now empty
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded').size).toBe(0);
    expect(ListenerShim._internals._tracked.get('load').size).toBe(0);

    // Dispatch real events to verify handlers were actually removed from the real DOM
    // (setup.js loads postUI which registers its own DOMContentLoaded handler, so we
    // only assert that OUR handlers were not called, not that no handler fired at all)
    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.dispatchEvent(new Event('load'));

    // Assert the real handlers were NOT called — proof they were unregistered
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
    expect(handler3).not.toHaveBeenCalled();
    expect(handler4).not.toHaveBeenCalled();
    expect(handler5).not.toHaveBeenCalled();
  });

  it('clears the internal tracking maps', () => {
    eval(SOURCE);

    const handler1 = () => {};
    const handler2 = () => {};

    document.addEventListener('DOMContentLoaded', handler1);
    document.addEventListener('load', handler2);

    // Verify they are tracked
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded').size).toBe(1);
    expect(ListenerShim._internals._tracked.get('load').size).toBe(1);

    // Clear
    ListenerShim.clearPageLifecycleListeners();

    // Verify buckets are empty
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded').size).toBe(0);
    expect(ListenerShim._internals._tracked.get('load').size).toBe(0);
  });
});

describe('AC2.shim.3 — Non-lifecycle events pass through untracked', () => {
  it('non-lifecycle handlers fire on real events and are not tracked', () => {
    eval(SOURCE);

    const clickHandler = vi.fn();
    const submitHandler = vi.fn();
    const changeHandler = vi.fn();
    const keydownHandler = vi.fn();

    document.addEventListener('click', clickHandler);
    document.addEventListener('submit', submitHandler);
    document.addEventListener('change', changeHandler);
    document.addEventListener('keydown', keydownHandler);

    // Dispatch real events to verify handlers fire (proves delegation to _originalAdd worked)
    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('submit'));
    document.dispatchEvent(new Event('change'));
    document.dispatchEvent(new Event('keydown'));

    // All handlers should have fired exactly once
    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(submitHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(keydownHandler).toHaveBeenCalledTimes(1);

    // These events are not tracked
    expect(ListenerShim._internals._tracked.has('click')).toBe(false);
    expect(ListenerShim._internals._tracked.has('submit')).toBe(false);
    expect(ListenerShim._internals._tracked.has('change')).toBe(false);
    expect(ListenerShim._internals._tracked.has('keydown')).toBe(false);
  });

  it('non-lifecycle handlers survive clearPageLifecycleListeners() and continue to fire', () => {
    eval(SOURCE);

    const clickHandler = vi.fn();
    const submitHandler = vi.fn();

    document.addEventListener('click', clickHandler);
    document.addEventListener('submit', submitHandler);

    // Dispatch first time to verify handlers fire
    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('submit'));
    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(submitHandler).toHaveBeenCalledTimes(1);

    // Clear lifecycle listeners (should not affect non-lifecycle)
    ListenerShim.clearPageLifecycleListeners();

    // Dispatch again to verify non-lifecycle handlers still fire
    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('submit'));

    // Handlers should have fired twice now (once before clear, once after)
    expect(clickHandler).toHaveBeenCalledTimes(2);
    expect(submitHandler).toHaveBeenCalledTimes(2);
  });
});

describe('AC2.shim.4 — Listeners on targets other than document are not tracked', () => {
  it('does not track handlers registered on window and they fire after clear', () => {
    eval(SOURCE);

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    // Register lifecycle handlers on window (not document)
    window.addEventListener('DOMContentLoaded', handler1);
    window.addEventListener('load', handler2);

    // These should not be tracked (they were added to window, not document)
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded')?.size || 0).toBe(0);
    expect(ListenerShim._internals._tracked.get('load')?.size || 0).toBe(0);

    // Clear lifecycle listeners (should have no effect on window handlers)
    ListenerShim.clearPageLifecycleListeners();

    // Dispatch events on window to verify handlers still fire (were not removed by clear)
    window.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));

    // Both handlers should have fired — proof they survived the clear
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('does not track handlers registered on Elements and they fire after clear', () => {
    eval(SOURCE);

    const div = document.createElement('div');
    const handler = vi.fn();

    document.body.appendChild(div);
    div.addEventListener('DOMContentLoaded', handler);

    // This handler should not be tracked (it was added to an element, not document)
    expect(ListenerShim._internals._tracked.get('DOMContentLoaded')?.size || 0).toBe(0);

    // Clear lifecycle listeners (should have no effect on element handlers)
    ListenerShim.clearPageLifecycleListeners();

    // Dispatch the event on the element to verify it still fires (was not removed by clear)
    div.dispatchEvent(new Event('DOMContentLoaded'));

    // Handler should have fired — proof it survived the clear
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
