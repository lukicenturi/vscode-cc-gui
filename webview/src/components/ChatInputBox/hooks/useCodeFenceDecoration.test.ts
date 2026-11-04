import { renderHook } from '@testing-library/react';
import { useCodeFenceDecoration } from './useCodeFenceDecoration.js';
import {
  INLINE_CODE_CLASS,
  decorateInputMarkup,
  setCaret,
} from '../utils/codeFenceDecoration.js';

function makeEditable(text: string): HTMLDivElement {
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  editable.appendChild(document.createTextNode(text));
  document.body.appendChild(editable);
  decorateInputMarkup(editable);
  return editable;
}

function fireSelectionChange(): void {
  document.dispatchEvent(new Event('selectionchange'));
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('useCodeFenceDecoration: selection change', () => {
  it('moves a caret anchored on the inline code span after the closing tick to after the span', () => {
    const editable = makeEditable('see `foo`');
    const span = editable.querySelector<HTMLElement>(`.${INLINE_CODE_CLASS}`)!;
    const editableRef = { current: editable };
    const isComposingRef = { current: false };
    renderHook(() => useCodeFenceDecoration({ editableRef, isComposingRef }));

    setCaret(span, 3);
    fireSelectionChange();

    expect(window.getSelection()!.anchorNode).toBe(span.parentNode);
    expect(window.getSelection()!.anchorOffset).toBe(2);
  });

  it('does not move the caret during IME composition', () => {
    const editable = makeEditable('see `foo`');
    const span = editable.querySelector<HTMLElement>(`.${INLINE_CODE_CLASS}`)!;
    const editableRef = { current: editable };
    const isComposingRef = { current: true };
    renderHook(() => useCodeFenceDecoration({ editableRef, isComposingRef }));

    setCaret(span, 3);
    fireSelectionChange();

    expect(window.getSelection()!.anchorNode).toBe(span);
  });

  it('removes the listener on unmount', () => {
    const editable = makeEditable('see `foo`');
    const span = editable.querySelector<HTMLElement>(`.${INLINE_CODE_CLASS}`)!;
    const editableRef = { current: editable };
    const isComposingRef = { current: false };
    const { unmount } = renderHook(() => useCodeFenceDecoration({ editableRef, isComposingRef }));
    unmount();

    setCaret(span, 3);
    fireSelectionChange();

    expect(window.getSelection()!.anchorNode).toBe(span);
  });
});
