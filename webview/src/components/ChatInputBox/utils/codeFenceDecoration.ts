/**
 * Code fence decoration for the chat input.
 *
 * When the user types a markdown code fence (a line that starts with ```,
 * content lines, and a closing ``` line, or no closing line), the input shows
 * the fenced region as a code block.
 *
 * The text does not change. The ``` lines stay in the content, and
 * extractEditableText gives the same text before and after the decoration.
 *
 * DOM structure when the input has a fence:
 *
 *   <div>plain line</div>
 *   <div class="input-code-fence" data-fence="1">
 *     <div class="input-code-fence-line input-code-fence-marker">```ts</div>
 *     <div class="input-code-fence-line">const a = 1;</div>
 *     <div class="input-code-fence-line"><br></div>          (empty line)
 *     <div class="input-code-fence-line input-code-fence-marker">```</div>
 *   </div>
 *   <div>more text</div>
 *
 * Each line is a <div>. The <div> rule of extractEditableText and of the
 * virtual cursor utilities gives the newline between the lines.
 */

import { extractEditableText } from '../hooks/useTextContent.js';
import {
  getVirtualCursorPosition,
  setVirtualCursorPosition,
} from './virtualCursorUtils.js';
import { QUOTE_TAG_CLASS } from './quoteTag.js';
import { TEXT_LENGTH_THRESHOLDS } from '../../../constants/performance.js';

export const CODE_FENCE_CLASS = 'input-code-fence';
export const CODE_FENCE_LINE_CLASS = 'input-code-fence-line';
export const CODE_FENCE_MARKER_CLASS = 'input-code-fence-marker';

/** Text that must occur in the input before the decoration parses it. */
const FENCE_HINT = '```';

/**
 * Stands in for an atomic tag (file tag or quote chip) in the text that the
 * decoration rebuilds. A Unicode private use character does not occur in
 * normal text.
 */
const ATOMIC_PLACEHOLDER = '';

const ATOMIC_TAG_SELECTOR = `.file-tag, .${QUOTE_TAG_CLASS}`;

/** An opening fence line: up to 3 spaces, 3 or more backticks, an info string. */
const OPEN_FENCE_RE = /^ {0,3}(`{3,})([^`]*)$/;
/** A closing fence line: up to 3 spaces, 3 or more backticks, only spaces after. */
const CLOSE_FENCE_RE = /^ {0,3}(`{3,})\s*$/;

/** A fence region, as line indexes (both inclusive). */
export interface CodeFenceRange {
  /** Index of the opening ``` line */
  start: number;
  /** Index of the closing ``` line, or of the last line when the fence is open */
  end: number;
  /** False when the fence has no closing line */
  closed: boolean;
}

/**
 * Find the code fence regions in a list of lines.
 *
 * A closing line must have at least as many backticks as the opening line.
 * A fence without a closing line continues to the last line.
 */
export function findCodeFenceRanges(lines: readonly string[]): CodeFenceRange[] {
  const ranges: CodeFenceRange[] = [];
  let open: { start: number; ticks: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) open = { start: i, ticks: match[1].length };
      continue;
    }
    const match = CLOSE_FENCE_RE.exec(line);
    if (match && match[1].length >= open.ticks) {
      ranges.push({ start: open.start, end: i, closed: true });
      open = null;
    }
  }

  if (open) {
    ranges.push({ start: open.start, end: lines.length - 1, closed: false });
  }
  return ranges;
}

/**
 * True when the text offset is inside a code fence.
 *
 * Only the text before the offset counts: the offset is inside when the
 * fences before it leave a fence open. Thus the end of an opening line and
 * the start of a closing line are inside, and the end of a closing line is
 * not inside.
 */
export function isOffsetInsideCodeFence(text: string, offset: number): boolean {
  if (!text.includes(FENCE_HINT)) return false;
  const before = text.slice(0, Math.max(0, offset));
  const ranges = findCodeFenceRanges(before.split('\n'));
  const last = ranges[ranges.length - 1];
  return last !== undefined && !last.closed;
}

/** The selection when its anchor is inside the element, else null. */
function getSelectionInside(editable: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  if (!anchor || !editable.contains(anchor)) return null;
  return selection;
}

/** True when the caret of the editable element is inside a code fence. */
export function isCaretInsideCodeFence(editable: HTMLElement): boolean {
  if (!(editable.textContent ?? '').includes(FENCE_HINT)) return false;
  if (!getSelectionInside(editable)) return false;
  const text = extractEditableText(editable);
  const offset = getVirtualCursorPosition(editable);
  return isOffsetInsideCodeFence(text, offset);
}

/** The atomic tags in the order that extractEditableText gives them. */
function getAtomicTags(editable: HTMLElement): HTMLElement[] {
  return Array.from(editable.querySelectorAll<HTMLElement>(ATOMIC_TAG_SELECTOR)).filter(
    (tag) => {
      const parent = tag.parentElement;
      return !parent || parent === editable || !parent.closest(ATOMIC_TAG_SELECTOR);
    }
  );
}

/** Build the nodes of one line. An empty line gets a <br> placeholder. */
function buildLine(
  line: string,
  atomicTags: readonly HTMLElement[],
  nextTag: { index: number },
  className: string | null
): HTMLDivElement {
  const div = document.createElement('div');
  if (className) div.className = className;

  if (line === '') {
    div.appendChild(document.createElement('br'));
    return div;
  }

  const parts = line.split(ATOMIC_PLACEHOLDER);
  parts.forEach((part, i) => {
    if (i > 0) {
      const tag = atomicTags[nextTag.index++];
      if (tag) div.appendChild(tag.cloneNode(true));
    }
    if (part) div.appendChild(document.createTextNode(part));
  });
  return div;
}

