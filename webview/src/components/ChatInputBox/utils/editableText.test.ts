import { renderHook } from '@testing-library/react';
import { setCaretAtTextOffset, setEditableText, splitQuoteBlocks } from './editableText.js';
import { extractEditableText } from '../hooks/useTextContent.js';
import { useGlobalCallbacks } from '../hooks/useGlobalCallbacks.js';
import { useControlledValueSync } from '../hooks/useControlledValueSync.js';
import { getVirtualCursorPosition } from './virtualCursorUtils.js';

function createEditable(): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  document.body.appendChild(el);
  return el;
}

function insertQuoteChip(editable: HTMLDivElement, rawText: string): void {
  renderHook(() =>
    useGlobalCallbacks({
      editableRef: { current: editable },
      pathMappingRef: { current: new Map<string, string>() },
      getTextContent: () => extractEditableText(editable),
      adjustHeight: vi.fn(),
      renderFileTags: vi.fn(),
      setHasContent: vi.fn(),
      onInput: vi.fn(),
      closeAllCompletions: vi.fn(),
      focusInput: vi.fn(() => editable.focus()),
    })
  );
  window.insertQuoteIntoChatInput?.(rawText);
}

afterEach(() => {
  delete window.insertQuoteIntoChatInput;
  delete window.insertCodeSnippetAtCursor;
  delete window.insertTextIntoChatInput;
  document.body.innerHTML = '';
});

describe('splitQuoteBlocks', () => {
  it('keeps text without a block quote as one text part', () => {
    expect(splitQuoteBlocks('hello\nworld')).toEqual([{ kind: 'text', text: 'hello\nworld' }]);
  });

  it('finds a block quote that is followed by a blank line', () => {
    expect(splitQuoteBlocks('> one\n>\n> two\n\nquestion')).toEqual([
      { kind: 'quote', raw: 'one\n\ntwo' },
      { kind: 'text', text: '\n\nquestion' },
    ]);
  });

  it('keeps the text before the block quote and the line break before it', () => {
    expect(splitQuoteBlocks('intro\n> a\n\n')).toEqual([
      { kind: 'text', text: 'intro\n' },
      { kind: 'quote', raw: 'a' },
      { kind: 'text', text: '\n\n' },
    ]);
  });

  it('finds two block quotes', () => {
    expect(splitQuoteBlocks('> a\n\n> b\n\nx')).toEqual([
      { kind: 'quote', raw: 'a' },
      { kind: 'text', text: '\n\n' },
      { kind: 'quote', raw: 'b' },
      { kind: 'text', text: '\n\nx' },
    ]);
  });

  it.each([
    ['no blank line after the block', '> a\nb'],
    ['block at the end of the text', '> a'],
    ['only one line break after the block', '> a\n'],
    ['a single ">" line', '>\n\nx'],
    ['a block that starts with ">"', '>\n> a\n\nx'],
    ['a block that ends with ">"', '> a\n>\n\nx'],
    ['trailing spaces in the block', '> a  \n\nx'],
    ['two blank quote lines', '> a\n>\n>\n> b\n\nx'],
    ['a common indent in the block', '>  a\n>  b\n\nx'],
    ['">" that is not at a line start', 'x > a\n\ny'],
    ['">" without a space', '>a\n\ny'],
    ['a block quote in a code fence', '```\n> a\n\n```'],
    ['a block quote in an open code fence', '```md\n> a\n\nmore'],
  ])('does not make a chip for %s', (_name, text) => {
    expect(splitQuoteBlocks(text)).toEqual([{ kind: 'text', text }]);
  });

  it('makes a chip after a closed code fence', () => {
    expect(splitQuoteBlocks('```\nx\n```\n> a\n\n')).toEqual([
      { kind: 'text', text: '```\nx\n```\n' },
      { kind: 'quote', raw: 'a' },
      { kind: 'text', text: '\n\n' },
    ]);
  });
});

