import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { DEBOUNCE_TIMING } from '../../../constants/performance.js';
import { debounce } from '../utils/debounce.js';
import { decorateInputMarkup } from '../utils/codeFenceDecoration.js';

interface UseCodeFenceDecorationOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: MutableRefObject<boolean>;
  /**
   * Called when the decoration changes the text. This occurs when it adds an
   * empty line after a block to move the caret out of a hidden ``` line.
   * Give the normal input handler (handleInput).
   */
  onTextChange?: () => void;
}

interface UseCodeFenceDecorationReturn {
  /** Decorate the code fences and the inline code now */
  decorateNow: () => void;
  /** Decorate the code fences and the inline code after a short delay (use on input) */
  scheduleDecoration: () => void;
}

/**
 * useCodeFenceDecoration - Show ``` fenced regions of the chat input as code blocks,
 * and `inline code` on the other lines as inline code spans
 *
 * The decoration does not change the text, except for one case: when the
 * caret is in a hidden closing ``` line and no line follows the block, it adds
 * an empty line for the caret and calls onTextChange.
 * See utils/codeFenceDecoration.ts.
 * It does not run during IME composition, because a DOM change stops the
 * composition. The input event after compositionend schedules it again.
 */
export function useCodeFenceDecoration({
  editableRef,
  isComposingRef,
  onTextChange,
}: UseCodeFenceDecorationOptions): UseCodeFenceDecorationReturn {
  // Keep the latest callback without a new debounced function on each render
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  const decorateNow = useCallback(() => {
    const el = editableRef.current;
    if (!el || isComposingRef.current) return;
    decorateInputMarkup(el, { onTextChange: () => onTextChangeRef.current?.() });
  }, [editableRef, isComposingRef]);

  const debouncedDecorate = useMemo(
    () => debounce(decorateNow, DEBOUNCE_TIMING.CODE_FENCE_DECORATION_MS),
    [decorateNow]
  );

  useEffect(() => () => debouncedDecorate.cancel(), [debouncedDecorate]);

  const scheduleDecoration = useCallback(() => {
    debouncedDecorate();
  }, [debouncedDecorate]);

  return { decorateNow, scheduleDecoration };
}
