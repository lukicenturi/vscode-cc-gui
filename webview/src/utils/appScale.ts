/**
 * The font scale of the app. The CSS variable --font-scale holds it, and
 * #app applies it with a transform (see styles/less/base.less).
 */

/** The scale factor from a computed transform value, or null when it is not a matrix. */
export function parseTransformScale(transform: string): number | null {
  const value = transform.trim();
  if (value === 'none' || value === '') return 1;
  const match = /^matrix\(([^,]+),/.exec(value);
  if (!match) return null;
  const scale = parseFloat(match[1]);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

/** The expected scale: the --font-scale variable, else the transform of #app, else 1. */
export function getAppScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim();
  const fromVar = parseFloat(raw);
  if (Number.isFinite(fromVar) && fromVar > 0) return fromVar;
  const app = document.getElementById('app');
  if (app) {
    const fromTransform = parseTransformScale(getComputedStyle(app).transform);
    if (fromTransform) return fromTransform;
  }
  return 1;
}

/** The scale that #app shows now, from its computed transform. */
export function getRenderedAppScale(app: HTMLElement): number | null {
  return parseTransformScale(getComputedStyle(app).transform);
}

/**
 * Make Chromium apply the scale again and re-rasterize the viewport: remove
 * the transform for one synchronous layout, then let the CSS rule apply again.
 */
export function nudgeAppScale(app: HTMLElement): void {
  app.style.transform = 'none';
  void app.offsetHeight;
  app.style.transform = '';
}
