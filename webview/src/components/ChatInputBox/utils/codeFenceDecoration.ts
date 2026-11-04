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
 *   <div class="input-code-fence input-code-fence-hide-markers" data-fence="1"
 *        data-fence-closed="true">
 *     <span class="input-code-fence-lang" contenteditable="false" data-lang="ts"></span>
 *     <div class="input-code-fence-line input-code-fence-marker">```ts</div>
 *     <div class="input-code-fence-line">const a = 1;</div>
 *     <div class="input-code-fence-line"><br></div>          (empty line)
 *     <div class="input-code-fence-line input-code-fence-marker">```</div>
 *   </div>
 *   <div>more text</div>
 *
 * Each line is a <div>. The <div> rule of extractEditableText and of the
 * virtual cursor utilities gives the newline between the lines.
 *
 * When a block has 1 or more content lines, the CSS hides the ``` lines
 * (class input-code-fence-hide-markers). The ``` lines stay in the DOM, thus
 * the text does not change. The caret must not stay in a hidden ``` line:
 * ensureCaretOutsideHiddenMarker moves it to a visible line.
 *
 * A closed fence with a language shows the language in a badge. The badge
 * is an empty element. The CSS shows its data-lang value, thus the badge
 * gives no text.
 *
 * Inline code: on a line outside of a fence, a pair of single backticks
 * (`foo.ts`) shows as inline code. The decoration occurs only when the
 * closing backtick is in the text:
 *
 *   <div>see <span class="input-inline-code"><span class="input-inline-code-tick"
 *        contenteditable="false">`</span>foo.ts<span class="input-inline-code-tick"
 *        contenteditable="false">`</span></span> here</div>
 *
 * The CSS hides the backtick spans, but they stay in the DOM, thus the text
 * does not change. The caret must not stay in a backtick span:
 * ensureCaretOutsideHiddenTick moves it to a visible position at the same
 * text offset.
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
/** A fence block that hides its ``` lines (it has 1 or more content lines) */
export const CODE_FENCE_HIDE_MARKERS_CLASS = 'input-code-fence-hide-markers';
/** The language badge of a closed fence (an empty, non-editable element) */
export const CODE_FENCE_LANG_CLASS = 'input-code-fence-lang';

/** An inline code span (`foo`) on a line outside of a fence */
export const INLINE_CODE_CLASS = 'input-inline-code';
/** A hidden backtick of an inline code span */
export const INLINE_CODE_TICK_CLASS = 'input-inline-code-tick';

/** Text that must occur in the input before it can have a code fence. */
const FENCE_HINT = '```';
/** Text that must occur in the input before the decoration parses it. */
const BACKTICK = '`';

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

/** An inline code pair in one line, as character indexes. */
export interface InlineCodeRange {
  /** Index of the opening backtick */
  start: number;
  /** Index of the closing backtick */
  end: number;
}

/**
 * Find the inline code pairs (`foo`) in one line.
 *
 * - Only a run of exactly 1 backtick is a tick. Runs of 2 or more (for
 *   example ```) are plain text.
 * - The ticks pair from left to right: `a` and `b` gives 2 pairs.
 * - A pair shows as inline code only when the text between the ticks is
 *   not empty and has no backtick and no atomic tag (file tag or quote chip).
 *   Such a pair stays plain text, and the next tick starts a new pair.
 */
