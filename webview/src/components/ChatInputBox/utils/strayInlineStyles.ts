/**
 * Remove inline styles that the browser carries over after a deletion.
 *
 * Chromium keeps a "typing style" when the user deletes styled text (for
 * example the whole content of an `.input-inline-code` span with Cmd+A and
 * Backspace). The next typed characters then land in a new
 * `<span style="color: …; font-family: …">` or `<font>` element, so the
 * orange code style follows the user into plain text. This helper unwraps
 * such elements. Our own markup (`.input-inline-code`, `.input-code-fence`,
 * file tags, quote chips) never uses a style attribute, so it is kept.
 *
 * Returns true when the DOM changed.
 */
export function stripStrayInlineStyles(root: HTMLElement): boolean {
  const stray = root.querySelectorAll<HTMLElement>('[style], font, b, i, u, strike');
  if (stray.length === 0) return false;
  let changed = false;
  stray.forEach((element) => {
    if (!root.contains(element) || element === root) return;
    if (element.classList.length > 0 && !element.hasAttribute('style')) return;
    if (element.classList.length > 0) {
      // Our own element with a stray style attribute: drop the attribute only.
      element.removeAttribute('style');
      changed = true;
      return;
    }
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
    changed = true;
  });
  return changed;
}
