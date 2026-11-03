/**
 * Keyboard moves at the edges of a code fence block in the chat input.
 *
 * The CSS hides the ``` lines of a block (see codeFenceDecoration.ts). These
 * keys move the caret out of the block, so the user does not need to see or
 * type the ``` lines:
 *
 * - ArrowDown on the last content line, or ArrowRight at its end: go to the
 *   start of the line after the block. When no line follows, add an empty
 *   line. An unclosed fence first gets a closing ``` line.
 * - ArrowUp on the first content line, or ArrowLeft at its start: go to the
 *   end of the line before the block. When no line is before the block, add
 *   an empty line.
 * - Backspace at the start of the first content line: when that line is
 *   empty and it is the only content line, remove the fence. When that line
 *   is empty and more lines follow, remove that line. Else do nothing,
 *   because the browser would join the line to the hidden ``` line.
 * - Delete at the end of the last content line of a closed fence: do nothing
 *   (the same reason).
 * - Backspace at the start of the line after a block and Delete at the end
 *   of the line before a block: remove the line when it is empty, and put the
 *   caret in the block. The browser would join the line to a hidden ``` line.
 *
 * Every text change dispatches an input event, so the normal input update
 * (handleInput) runs.
 */

import {
  CODE_FENCE_CLASS,
  CODE_FENCE_LINE_CLASS,
  CODE_FENCE_MARKER_CLASS,
  blockHidesMarkers,
  createEmptyLine,
  decorateCodeFences,
  getFenceLines,
  getSelectionInside,
  getVisibleFenceLines,
  isClosedFenceBlock,
  isCodeFenceBlock,
  placeCaretAtLineEnd,
  placeCaretAtLineStart,
  setCaret,
} from './codeFenceDecoration.js';
import { QUOTE_TAG_CLASS } from './quoteTag.js';
import { getVirtualCursorPosition } from './virtualCursorUtils.js';

export type CodeFenceNavigationKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Backspace'
  | 'Delete';

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<CodeFenceNavigationKey>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
]);

const ATOMIC_TAG_SELECTOR = `.file-tag, .${QUOTE_TAG_CLASS}`;

/** The change that a key makes at the edge of a fence block. */
export type CodeFenceKeyAction =
  /** Move the caret to the line after the block (close an unclosed fence first) */
  | { type: 'exit-after'; block: HTMLElement }
  /** Move the caret to the line before the block */
  | { type: 'exit-before'; block: HTMLElement }
  /** Remove the fence (only an empty content line is in it) */
  | { type: 'remove-fence'; block: HTMLElement }
  /** Remove an empty first content line; the caret goes to the next line */
  | { type: 'remove-empty-line'; line: HTMLElement; next: HTMLElement }
  /** Move the caret to the end of the block; remove the empty line first */
  | { type: 'enter-block-end'; block: HTMLElement; removeLine: HTMLElement | null }
  /** Move the caret to the start of the block; remove the empty line first */
  | { type: 'enter-block-start'; block: HTMLElement; removeLine: HTMLElement | null }
  /** Do not let the browser join a line to a hidden ``` line */
  | { type: 'prevent' };

interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
}

/**
 * The line element that holds the node: a <div> child of the editable
 * element or a line <div> of a fence block. Null when the node is not in a
 * line element.
 */
export function findLineElement(editable: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== editable) {
    const parent: Node | null = current.parentNode;
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      const isDiv = el.tagName.toLowerCase() === 'div';
      if (isDiv && !el.classList.contains(CODE_FENCE_CLASS)) {
        if (parent === editable && !el.classList.contains(CODE_FENCE_LINE_CLASS)) return el;
        if (isCodeFenceBlock(parent) && el.classList.contains(CODE_FENCE_LINE_CLASS)) return el;
      }
    }
    current = parent;
  }
  return null;
}

/** True when the range has no text and no atomic tags. */
function isRangeEmpty(range: Range): boolean {
  const fragment = range.cloneContents();
  if ((fragment.textContent ?? '').replace(/[​-‍﻿]/g, '') !== '') return false;
  return fragment.querySelector(ATOMIC_TAG_SELECTOR) === null;
}

/** True when the caret is at the start of the line. */
export function isCaretAtLineStart(line: HTMLElement, caret: Range): boolean {
  const range = document.createRange();
  range.setStart(line, 0);
  range.setEnd(caret.startContainer, caret.startOffset);
  return isRangeEmpty(range);
}

