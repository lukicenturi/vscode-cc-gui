import { describe, expect, it } from 'vitest';
import { stripStrayInlineStyles } from './strayInlineStyles';

function editable(html: string): HTMLElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = html;
  return el;
}

describe('stripStrayInlineStyles', () => {
  it('unwraps a span with a typing style and keeps its text', () => {
    const el = editable('<span style="color: rgb(242, 167, 106); font-family: monospace;">hello</span> world');
    expect(stripStrayInlineStyles(el)).toBe(true);
    expect(el.innerHTML).toBe('hello world');
  });

  it('unwraps font and legacy formatting elements', () => {
    const el = editable('<font color="#f2a76a">a</font><b>b</b>');
    stripStrayInlineStyles(el);
    expect(el.innerHTML).toBe('ab');
  });

  it('keeps our own markup and only drops a stray style attribute on it', () => {
    const el = editable('<span class="input-inline-code" style="color: red">`x`</span>');
    expect(stripStrayInlineStyles(el)).toBe(true);
    expect(el.innerHTML).toBe('<span class="input-inline-code">`x`</span>');
  });

  it('keeps the caret text node in place', () => {
    const el = editable('<span style="color: red">abc</span>');
    document.body.appendChild(el);
    const text = el.querySelector('span')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    stripStrayInlineStyles(el);
    expect(el.firstChild).toBe(text);
    expect(sel.anchorNode).toBe(text);
    expect(sel.anchorOffset).toBe(2);
    el.remove();
  });

  it('returns false and leaves clean content alone', () => {
    const el = editable('plain <span class="file-tag">tag</span>');
    expect(stripStrayInlineStyles(el)).toBe(false);
  });
});