export function findInlineCodeRanges(line: string): InlineCodeRange[] {
  if (!line.includes(BACKTICK)) return [];

  const ticks: number[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== BACKTICK) {
      i++;
      continue;
    }
    let runEnd = i;
    while (runEnd < line.length && line[runEnd] === BACKTICK) runEnd++;
    if (runEnd - i === 1) ticks.push(i);
    i = runEnd;
  }

  const ranges: InlineCodeRange[] = [];
  for (let k = 0; k + 1 < ticks.length; k += 2) {
    const start = ticks[k];
    const end = ticks[k + 1];
    const content = line.slice(start + 1, end);
    if (content && !content.includes(BACKTICK) && !content.includes(ATOMIC_PLACEHOLDER)) {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

/** The selection when its anchor is inside the element, else null. */
export function getSelectionInside(editable: HTMLElement): Selection | null {
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

/** Append text to the parent. Each placeholder gives the next atomic tag. */
function appendTextWithTags(
  parent: HTMLElement,
  text: string,
  atomicTags: readonly HTMLElement[],
  nextTag: { index: number }
): void {
  const parts = text.split(ATOMIC_PLACEHOLDER);
  parts.forEach((part, i) => {
    if (i > 0) {
      const tag = atomicTags[nextTag.index++];
      if (tag) parent.appendChild(tag.cloneNode(true));
    }
    if (part) parent.appendChild(document.createTextNode(part));
  });
}

/** Build a hidden backtick of an inline code span. */
function createInlineCodeTick(): HTMLSpanElement {
  const tick = document.createElement('span');
  tick.className = INLINE_CODE_TICK_CLASS;
  // The caret cannot go into the tick, and Backspace removes it as 1 unit
  tick.setAttribute('contenteditable', 'false');
  tick.textContent = BACKTICK;
  return tick;
}

/** Build an inline code span: hidden tick, code text, hidden tick. */
function createInlineCode(content: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = INLINE_CODE_CLASS;
  span.appendChild(createInlineCodeTick());
  span.appendChild(document.createTextNode(content));
  span.appendChild(createInlineCodeTick());
  return span;
}

/**
 * Build the nodes of one line. An empty line gets a <br> placeholder.
 * The inline code ranges must not contain atomic placeholders.
 */
function buildLine(
  line: string,
  atomicTags: readonly HTMLElement[],
  nextTag: { index: number },
  className: string | null,
  inlineCode: readonly InlineCodeRange[] = []
): HTMLDivElement {
  const div = document.createElement('div');
  if (className) div.className = className;

  if (line === '') {
    div.appendChild(document.createElement('br'));
    return div;
  }

  let position = 0;
  for (const range of inlineCode) {
    appendTextWithTags(div, line.slice(position, range.start), atomicTags, nextTag);
    div.appendChild(createInlineCode(line.slice(range.start + 1, range.end)));
    position = range.end + 1;
  }
  appendTextWithTags(div, line.slice(position), atomicTags, nextTag);
  return div;
}

/**
 * The language of an opening fence line: the first word of the text after
 * the backticks. An empty string when the line has no language.
 */
export function getFenceLanguage(openingLine: string): string {
  const match = OPEN_FENCE_RE.exec(openingLine);
  if (!match) return '';
  const info = match[2].split(ATOMIC_PLACEHOLDER).join('').trim();
  return info.split(/\s+/)[0] ?? '';
}

/**
 * Build the language badge. It has no child nodes: the CSS shows the
 * data-lang value, thus the badge gives no text to extractEditableText and
 * to the caret utilities.
 */
function createLanguageBadge(lang: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = CODE_FENCE_LANG_CLASS;
  badge.setAttribute('contenteditable', 'false');
  badge.setAttribute('data-lang', lang);
  return badge;
}

/** Build the decorated nodes for the lines in a detached container. */
function buildDecoratedContainer(
  lines: readonly string[],
  ranges: readonly CodeFenceRange[],
  inlineCode: readonly (readonly InlineCodeRange[])[],
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
      block.setAttribute('data-fence-closed', range.closed ? 'true' : 'false');
      const lastContent = range.closed ? range.end - 1 : range.end;
      const hasContent = lastContent > range.start;
      if (hasContent) {
        block.classList.add(CODE_FENCE_HIDE_MARKERS_CLASS);
        const lang = range.closed ? getFenceLanguage(lines[range.start]) : '';
        if (lang) block.appendChild(createLanguageBadge(lang));
      }
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
    container.appendChild(buildLine(lines[i], atomicTags, nextTag, null, inlineCode[i]));
  }
  return container;
}

/**
 * The inline code ranges of each line. The lines in a fence get none.
 */
function findInlineCodeByLine(
  lines: readonly string[],
  ranges: readonly CodeFenceRange[]
): InlineCodeRange[][] {
  const result: InlineCodeRange[][] = lines.map(() => []);
  let rangeIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const range = ranges[rangeIndex];
    if (range && i >= range.start) {
      i = range.end;
      rangeIndex++;
      continue;
    }
    result[i] = findInlineCodeRanges(lines[i]);
  }
  return result;
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


/* ------------------------------------------------------------------
 * Lines, hidden ``` lines and caret placement
 * ------------------------------------------------------------------ */

/** True when the node is a code fence block. */
export function isCodeFenceBlock(node: Node | null | undefined): node is HTMLElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).classList.contains(CODE_FENCE_CLASS)
  );
}

