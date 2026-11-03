import {
  createQuoteTagElement,
  getAtomicTagTextLength,
  getQuotePreview,
  getQuoteTagText,
} from './quoteTag.js';
import { getVirtualCursorPosition, setVirtualCursorPosition } from './virtualCursorUtils.js';
import { extractEditableText } from '../hooks/useTextContent.js';

describe('quoteTag', () => {
  it('gives the markdown block quote without trailing newlines', () => {
    const chip = createQuoteTagElement('one\n\ntwo')!;
    expect(getQuoteTagText(chip)).toBe('> one\n>\n> two');
    expect(getAtomicTagTextLength(chip)).toBe('> one\n>\n> two'.length);
  });

  it('uses the first non-empty line as preview', () => {
    expect(getQuotePreview('\n\n  hello world  \nnext')).toBe('hello world');
    expect(getQuotePreview('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`);
  });

  it('returns null for whitespace-only text', () => {
    expect(createQuoteTagElement(' \n ')).toBeNull();
  });

  it('counts a quote chip as its text length for the virtual cursor', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    const chip = createQuoteTagElement('quoted')!;
    editable.appendChild(chip);
    const br = document.createElement('br');
    editable.appendChild(br);
    const text = document.createTextNode('abc');
    editable.appendChild(text);

    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const offset = getVirtualCursorPosition(editable);
    expect(extractEditableText(editable).slice(0, offset)).toBe('> quoted\nab');

    window.getSelection()?.removeAllRanges();
    expect(setVirtualCursorPosition(editable, offset)).toBe(true);
    const restored = window.getSelection()!.getRangeAt(0);
    expect(restored.startContainer).toBe(text);
    expect(restored.startOffset).toBe(2);

    document.body.removeChild(editable);
  });
});
