import { useCallback, useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { DEBOUNCE_TIMING } from '../../../constants/performance.js';
import { debounce } from '../utils/debounce.js';
import { decorateCodeFences } from '../utils/codeFenceDecoration.js';

interface UseCodeFenceDecorationOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: MutableRefObject<boolean>;
}

interface UseCodeFenceDecorationReturn {
  /** Decorate the code fences now */
  decorateNow: () => void;
  /** Decorate the code fences after a short delay (use on input) */
  scheduleDecoration: () => void;
}

/**
 * useCodeFenceDecoration - Show ``` fenced regions of the chat input as code blocks
 *
 * The decoration does not change the text. See utils/codeFenceDecoration.ts.
 * It does not run during IME composition, because a DOM change stops the
 * composition. The input event after compositionend schedules it again.
 */
export function useCodeFenceDecoration({
  editableRef,
  isComposingRef,
}: UseCodeFenceDecorationOptions): UseCodeFenceDecorationReturn {
  const decorateNow = useCallback(() => {
    const el = editableRef.current;
    if (!el || isComposingRef.current) return;
    decorateCodeFences(el);
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
