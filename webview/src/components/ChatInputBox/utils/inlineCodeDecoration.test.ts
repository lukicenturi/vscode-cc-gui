import {
  CODE_FENCE_CLASS,
  INLINE_CODE_CLASS,
  INLINE_CODE_TICK_CLASS,
  decorateInputMarkup,
  ensureCaretOutsideHiddenTick,
  findInlineCodeRanges,
  setCaret,
} from './codeFenceDecoration.js';
import { extractEditableText } from '../hooks/useTextContent.js';
import {
  getVirtualCursorPosition,
  setVirtualCursorPosition,
} from './virtualCursorUtils.js';

function makeEditable(text: string): HTMLDivElement {
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  // Same form as renderFileTags gives: text with '\n'
  editable.appendChild(document.createTextNode(text));
  document.body.appendChild(editable);
  return editable;
}

function makeFileTag(path: string): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.className = 'file-tag';
  tag.setAttribute('contenteditable', 'false');
  tag.setAttribute('data-file-path', path);
  tag.textContent = path.split('/').pop() ?? path;
  return tag;
}

function inlineSpans(editable: HTMLElement): HTMLElement[] {
  return Array.from(editable.querySelectorAll<HTMLElement>(`.${INLINE_CODE_CLASS}`));
}

/** The code text of a span (the text without the hidden ticks). */
function codeText(span: HTMLElement): string {
  return Array.from(span.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join('');
}

function caretIsInTick(): boolean {
  const node = window.getSelection()?.anchorNode ?? null;
  if (!node) return false;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(`.${INLINE_CODE_TICK_CLASS}`) != null;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('findInlineCodeRanges', () => {
  it('finds a closed pair', () => {
    expect(findInlineCodeRanges('see `foo.ts` here')).toEqual([{ start: 4, end: 11 }]);
  });

  it('finds no pair for a lone backtick', () => {
    expect(findInlineCodeRanges('see `foo.ts here')).toEqual([]);
  });

  it('pairs the ticks from left to right', () => {
    expect(findInlineCodeRanges('`a` and `b`')).toEqual([
      { start: 0, end: 2 },
      { start: 8, end: 10 },
    ]);
  });

  it('ignores runs of 2 or more backticks', () => {
    expect(findInlineCodeRanges('use ```code``` here')).toEqual([]);
    expect(findInlineCodeRanges('```ts')).toEqual([]);
    expect(findInlineCodeRanges('``')).toEqual([]);
  });

  it('does not decorate a pair that holds an atomic tag', () => {
    expect(findInlineCodeRanges('`\uE001` and `b`')).toEqual([{ start: 8, end: 10 }]);
  });
});

describe('decorateInputMarkup: inline code', () => {
  it('decorates a closed pair and keeps the text', () => {
    const text = 'see `foo.ts` here';
    const editable = makeEditable(text);

    expect(decorateInputMarkup(editable)).toBe(true);

    const spans = inlineSpans(editable);
    expect(spans).toHaveLength(1);
    expect(codeText(spans[0])).toBe('foo.ts');
    const ticks = spans[0].querySelectorAll(`.${INLINE_CODE_TICK_CLASS}`);
    expect(ticks).toHaveLength(2);
    expect(ticks[0].textContent).toBe('`');
    expect(ticks[1].textContent).toBe('`');
    expect(ticks[0].getAttribute('contenteditable')).toBe('false');
    expect(extractEditableText(editable)).toBe(text);
  });

  it('does not decorate an open backtick', () => {
    const editable = makeEditable('see `foo.ts here');
    const child = editable.firstChild;

    expect(decorateInputMarkup(editable)).toBe(false);
    expect(inlineSpans(editable)).toHaveLength(0);
    expect(editable.firstChild).toBe(child);
  });

  it('decorates two pairs on one line', () => {
    const text = '`a` and `b`';
    const editable = makeEditable(text);

    decorateInputMarkup(editable);

    expect(inlineSpans(editable).map(codeText)).toEqual(['a', 'b']);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('does not decorate backticks on different lines', () => {
    const text = 'start `foo\nbar` end';
    const editable = makeEditable(text);

    expect(decorateInputMarkup(editable)).toBe(false);
    expect(inlineSpans(editable)).toHaveLength(0);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('does not decorate backticks inside a code fence', () => {
    const text = 'see `x`\n```\nconst a = `b`;\n```\nafter `c`';
    const editable = makeEditable(text);

    decorateInputMarkup(editable);

    const block = editable.querySelector<HTMLElement>(`.${CODE_FENCE_CLASS}`);
    expect(block).not.toBeNull();
    expect(block!.querySelector(`.${INLINE_CODE_CLASS}`)).toBeNull();
    expect(inlineSpans(editable).map(codeText)).toEqual(['x', 'c']);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('leaves triple backticks in a line untouched', () => {
    const text = 'use ```code``` here';
    const editable = makeEditable(text);
    const child = editable.firstChild;

    expect(decorateInputMarkup(editable)).toBe(false);
    expect(editable.firstChild).toBe(child);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('is idempotent', () => {
    const editable = makeEditable('a `b` c\n`d`');
    decorateInputMarkup(editable);
    const html = editable.innerHTML;
    const firstLine = editable.firstChild;

    expect(decorateInputMarkup(editable)).toBe(false);
    expect(editable.innerHTML).toBe(html);
    expect(editable.firstChild).toBe(firstLine);
  });

  it('puts the caret after the span when it was after the closing tick', () => {
    const text = 'see `foo`';
    const editable = makeEditable(text);
    setVirtualCursorPosition(editable, text.length);

    decorateInputMarkup(editable);

    const span = inlineSpans(editable)[0];
    const selection = window.getSelection()!;
    expect(caretIsInTick()).toBe(false);
    expect(span.contains(selection.anchorNode)).toBe(false);
    expect(selection.anchorNode).toBe(span.parentNode);
    expect(selection.anchorOffset).toBe(Array.from(span.parentNode!.childNodes).indexOf(span) + 1);
    expect(getVirtualCursorPosition(editable)).toBe(text.length);
  });

  it('puts the caret after the span when text follows the span', () => {
    const text = '`foo` bar';
    const editable = makeEditable(text);
    setVirtualCursorPosition(editable, 5);

    decorateInputMarkup(editable);

    expect(caretIsInTick()).toBe(false);
    expect(inlineSpans(editable)[0].contains(window.getSelection()!.anchorNode)).toBe(false);
    expect(getVirtualCursorPosition(editable)).toBe(5);
  });

  it('puts the caret before the span when it was before the opening tick', () => {
    const editable = makeEditable('`foo` bar');
    setVirtualCursorPosition(editable, 0);

    decorateInputMarkup(editable);

    expect(caretIsInTick()).toBe(false);
    expect(getVirtualCursorPosition(editable)).toBe(0);
  });

  it('keeps the caret in the code text after the opening tick', () => {
    const editable = makeEditable('x `foo` y');
    setVirtualCursorPosition(editable, 3);

    decorateInputMarkup(editable);

    const span = inlineSpans(editable)[0];
    expect(caretIsInTick()).toBe(false);
    expect(window.getSelection()!.anchorNode).toBe(span.childNodes[1]);
    expect(window.getSelection()!.anchorOffset).toBe(0);
    expect(getVirtualCursorPosition(editable)).toBe(3);
  });

  it('dissolves the span when a tick is removed', () => {
    const editable = makeEditable('see `foo` end');
    decorateInputMarkup(editable);
    const span = inlineSpans(editable)[0];

    // Backspace after the closing tick removes the tick element
    span.lastChild!.remove();
    expect(extractEditableText(editable)).toBe('see `foo end');
    setVirtualCursorPosition(editable, 'see `foo'.length);

    expect(decorateInputMarkup(editable)).toBe(true);
    expect(inlineSpans(editable)).toHaveLength(0);
    expect(editable.querySelector(`.${INLINE_CODE_TICK_CLASS}`)).toBeNull();
    expect(extractEditableText(editable)).toBe('see `foo end');
    expect(getVirtualCursorPosition(editable)).toBe('see `foo'.length);
  });

  it('dissolves the span when the opening tick is removed', () => {
    const editable = makeEditable('`foo`');
    decorateInputMarkup(editable);
    inlineSpans(editable)[0].firstChild!.remove();

    decorateInputMarkup(editable);

    expect(inlineSpans(editable)).toHaveLength(0);
    expect(extractEditableText(editable)).toBe('foo`');
  });

  it('moves text typed in the span after the closing tick out of the span', () => {
    const editable = makeEditable('`foo`');
    decorateInputMarkup(editable);
    const span = inlineSpans(editable)[0];
    // The browser can put the next typed text at the end of the span
    span.appendChild(document.createTextNode(' bar'));
    setCaret(span.lastChild!, 4);

    expect(decorateInputMarkup(editable)).toBe(true);

    const spans = inlineSpans(editable);
    expect(spans.map(codeText)).toEqual(['foo']);
    expect(extractEditableText(editable)).toBe('`foo` bar');
    expect(getVirtualCursorPosition(editable)).toBe('`foo` bar'.length);
  });

  it('leaves a file tag inside backticks as plain text and keeps the tag', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    editable.appendChild(document.createTextNode('see `'));
    editable.appendChild(makeFileTag('src/a.ts'));
    editable.appendChild(document.createTextNode('` and `b`'));
    const text = extractEditableText(editable);
    expect(text).toBe('see `@src/a.ts` and `b`');

    decorateInputMarkup(editable);

    expect(inlineSpans(editable).map(codeText)).toEqual(['b']);
    const tags = editable.querySelectorAll('.file-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].closest(`.${INLINE_CODE_CLASS}`)).toBeNull();
    expect(extractEditableText(editable)).toBe(text);
  });

  it('decorates inline code next to a file tag', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    editable.appendChild(makeFileTag('src/a.ts'));
    editable.appendChild(document.createTextNode(' uses `foo()`'));
    const text = extractEditableText(editable);

    decorateInputMarkup(editable);

    expect(editable.querySelectorAll('.file-tag')).toHaveLength(1);
    expect(inlineSpans(editable).map(codeText)).toEqual(['foo()']);
    expect(extractEditableText(editable)).toBe(text);
  });
});

describe('ensureCaretOutsideHiddenTick', () => {
  it('does nothing when the caret is not in a tick', () => {
    const editable = makeEditable('`foo` bar');
    decorateInputMarkup(editable);
    const span = inlineSpans(editable)[0];
    setCaret(span.childNodes[1], 1);

    expect(ensureCaretOutsideHiddenTick(editable)).toBe(false);
    expect(window.getSelection()!.anchorNode).toBe(span.childNodes[1]);
  });

  it('moves the caret before the closing tick to the end of the code text', () => {
    const editable = makeEditable('`foo` bar');
    decorateInputMarkup(editable);
    const span = inlineSpans(editable)[0];
    setCaret(span.lastChild!.firstChild!, 0);

    expect(ensureCaretOutsideHiddenTick(editable)).toBe(true);
    expect(window.getSelection()!.anchorNode).toBe(span.childNodes[1]);
    expect(window.getSelection()!.anchorOffset).toBe(3);
    expect(getVirtualCursorPosition(editable)).toBe(4);
  });
});