/** True when the fence block hides its ``` lines. */
export function blockHidesMarkers(block: HTMLElement): boolean {
  return block.classList.contains(CODE_FENCE_HIDE_MARKERS_CLASS);
}

/** True when the element is a ``` line that the CSS hides. */
export function isHiddenMarkerLine(element: Element): boolean {
  const block = element.parentElement;
  return (
    element.classList.contains(CODE_FENCE_MARKER_CLASS) &&
    isCodeFenceBlock(block) &&
    blockHidesMarkers(block)
  );
}

/** The line <div> elements of a fence block (``` lines included). */
export function getFenceLines(block: HTMLElement): HTMLElement[] {
  return Array.from(block.children).filter((child): child is HTMLElement =>
    child.classList.contains(CODE_FENCE_LINE_CLASS)
  );
}

/** The visible line elements of a fence block. */
export function getVisibleFenceLines(block: HTMLElement): HTMLElement[] {
  return getFenceLines(block).filter((line) => !isHiddenMarkerLine(line));
}

/** True when the fence block has a closing ``` line. */
export function isClosedFenceBlock(block: HTMLElement): boolean {
  const closedAttr = block.getAttribute('data-fence-closed');
  if (closedAttr !== null) return closedAttr === 'true';
  const lines = getFenceLines(block);
  return lines.length > 1 && lines[lines.length - 1].classList.contains(CODE_FENCE_MARKER_CLASS);
}

/** Put a collapsed caret at the DOM position. */
export function setCaret(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Put the caret at the start of a line. For a fence block, the line is the
 * first visible line of the block.
 */
export function placeCaretAtLineStart(line: Node): void {
  let target: Node = line;
  if (isCodeFenceBlock(line)) {
    const first = getVisibleFenceLines(line)[0];
    if (first) target = first;
  }
  setCaret(target, 0);
}

/**
 * Put the caret at the end of a line. For a fence block, the line is the
 * last visible line of the block.
 */
export function placeCaretAtLineEnd(line: Node): void {
  let target: Node = line;
  if (isCodeFenceBlock(line)) {
    const lines = getVisibleFenceLines(line);
    const last = lines[lines.length - 1];
    if (last) target = last;
  }
  if (target.nodeType === Node.TEXT_NODE) {
    setCaret(target, target.textContent?.length ?? 0);
    return;
  }
  const last = target.lastChild;
  if (!last) {
    setCaret(target, 0);
  } else if (last.nodeType === Node.TEXT_NODE) {
    setCaret(last, last.textContent?.length ?? 0);
  } else if ((last as HTMLElement).tagName?.toLowerCase() === 'br') {
    // The <br> placeholder of the line: put the caret before it
    setCaret(target, target.childNodes.length - 1);
  } else {
    setCaret(target, target.childNodes.length);
  }
}

/** Make an empty line: <div><br></div>. */
export function createEmptyLine(): HTMLDivElement {
  const div = document.createElement('div');
  div.appendChild(document.createElement('br'));
  return div;
}

/** The element that holds the node, or the node when it is an element. */
function toElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export type CaretSnapResult = 'none' | 'moved' | 'text-changed';

/**
 * When the collapsed caret is in a hidden ``` line, move it to a visible line.
 *
 * - In the opening ``` line: to the start of the first content line.
 * - In the closing ``` line: to the start of the line after the block. When
 *   no line follows the block and allowNewLine is true, add an empty line
 *   after the block (the text gets a newline). Else, to the end of the last
 *   content line.
 *
 * @returns 'text-changed' when a new line was added
 */
export function ensureCaretOutsideHiddenMarker(
  editable: HTMLElement,
  allowNewLine: boolean
): CaretSnapResult {
  const selection = getSelectionInside(editable);
  if (!selection || !selection.isCollapsed || !selection.anchorNode) return 'none';

  const anchorElement = toElement(selection.anchorNode);
  const marker = anchorElement?.closest(`.${CODE_FENCE_MARKER_CLASS}`);
  if (!marker || !editable.contains(marker) || !isHiddenMarkerLine(marker)) return 'none';

  const block = marker.parentElement as HTMLElement;
  const lines = getFenceLines(block);
  if (marker === lines[0]) {
    placeCaretAtLineStart(block);
    return 'moved';
  }

  const next = block.nextSibling;
  if (next) {
    placeCaretAtLineStart(next);
    return 'moved';
  }
  if (allowNewLine) {
    const line = createEmptyLine();
    block.after(line);
    setCaret(line, 0);
    return 'text-changed';
  }
  placeCaretAtLineEnd(block);
  return 'moved';
}

/** The index of the node in its parent. */
function childIndex(node: Node): number {
  return node.parentNode ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) : -1;
}