/** True when the caret is at the end of the line. */
export function isCaretAtLineEnd(line: HTMLElement, caret: Range): boolean {
  const range = document.createRange();
  range.setStart(caret.endContainer, caret.endOffset);
  range.setEnd(line, line.childNodes.length);
  return isRangeEmpty(range);
}

/** True when the line has no text and no atomic tags. */
function isLineEmpty(line: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(line);
  return isRangeEmpty(range);
}

/** The screen box of the caret, or null when the layout gives none. */
function getCaretRect(caret: Range): DOMRect | null {
  if (typeof caret.getClientRects !== 'function') return null;
  const rects = Array.from(caret.getClientRects());
  return rects.find((rect) => rect.height > 0) ?? null;
}

/**
 * True when the caret is on the first visual row of a line that wraps.
 * True when the layout gives no boxes (for example in tests).
 */
function isCaretOnFirstRow(line: HTMLElement, caret: Range): boolean {
  const caretRect = getCaretRect(caret);
  const lineRect = line.getBoundingClientRect();
  if (!caretRect || lineRect.height <= 0) return true;
  return caretRect.top - lineRect.top < caretRect.height / 2;
}

/** True when the caret is on the last visual row of a line that wraps. */
function isCaretOnLastRow(line: HTMLElement, caret: Range): boolean {
  const caretRect = getCaretRect(caret);
  const lineRect = line.getBoundingClientRect();
  if (!caretRect || lineRect.height <= 0) return true;
  return lineRect.bottom - caretRect.bottom < caretRect.height / 2;
}

/** The fence block when it hides its ``` lines, else null. */
function asHidingBlock(node: Node | null): HTMLElement | null {
  return isCodeFenceBlock(node) && blockHidesMarkers(node) ? node : null;
}

/**
 * Compute what a key does at the edge of a fence block, from the DOM and the
 * caret. Does not change the DOM.
 *
 * @returns null when the key gets the browser default behavior
 */
export function computeCodeFenceKeyAction(
  editable: HTMLElement,
  key: string
): CodeFenceKeyAction | null {
  if (!NAVIGATION_KEYS.has(key)) return null;
  const selection = getSelectionInside(editable);
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
  const caret = selection.getRangeAt(0);
  const line = findLineElement(editable, caret.startContainer);
  if (!line) return null;

  const block = asHidingBlock(line.parentElement);
  if (block) {
    const visible = getVisibleFenceLines(block);
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (!first || line.classList.contains(CODE_FENCE_MARKER_CLASS)) return null;

    switch (key) {
      case 'ArrowDown':
        return line === last && isCaretOnLastRow(line, caret) ? { type: 'exit-after', block } : null;
      case 'ArrowRight':
        return line === last && isCaretAtLineEnd(line, caret) ? { type: 'exit-after', block } : null;
      case 'ArrowUp':
        return line === first && isCaretOnFirstRow(line, caret)
          ? { type: 'exit-before', block }
          : null;
      case 'ArrowLeft':
        return line === first && isCaretAtLineStart(line, caret)
          ? { type: 'exit-before', block }
          : null;
      case 'Backspace':
        if (line !== first || !isCaretAtLineStart(line, caret)) return null;
        if (!isLineEmpty(line)) return { type: 'prevent' };
        return visible.length === 1
          ? { type: 'remove-fence', block }
          : { type: 'remove-empty-line', line, next: visible[1] };
      case 'Delete':
        return line === last && isClosedFenceBlock(block) && isCaretAtLineEnd(line, caret)
          ? { type: 'prevent' }
          : null;
      default:
        return null;
    }
  }

  if (line.parentElement !== editable) return null;

  if (key === 'Backspace') {
    const before = asHidingBlock(line.previousSibling);
    if (before && isCaretAtLineStart(line, caret)) {
      return { type: 'enter-block-end', block: before, removeLine: isLineEmpty(line) ? line : null };
    }
  }
  if (key === 'Delete') {
    const after = asHidingBlock(line.nextSibling);
    if (after && isCaretAtLineEnd(line, caret)) {
      return { type: 'enter-block-start', block: after, removeLine: isLineEmpty(line) ? line : null };
    }
  }
  return null;
}