/** Build the decorated nodes for the lines in a detached container. */
function buildDecoratedContainer(
  lines: readonly string[],
  ranges: readonly CodeFenceRange[],
  atomicTags: readonly HTMLElement[]
): HTMLDivElement {
  const container = document.createElement('div');
  const nextTag = { index: 0 };
  let rangeIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const range = ranges[rangeIndex];
    if (range && i === range.start) {
      const block = document.createElement('div');
      block.className = CODE_FENCE_CLASS;
      block.setAttribute('data-fence', '1');
      for (let j = range.start; j <= range.end; j++) {
        const isMarker = j === range.start || (range.closed && j === range.end);
        const className = isMarker
          ? `${CODE_FENCE_LINE_CLASS} ${CODE_FENCE_MARKER_CLASS}`
          : CODE_FENCE_LINE_CLASS;
        block.appendChild(buildLine(lines[j], atomicTags, nextTag, className));
      }
      container.appendChild(block);
      i = range.end;
      rangeIndex++;
      continue;
    }
    container.appendChild(buildLine(lines[i], atomicTags, nextTag, null));
  }
  return container;
}

/** True when both elements have the same child nodes. */
function haveSameChildren(a: HTMLElement, b: HTMLElement): boolean {
  if (a.childNodes.length !== b.childNodes.length) return false;
  for (let i = 0; i < a.childNodes.length; i++) {
    if (!a.childNodes[i].isEqualNode(b.childNodes[i])) return false;
  }
  return true;
}

function countOccurrences(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count++;
  return count;
}

/**
 * Show the code fences of the editable element as code blocks.
 *
 * - Does not touch the DOM when the text has no ``` and no fence blocks.
 * - Does not touch the DOM when the text is very large.
 * - Removes the fence blocks when the text has no fences any more.
 * - Changes the DOM only when the structure changes (idempotent).
 * - Keeps the text: when the rebuilt DOM gives a different text, the DOM
 *   does not change.
 * - Keeps the caret at the same text offset.
 *
 * @returns true when the DOM changed
 */
export function decorateCodeFences(editable: HTMLElement): boolean {
  const hasFenceBlocks = editable.querySelector(`.${CODE_FENCE_CLASS}`) !== null;
  if (!hasFenceBlocks && !(editable.textContent ?? '').includes(FENCE_HINT)) {
    return false;
  }

  const atomicTags = getAtomicTags(editable);
  const placeholderText = extractEditableText(editable, {
    quotePlaceholder: ATOMIC_PLACEHOLDER,
    fileTagPlaceholder: ATOMIC_PLACEHOLDER,
  });
  if (countOccurrences(placeholderText, ATOMIC_PLACEHOLDER) !== atomicTags.length) {
    return false;
  }

  // Skip very large text (as renderFileTags does) to prevent a UI freeze
  if (placeholderText.length > TEXT_LENGTH_THRESHOLDS.FILE_TAG_RENDERING) return false;

  const lines = placeholderText.split('\n');
  const ranges = findCodeFenceRanges(lines);
  if (ranges.length === 0 && !hasFenceBlocks) return false;

  const container = buildDecoratedContainer(lines, ranges, atomicTags);
  if (haveSameChildren(container, editable)) return false;

  // The text must stay exactly the user's text
  const text = extractEditableText(editable);
  if (extractEditableText(container) !== text) return false;

  const hasCaret = getSelectionInside(editable) !== null;
  const caretOffset = hasCaret ? getVirtualCursorPosition(editable) : 0;

  editable.replaceChildren(...Array.from(container.childNodes));

  if (hasCaret) {
    setVirtualCursorPosition(editable, caretOffset);
  }
  return true;
}

/**
 * Insert a line break at the caret, as Shift+Enter does.
 * Uses the browser edit command so that the input event and undo work.
 */
export function insertLineBreakAtCaret(editable: HTMLElement): void {
  const execCommand = (document as { execCommand?: Document['execCommand'] }).execCommand;
  if (typeof execCommand === 'function') {
    try {
      if (execCommand.call(document, 'insertLineBreak')) return;
    } catch {
      // Use the fallback below
    }
  }

  const selection = getSelectionInside(editable);
  if (!selection) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  // A <br> at the end of a line does not show a new line. Add a second one.
  let next = br.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent) {
    next = next.nextSibling;
  }
  if (!next) {
    br.after(document.createElement('br'));
  }
  const caret = document.createRange();
  caret.setStartAfter(br);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  editable.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Enter key events that already inserted a newline in a code fence. */
const handledFenceEnterEvents = new WeakSet<object>();

interface EnterKeyLike {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
}

/**
 * When the caret is inside a code fence, a plain Enter inserts a newline
 * instead of sending. Cmd/Ctrl+Enter and Shift+Enter are not changed.
 *
 * The native capture listener and the React listener both get the same
 * keydown event. The event is recorded, so the newline is inserted only once.
 *
 * @param event - The keydown event (native or React)
 * @param editable - The chat input element
 * @param eventKey - The object that identifies the key press. Give the native
 *   event when `event` is a React event.
 * @returns true when the event is an Enter inside a code fence (do not send)
 */
export function handleEnterInCodeFence(
  event: EnterKeyLike,
  editable: HTMLElement | null | undefined,
  eventKey: object = event
): boolean {
  if (handledFenceEnterEvents.has(eventKey)) return true;
  if (!editable || event.metaKey || event.ctrlKey || event.shiftKey) return false;
  if (!isCaretInsideCodeFence(editable)) return false;

  event.preventDefault();
  handledFenceEnterEvents.add(eventKey);
  insertLineBreakAtCaret(editable);
  return true;
}