/** A visible caret position at the edge of an inline code span. */
type InlineCodeSlot = 'before' | 'code-start' | 'code-end' | 'after';

/** The code text node of an inline code span (null for a span with no code text). */
function getInlineCodeText(span: HTMLElement): Text | null {
  for (const child of Array.from(span.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text;
  }
  return null;
}

/**
 * The inline code span and the visible slot for a collapsed caret that is at
 * a hidden position of the span, or null when the caret is at a visible
 * position. Hidden positions:
 *
 * - In a hidden backtick (for example after the End key).
 * - Anchored on the span itself, between its child nodes (for example after
 *   ArrowRight from the end of the code text: Chromium stops after the
 *   hidden closing backtick, and a second ArrowRight does not move).
 */
function findHiddenInlineCodePosition(
  editable: HTMLElement,
  selection: Selection
): { span: HTMLElement; slot: InlineCodeSlot } | null {
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const offset = selection.anchorOffset;

  const anchorElement = toElement(anchor);
  const tick = anchorElement?.closest(`.${INLINE_CODE_TICK_CLASS}`);
  if (tick) {
    if (!editable.contains(tick)) return null;
    const span = tick.parentElement;
    if (!span || !span.classList.contains(INLINE_CODE_CLASS) || !span.parentNode) return null;
    // The caret is before (false) or after (true) the backtick character
    const afterTick = anchor === tick ? offset > 0 : offset >= (anchor.textContent?.length ?? 0);
    const isOpening = tick === span.firstChild;
    if (isOpening) return { span, slot: afterTick ? 'code-start' : 'before' };
    return { span, slot: afterTick ? 'after' : 'code-end' };
  }

  if (
    anchor.nodeType === Node.ELEMENT_NODE &&
    (anchor as HTMLElement).classList.contains(INLINE_CODE_CLASS) &&
    editable.contains(anchor) &&
    anchor.parentNode
  ) {
    const span = anchor as HTMLElement;
    const code = getInlineCodeText(span);
    if (!code) return { span, slot: offset <= 1 ? 'before' : 'after' };
    const codeIndex = childIndex(code);
    if (offset < codeIndex) return { span, slot: 'before' };
    if (offset === codeIndex) return { span, slot: 'code-start' };
    if (offset === codeIndex + 1) return { span, slot: 'code-end' };
    return { span, slot: 'after' };
  }

  return null;
}

/**
 * When the collapsed caret is at a hidden position of an inline code span
 * (in a hidden backtick, or anchored on the span between its child nodes),
 * move it to the visible position at the same text offset:
 *
 * - Before the opening backtick: before the span.
 * - After the opening backtick: the start of the code text.
 * - Before the closing backtick: the end of the code text.
 * - After the closing backtick: after the span.
 *
 * Chromium does not move the caret out of these positions with the arrow
 * keys, and typed text goes into the span or nowhere. Call it on every
 * selection change.
 *
 * @returns true when the caret moved
 */
export function ensureCaretOutsideHiddenTick(editable: HTMLElement): boolean {
  const selection = getSelectionInside(editable);
  if (!selection || !selection.isCollapsed || !selection.anchorNode) return false;

  const found = findHiddenInlineCodePosition(editable, selection);
  if (!found) return false;
  const { span, slot } = found;
  const parent = span.parentNode as Node;
  const spanIndex = childIndex(span);
  const code = getInlineCodeText(span);

  switch (slot) {
    case 'before':
      setCaret(parent, spanIndex);
      break;
    case 'after':
      setCaret(parent, spanIndex + 1);
      break;
    case 'code-start':
      // Not a normal span (no code text): put the caret outside of it
      if (code) setCaret(code, 0);
      else setCaret(parent, spanIndex);
      break;
    case 'code-end':
      if (code) setCaret(code, code.textContent?.length ?? 0);
      else setCaret(parent, spanIndex + 1);
      break;
  }
  return true;
}

export interface DecorateCodeFencesOptions {
  /**
   * Called when the decoration changes the text. This occurs only when it
   * adds an empty line after a block to move the caret out of a hidden
   * closing ``` line.
   */
  onTextChange?: () => void;
  /**
   * Allow an empty line after a block for the caret (see
   * ensureCaretOutsideHiddenMarker). Default: true when the editable element
   * has the focus.
   */
  allowNewLine?: boolean;
}

/**
 * Show the markdown code of the editable element: code fences as code
 * blocks, and `inline code` on the other lines as inline code spans.
 *
 * - Does not touch the DOM when the text has no backtick and no decoration.
 * - Does not touch the DOM when the text is very large.
 * - Removes the decoration when the text has no code any more (for example
 *   when the user deletes a backtick).
 * - Changes the DOM only when the structure changes (idempotent).
 * - Keeps the text: when the rebuilt DOM gives a different text, the DOM
 *   does not change.
 * - Keeps the caret at the same text offset. When that offset is in a hidden
 *   ``` line, moves the caret to a visible line. When the caret is in a
 *   hidden backtick of an inline code span, moves it to the visible position
 *   at the same text offset (after the span for the closing backtick).
 *
 * @returns true when the DOM changed
 */
export function decorateInputMarkup(
  editable: HTMLElement,
  options: DecorateCodeFencesOptions = {}
): boolean {
  const hasDecoration =
    editable.querySelector(`.${CODE_FENCE_CLASS}, .${INLINE_CODE_CLASS}`) !== null;
  if (!hasDecoration && !(editable.textContent ?? '').includes(BACKTICK)) {
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
  const inlineCode = findInlineCodeByLine(lines, ranges);
  const hasInlineCode = inlineCode.some((line) => line.length > 0);
  if (ranges.length === 0 && !hasInlineCode && !hasDecoration) return false;

  const container = buildDecoratedContainer(lines, ranges, inlineCode, atomicTags);
  let changed = false;
  if (!haveSameChildren(container, editable)) {
    // The text must stay exactly the user's text
    const text = extractEditableText(editable);
    if (extractEditableText(container) !== text) return false;

    const hasCaret = getSelectionInside(editable) !== null;
    const caretOffset = hasCaret ? getVirtualCursorPosition(editable) : 0;

    editable.replaceChildren(...Array.from(container.childNodes));

    if (hasCaret) {
      setVirtualCursorPosition(editable, caretOffset);
    }
    changed = true;
  }

  const allowNewLine = options.allowNewLine ?? document.activeElement === editable;
  if (ensureCaretOutsideHiddenMarker(editable, allowNewLine) === 'text-changed') {
    options.onTextChange?.();
    return true;
  }
  ensureCaretOutsideHiddenTick(editable);
  return changed;
}

/**
 * The old name of decorateInputMarkup. It decorates the code fences and the
 * inline code.
 */
export const decorateCodeFences = decorateInputMarkup;

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
