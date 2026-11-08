import { nudgeAppScale } from './appScale';

/**
 * forceWebviewRepaint
 *
 * Clears JCEF native-rendering ghosting on macOS by forcing a full-viewport
 * re-rasterization.
 *
 * Why this is needed: on macOS JCEF runs in native (windowed) rendering mode
 * (see JBCefBrowserFactory.determineOsrMode). In that mode Chromium's compositor
 * sometimes fails to invalidate the region a compositing-layer element occupied
 * after React unmounts it or its parent reflows — leaving stale pixels (ghosting).
 * Typical culprits: position:fixed/animated overlays (the changelog dialog) and
 * input-box header content that grows/shrinks (open-source banner, attachments).
 *
 * The fix reuses the scale-nudge technique of main.tsx `forceReapply`: remove
 * the transform of #app for one synchronous layout, then let the CSS rule
 * apply the font scale again. The double requestAnimationFrame waits for React
 * to finish the unmount / reflow first, so the nudge erases the post-unmount
 * viewport.
 *
 * @param _reason optional label for debugging; intentionally unused at runtime.
 */
export function forceWebviewRepaint(_reason?: string): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Wait for React to finish unmount/reflow, THEN nudge, so we erase post-unmount pixels.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nudgeAppScale(app);
      // Let layout-dependent components recompute (mirrors main.tsx forceReapply).
      window.dispatchEvent(new Event('resize'));
    });
  });
}