/** Add a closing ``` line to an unclosed fence block. */
function closeFenceBlock(block: HTMLElement): void {
  const lines = getFenceLines(block);
  const opening = lines[0]?.textContent ?? '';
  const ticks = /`{3,}/.exec(opening)?.[0] ?? '```';
  const closing = document.createElement('div');
  closing.className = `${CODE_FENCE_LINE_CLASS} ${CODE_FENCE_MARKER_CLASS}`;
  closing.textContent = ticks;
  const last = lines[lines.length - 1];
  if (last) last.after(closing);
  else block.appendChild(closing);
  block.setAttribute('data-fence-closed', 'true');
}

function scrollCaretLineIntoView(editable: HTMLElement): void {
  const selection = getSelectionInside(editable);
  const node = selection?.anchorNode;
  const element = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement
    : null;
  element?.scrollIntoView?.({ block: 'nearest' });
}

/**
 * Apply a key action to the DOM.
 *
 * @returns true when the text changed
 */
export function applyCodeFenceKeyAction(
  editable: HTMLElement,
  action: CodeFenceKeyAction
): boolean {
  let textChanged = false;

  switch (action.type) {
    case 'exit-after': {
      const { block } = action;
      if (!isClosedFenceBlock(block)) {
        closeFenceBlock(block);
        textChanged = true;
      }
      const next = block.nextSibling;
      if (next) {
        placeCaretAtLineStart(next);
      } else {
        const line = createEmptyLine();
        block.after(line);
        setCaret(line, 0);
        textChanged = true;
      }
      break;
    }
    case 'exit-before': {
      const { block } = action;
      const previous = block.previousSibling;
      if (previous) {
        placeCaretAtLineEnd(previous);
      } else {
        const line = createEmptyLine();
        block.before(line);
        setCaret(line, 0);
        textChanged = true;
      }
      break;
    }
    case 'remove-fence': {
      const line = createEmptyLine();
      action.block.replaceWith(line);
      setCaret(line, 0);
      textChanged = true;
      break;
    }
    case 'remove-empty-line':
      action.line.remove();
      placeCaretAtLineStart(action.next);
      textChanged = true;
      break;
    case 'enter-block-end':
      if (action.removeLine) {
        action.removeLine.remove();
        textChanged = true;
      }
      placeCaretAtLineEnd(action.block);
      break;
    case 'enter-block-start':
      if (action.removeLine) {
        action.removeLine.remove();
        textChanged = true;
      }
      placeCaretAtLineStart(action.block);
      break;
    case 'prevent':
      break;
  }

  if (textChanged) {
    // Rebuild the blocks for the new text (badge, hidden ``` lines). The
    // caret stays at the same text offset.
    decorateCodeFences(editable, { allowNewLine: false });
  }
  scrollCaretLineIntoView(editable);
  return textChanged;
}

/** Tell the input that the text changed (runs handleInput). */
function notifyInput(editable: HTMLElement): void {
  editable.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Handle a keydown at the edge of a code fence block.
 *
 * Only plain keys count (no Shift, Alt, Ctrl or Cmd). Call it after the
 * completion menus and the input history had the key.
 *
 * @returns true when the key was handled (preventDefault was called)
 */
export function handleCodeFenceNavigationKey(
  event: KeyLike,
  editable: HTMLElement | null | undefined
): boolean {
  if (!editable || !NAVIGATION_KEYS.has(event.key)) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (!editable.querySelector(`.${CODE_FENCE_CLASS}`) && !(editable.textContent ?? '').includes('```')) {
    return false;
  }

  // Arrow keys: make the DOM current first (the decoration is debounced
  // after typing). Backspace and Delete use the DOM as it is, so that a
  // Backspace right after the user typed ``` removes a backtick.
  if (event.key.startsWith('Arrow')) {
    const offsetBefore = getSelectionInside(editable) ? getVirtualCursorPosition(editable) : -1;
    let textChanged = false;
    decorateCodeFences(editable, {
      onTextChange: () => {
        textChanged = true;
      },
    });
    const offsetAfter = getSelectionInside(editable) ? getVirtualCursorPosition(editable) : -1;
    if (textChanged || offsetAfter !== offsetBefore) {
      // The caret moved out of a hidden ``` line. That is the move.
      event.preventDefault();
      if (textChanged) notifyInput(editable);
      return true;
    }
  }

  const action = computeCodeFenceKeyAction(editable, event.key);
  if (!action) return false;

  event.preventDefault();
  if (applyCodeFenceKeyAction(editable, action)) notifyInput(editable);
  return true;
}
