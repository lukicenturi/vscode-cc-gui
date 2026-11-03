import {
  CODE_FENCE_CLASS,
  CODE_FENCE_MARKER_CLASS,
  decorateCodeFences,
  findCodeFenceRanges,
  handleEnterInCodeFence,
  isOffsetInsideCodeFence,
} from './codeFenceDecoration.js';
import { extractEditableText } from '../hooks/useTextContent.js';
import { createQuoteTagElement } from './quoteTag.js';
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

function fenceBlocks(editable: HTMLElement): HTMLElement[] {
  return Array.from(editable.querySelectorAll<HTMLElement>(`.${CODE_FENCE_CLASS}`));
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('findCodeFenceRanges', () => {
  it('finds a closed fence with a language', () => {
    expect(findCodeFenceRanges(['intro', '```ts', 'const a = 1;', '```', 'after'])).toEqual([
      { start: 1, end: 3, closed: true },
    ]);
  });

  it('continues an unclosed fence to the last line', () => {
    expect(findCodeFenceRanges(['```', 'a', 'b'])).toEqual([{ start: 0, end: 2, closed: false }]);
  });

  it('does not close a fence with a line that has an info string', () => {
    expect(findCodeFenceRanges(['```', '```js', '```'])).toEqual([
      { start: 0, end: 2, closed: true },
    ]);
  });

  it('needs at least as many backticks to close', () => {
    expect(findCodeFenceRanges(['````', '```', '````'])).toEqual([
      { start: 0, end: 2, closed: true },
    ]);
  });

  it('ignores ``` that is not at the start of a line', () => {
    expect(findCodeFenceRanges(['use ```code``` here'])).toEqual([]);
  });
});

describe('isOffsetInsideCodeFence', () => {
  const text = 'intro\n```ts\ncode\n```\nafter';

  it('is false before the fence', () => {
    expect(isOffsetInsideCodeFence(text, 3)).toBe(false);
  });

  it('is true at the end of the opening line and in the content', () => {
    expect(isOffsetInsideCodeFence(text, 'intro\n```ts'.length)).toBe(true);
    expect(isOffsetInsideCodeFence(text, 'intro\n```ts\nco'.length)).toBe(true);
  });

  it('is true at the start of the closing line', () => {
    expect(isOffsetInsideCodeFence(text, 'intro\n```ts\ncode\n'.length)).toBe(true);
  });

  it('is false at the end of the closing line and after the fence', () => {
    expect(isOffsetInsideCodeFence(text, 'intro\n```ts\ncode\n```'.length)).toBe(false);
    expect(isOffsetInsideCodeFence(text, text.length)).toBe(false);
  });

  it('is true anywhere after an unclosed fence', () => {
    const open = 'hi\n```\nline one\nline two';
    expect(isOffsetInsideCodeFence(open, open.length)).toBe(true);
  });
});

describe('decorateCodeFences', () => {
  it('wraps a single fence with a language and keeps the text', () => {
    const text = 'intro\n```ts\nconst a = 1;\n\nreturn a;\n```';
    const editable = makeEditable(text);

    expect(decorateCodeFences(editable)).toBe(true);

    const blocks = fenceBlocks(editable);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].getAttribute('data-fence')).toBe('1');
    const lines = Array.from(blocks[0].children) as HTMLElement[];
    expect(lines.map((line) => line.textContent)).toEqual([
      '```ts',
      'const a = 1;',
      '',
      'return a;',
      '```',
    ]);
    expect(lines[0].classList.contains(CODE_FENCE_MARKER_CLASS)).toBe(true);
    expect(lines[1].classList.contains(CODE_FENCE_MARKER_CLASS)).toBe(false);
    expect(lines[4].classList.contains(CODE_FENCE_MARKER_CLASS)).toBe(true);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('wraps an unclosed fence to the end and marks only the opening line', () => {
    // Shift+Enter at the end gives <br><br>: the text ends with an empty line
    const editable = makeEditable('```py\nprint(1)');
    editable.appendChild(document.createElement('br'));
    editable.appendChild(document.createElement('br'));
    const text = extractEditableText(editable);
    expect(text).toBe('```py\nprint(1)\n\n');

    decorateCodeFences(editable);

    const blocks = fenceBlocks(editable);
    expect(blocks).toHaveLength(1);
    const lines = Array.from(blocks[0].children) as HTMLElement[];
    expect(lines).toHaveLength(4);
    expect(lines[0].classList.contains(CODE_FENCE_MARKER_CLASS)).toBe(true);
    expect(lines[3].classList.contains(CODE_FENCE_MARKER_CLASS)).toBe(false);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('keeps the text after a fence outside of the block', () => {
    const text = '```\nx\n```\n\nafter text\nlast';
    const editable = makeEditable(text);

    decorateCodeFences(editable);

    const blocks = fenceBlocks(editable);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).not.toContain('after');
    expect(extractEditableText(editable)).toBe(text);
  });

  it('does not touch the DOM when the text has no fence', () => {
    const editable = makeEditable('plain `code` text\nline 2');
    const before = editable.innerHTML;
    const child = editable.firstChild;

    expect(decorateCodeFences(editable)).toBe(false);
    expect(editable.innerHTML).toBe(before);
    expect(editable.firstChild).toBe(child);
  });

  it('is idempotent', () => {
    const editable = makeEditable('a\n```\nb\n```');
    expect(decorateCodeFences(editable)).toBe(true);
    const html = editable.innerHTML;
    expect(decorateCodeFences(editable)).toBe(false);
    expect(editable.innerHTML).toBe(html);
  });

  it('removes the block when the fence is gone', () => {
    const editable = makeEditable('a\n```\nb');
    decorateCodeFences(editable);
    expect(fenceBlocks(editable)).toHaveLength(1);

    // The user deletes the backticks of the opening line
    const openingLine = fenceBlocks(editable)[0].firstElementChild!;
    openingLine.textContent = '';
    openingLine.appendChild(document.createElement('br'));
    const text = extractEditableText(editable);

    expect(decorateCodeFences(editable)).toBe(true);
    expect(fenceBlocks(editable)).toHaveLength(0);
    expect(editable.querySelector(`.${CODE_FENCE_MARKER_CLASS}`)).toBeNull();
    expect(extractEditableText(editable)).toBe(text);
  });

  it('keeps file tags and quote chips', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    editable.appendChild(createQuoteTagElement('quoted line')!);
    editable.appendChild(document.createElement('br'));
    editable.appendChild(document.createElement('br'));
    const fileTag = document.createElement('span');
    fileTag.className = 'file-tag';
    fileTag.setAttribute('contenteditable', 'false');
    fileTag.setAttribute('data-file-path', 'src/a.ts');
    fileTag.textContent = 'a.ts';
    editable.appendChild(fileTag);
    editable.appendChild(document.createTextNode(' see\n```\ncode\n```'));
    const text = extractEditableText(editable);

    expect(decorateCodeFences(editable)).toBe(true);
    expect(editable.querySelectorAll('.quote-tag')).toHaveLength(1);
    expect(editable.querySelectorAll('.file-tag')).toHaveLength(1);
    expect(fenceBlocks(editable)).toHaveLength(1);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('keeps the caret at the same text offset', () => {
    const text = 'intro\n```ts\nconst a = 1;\n```';
    const editable = makeEditable(text);
    const offset = 'intro\n```ts\nconst'.length;
    setVirtualCursorPosition(editable, offset);

    decorateCodeFences(editable);

    expect(getVirtualCursorPosition(editable)).toBe(offset);
  });

  it('puts the caret on an empty line at the start of that line', () => {
    const text = '```\n\nb';
    const editable = makeEditable(text);
    setVirtualCursorPosition(editable, 4);

    decorateCodeFences(editable);

    expect(getVirtualCursorPosition(editable)).toBe(4);
    setVirtualCursorPosition(editable, 5);
    expect(getVirtualCursorPosition(editable)).toBe(5);
  });
});

describe('handleEnterInCodeFence', () => {
  function enterEvent(mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}) {
    return { ...mods, preventDefault: vi.fn() };
  }

  it('inserts a newline when the caret is inside an open fence', () => {
    const editable = makeEditable('```ts\nconst a');
    setVirtualCursorPosition(editable, '```ts\nconst a'.length);
    const event = enterEvent();

    expect(handleEnterInCodeFence(event, editable)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(extractEditableText(editable)).toBe('```ts\nconst a\n');
  });

  it('handles the same key press only once', () => {
    const editable = makeEditable('```\nx');
    setVirtualCursorPosition(editable, 5);
    const nativeEvent = enterEvent();

    expect(handleEnterInCodeFence(nativeEvent, editable)).toBe(true);
    // The React listener gets the same native event
    expect(handleEnterInCodeFence(enterEvent(), editable, nativeEvent)).toBe(true);
    expect(extractEditableText(editable)).toBe('```\nx\n');
  });

  it('does not handle Enter outside of a fence', () => {
    const editable = makeEditable('```\nx\n```\nafter');
    setVirtualCursorPosition(editable, '```\nx\n```\nafter'.length);
    const event = enterEvent();

    expect(handleEnterInCodeFence(event, editable)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not handle Cmd/Ctrl+Enter inside a fence', () => {
    const editable = makeEditable('```\nx');
    setVirtualCursorPosition(editable, 5);

    expect(handleEnterInCodeFence(enterEvent({ metaKey: true }), editable)).toBe(false);
    expect(handleEnterInCodeFence(enterEvent({ ctrlKey: true }), editable)).toBe(false);
    expect(extractEditableText(editable)).toBe('```\nx');
  });
});
