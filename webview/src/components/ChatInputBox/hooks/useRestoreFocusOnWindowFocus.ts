import { useEffect, useRef, type RefObject } from 'react';

/**
 * Returns true when `el` is a text-entry element (input, textarea, select,
 * or contenteditable) that is not inside `editable`.
 */
function isOtherTextEntry(el: Element | null, editable: HTMLElement): boolean {
  if (!el || editable.contains(el)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true
    || el.getAttribute('contenteditable') === 'true';
}

/**
 * Puts the focus back on the chat input when the webview window gets the
 * focus again (for example after Cmd+Tab to another app and back).
 *
 * The hook records if the editable was the last focused element. Focus that
 * goes out of the document (app switch, window blur) keeps that record.
 * Focus that moves to a different element in the webview, or a click on a
 * non-focusable area of the webview, clears it.
 */
export function useRestoreFocusOnWindowFocus(
  editableRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  const wasFocusedRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let rafId: number | null = null;
    let blurCheckTimer: ReturnType<typeof setTimeout> | null = null;

    const isInEditable = (node: EventTarget | null): boolean => {
      const editable = editableRef.current;
      return !!editable && node instanceof Node && editable.contains(node);
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isInEditable(event.target)) {
        wasFocusedRef.current = true;
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (!isInEditable(event.target)) return;
      if (event.relatedTarget !== null) {
        // Focus moved to a different element inside the webview.
        wasFocusedRef.current = isInEditable(event.relatedTarget);
        return;
      }
      // Focus left the editable to nothing. This occurs on an app switch or
      // window blur, and also when the user clicks a non-focusable area of
      // the webview. Only the second case leaves the document focused.
      wasFocusedRef.current = true;
      if (blurCheckTimer !== null) clearTimeout(blurCheckTimer);
      blurCheckTimer = setTimeout(() => {
        blurCheckTimer = null;
        if (document.hasFocus() && !isInEditable(document.activeElement)) {
          wasFocusedRef.current = false;
        }
      }, 0);
    };

    const restoreFocus = () => {
      if (!enabledRef.current || !wasFocusedRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      // VS Code focuses the webview iframe first. Our focus call must come
      // after that, so wait for the next frame.
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const editable = editableRef.current;
        if (!editable || !editable.isConnected) return;
        if (!enabledRef.current || !wasFocusedRef.current) return;
        const active = document.activeElement;
        if (active && active !== document.body) {
          if (editable.contains(active)) return;
          // Do not take the focus from a different text-entry element.
          if (isOtherTextEntry(active, editable)) return;
        }
        // The browser keeps the document selection while the window has no
        // focus, so focus() puts the caret back where it was.
        editable.focus();
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        restoreFocus();
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.addEventListener('focus', restoreFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('focus', restoreFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (blurCheckTimer !== null) clearTimeout(blurCheckTimer);
    };
  }, [editableRef]);
}
