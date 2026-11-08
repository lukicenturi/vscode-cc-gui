import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forceWebviewRepaint } from './forceWebviewRepaint';

describe('forceWebviewRepaint', () => {
  let rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: () => '1.1',
    }) as unknown as CSSStyleDeclaration);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Drain the queued rAF callbacks (the util uses a double rAF). */
  const flushRaf = () => {
    while (rafQueue.length > 0) {
      const cb = rafQueue.shift()!;
      cb(0);
    }
  };

  it('toggles the inline transform and dispatches resize after a double rAF', () => {
    const zoomWrites: string[] = [];
    const app = {
      style: {
        set transform(v: string) { zoomWrites.push(v); },
        get transform() { return zoomWrites[zoomWrites.length - 1] ?? ''; },
      },
      offsetHeight: 0,
    } as unknown as HTMLElement;

    vi.spyOn(document, 'getElementById').mockReturnValue(app);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockReturnValue(true);

    forceWebviewRepaint('unit-test');

    // The nudge is deferred until React finishes its unmount/reflow (double rAF).
    expect(zoomWrites).toHaveLength(0);
    expect(dispatchSpy).not.toHaveBeenCalled();

    flushRaf();

    // The transform is removed, then the CSS rule applies the font scale
    // again, which makes Chromium/JCEF re-rasterize the whole viewport.
    expect(zoomWrites).toEqual(['none', '']);
    const resizeDispatched = dispatchSpy.mock.calls.some(
      ([evt]) => evt instanceof Event && evt.type === 'resize'
    );
    expect(resizeDispatched).toBe(true);
  });

  it('is a no-op and does not throw when #app is missing', () => {
    vi.spyOn(document, 'getElementById').mockReturnValue(null);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    expect(() => {
      forceWebviewRepaint();
      flushRaf();
    }).not.toThrow();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
