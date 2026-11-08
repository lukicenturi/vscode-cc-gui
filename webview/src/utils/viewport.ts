import { getAppScale } from './appScale';

/**
 * Get the #app element's bounding rect as the reference viewport.
 *
 * #app is scaled with a transform (the font scale). Its rect keeps all
 * coordinates from getBoundingClientRect() of child elements in the same
 * space, so scaled and unscaled values do not mix.
 *
 * Also provides a `fixedPosDivisor` for position:fixed elements inside #app:
 * getBoundingClientRect() returns visual (scaled) values, but a px value given
 * to top/left/bottom of a fixed element inside #app is scaled again by the
 * transform. Detection: if appRect.height ≈ window.innerHeight while the
 * scale ≠ 1, the values need the compensation.
 *
 * @returns Viewport dimensions, offsets, and fixedPosDivisor for the scale compensation
 */
export function getAppViewport(): {
  width: number;
  height: number;
  top: number;
  left: number;
  fixedPosDivisor: number;
} {
  const appEl = document.getElementById('app');
  const appRect = appEl?.getBoundingClientRect();
  const scale = appEl ? getAppScale() : 1;
  const height = appRect?.height ?? window.innerHeight;
  // When the scale ≠ 1 and appRect.height matches window.innerHeight,
  // getBoundingClientRect gives visual values, but the transform scales the
  // px values of position:fixed elements again, which gives a double scale.
  const needsCompensation = scale !== 1 && Math.abs(height - window.innerHeight) < 2;
  return {
    width: appRect?.width ?? window.innerWidth,
    height,
    top: appRect?.top ?? 0,
    left: appRect?.left ?? 0,
    fixedPosDivisor: needsCompensation ? scale : 1,
  };
}
