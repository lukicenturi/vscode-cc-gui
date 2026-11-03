import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRestoreFocusOnWindowFocus } from './useRestoreFocusOnWindowFocus.js';

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useRestoreFocusOnWindowFocus', () => {
  let editable: HTMLDivElement;
  let otherInput: HTMLInputElement;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    otherInput = document.createElement('input');
    document.body.append(editable, otherInput);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    editable.remove();
    otherInput.remove();
  });

  /** Simulates an app switch: focus leaves the document with no related target. */
  const switchAppAway = async (from: HTMLElement) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    from.blur();
    await flushTimers();
  };

  it('restores focus to the editable when the window gets the focus again', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    expect(document.activeElement).toBe(editable);
    await switchAppAway(editable);
    expect(document.activeElement).not.toBe(editable);

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(editable);
  });

  it('restores focus when the document becomes visible', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    await switchAppAway(editable);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.activeElement).toBe(editable);
  });

  it('does not steal focus when the user moved focus to another element', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    otherInput.focus();
    await switchAppAway(otherInput);

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(editable);
  });

  it('does not steal focus after a click on a non-focusable area of the webview', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    // The document keeps the focus, so this is not an app switch.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    editable.blur();
    await flushTimers();

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(editable);
  });

  it('does not take focus from another text-entry element', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    await switchAppAway(editable);
    otherInput.focus();

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).toBe(otherInput);
  });

  it('does nothing when disabled', async () => {
    renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, false));

    editable.focus();
    await switchAppAway(editable);

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(editable);
  });

  it('removes its listeners on unmount', async () => {
    const { unmount } = renderHook(() => useRestoreFocusOnWindowFocus({ current: editable }, true));

    editable.focus();
    await switchAppAway(editable);
    unmount();

    window.dispatchEvent(new Event('focus'));
    expect(document.activeElement).not.toBe(editable);
  });
});