describe('setEditableText', () => {
  it('sets innerText when the text has no block quote', () => {
    const editable = createEditable();
    expect(setEditableText(editable, 'plain text')).toBe(false);
    expect(editable.querySelector('.quote-tag')).toBeNull();
    expect(editable.textContent).toBe('plain text');
  });

  it('does not make a chip for a hand-typed quote line without a blank line', () => {
    const editable = createEditable();
    expect(setEditableText(editable, '> something')).toBe(false);
    expect(editable.querySelector('.quote-tag')).toBeNull();
  });

  it.each([
    '> one\n>\n> two\n\n',
    '> one\n>\n> two\n\nmy question',
    'intro\n> quoted\n\nafter\nlast line',
    '> a\n\n> b\n\nx',
    'first\n\n> a\n\n',
    '> a\n\nline\n',
    '> a\n\n\n\nfar below',
    '```\ncode\n```\n> a\n\n`x` here',
  ])('round-trips %j through the DOM', (text) => {
    const editable = createEditable();
    expect(setEditableText(editable, text)).toBe(true);
    expect(editable.querySelector('.quote-tag')).not.toBeNull();
    expect(extractEditableText(editable)).toBe(text);
  });

  it('gives the chip the quote lines without the "> " prefix', () => {
    const editable = createEditable();
    setEditableText(editable, 'intro\n> one\n>\n> two\n\nafter');
    const chip = editable.querySelector('.quote-tag')!;
    expect(chip.getAttribute('data-quote')).toBe('one\n\ntwo');
    expect(chip.getAttribute('contenteditable')).toBe('false');
    // [text][br][chip][br][br][text]
    expect(Array.from(editable.childNodes, (node) => node.nodeName)).toEqual([
      '#text',
      'BR',
      'SPAN',
      'BR',
      'BR',
      '#text',
    ]);
  });

  it('restores an inserted quote chip without loss', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('draft'));
    insertQuoteChip(editable, 'line one\n\nline two');
    editable.appendChild(document.createTextNode('my question'));

    const text = extractEditableText(editable);
    expect(text).toBe('draft\n> line one\n>\n> line two\n\nmy question');

    // Restore from the plain text, as history and value sync do
    setEditableText(editable, text);

    const chip = editable.querySelector('.quote-tag');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-quote')).toBe('line one\n\nline two');
    expect(extractEditableText(editable)).toBe(text);
  });

  it('keeps the quote chip when the controlled value syncs the same text back', () => {
    const editable = createEditable();
    insertQuoteChip(editable, 'quoted');
    const text = extractEditableText(editable);
    editable.blur();

    const restored = createEditable();
    const onSynced = vi.fn();
    renderHook(() =>
      useControlledValueSync({
        value: `${text}question`,
        editableRef: { current: restored },
        isComposingRef: { current: false },
        isExternalUpdateRef: { current: false },
        getTextContent: () => extractEditableText(restored),
        setHasContent: vi.fn(),
        adjustHeight: vi.fn(),
        invalidateCache: vi.fn(),
        onSynced,
      })
    );

    expect(restored.querySelector('.quote-tag')).not.toBeNull();
    expect(extractEditableText(restored)).toBe('> quoted\n\nquestion');
    expect(onSynced).toHaveBeenCalled();
  });
});

describe('setCaretAtTextOffset', () => {
  it('counts a quote chip as its text length', () => {
    const editable = createEditable();
    setEditableText(editable, '> quoted\n\n/cmd rest');
    editable.focus();

    const offset = '> quoted\n\n/cmd'.length;
    expect(setCaretAtTextOffset(editable, offset)).toBe(true);
    expect(getVirtualCursorPosition(editable)).toBe(offset);
  });

  it('uses the text offset when the input has no chip', () => {
    const editable = createEditable();
    setEditableText(editable, 'hello world');
    editable.focus();

    expect(setCaretAtTextOffset(editable, 5)).toBe(true);
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer.textContent).toBe('hello world');
    expect(range.startOffset).toBe(5);
  });
});
