import { renderHook } from '@testing-library/react';
import { extractEditableText, useTextContent } from './useTextContent.js';
import { createQuoteTagElement } from '../utils/quoteTag.js';

describe('useTextContent', () => {
  it('does not reuse cached text when different HTML has the same length', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    const editableRef = { current: editable };
    const { result } = renderHook(() => useTextContent({ editableRef }));

    editable.innerHTML = '<span>alpha</span>';
    expect(result.current.getTextContent()).toBe('alpha');

    // The two HTML strings have the same length. A length-only cache returns
    // the stale first value here, which made icon-dependent tag rendering flaky.
    editable.innerHTML = '<span>bravo</span>';
    expect(result.current.getTextContent()).toBe('bravo');

    document.body.removeChild(editable);
  });

  it('gives a quote chip as its markdown block quote', () => {
    const editable = document.createElement('div');
    document.body.appendChild(editable);
    const editableRef = { current: editable };
    const { result } = renderHook(() => useTextContent({ editableRef }));

    editable.appendChild(createQuoteTagElement('  first\n\n\n  second  ')!);
    editable.appendChild(document.createElement('br'));
    editable.appendChild(document.createElement('br'));
    editable.appendChild(document.createTextNode('typed'));

    expect(result.current.getTextContent()).toBe('> first\n>\n> second\n\ntyped');

    document.body.removeChild(editable);
  });

  it('gives a placeholder for a quote chip when one is set', () => {
    const editable = document.createElement('div');
    editable.appendChild(document.createTextNode('a '));
    editable.appendChild(createQuoteTagElement('quoted')!);
    editable.appendChild(document.createTextNode(' b'));

    expect(extractEditableText(editable, { quotePlaceholder: '#' })).toBe('a # b');
    expect(extractEditableText(editable)).toBe('a > quoted b');
  });

  it('reads a code fence block as its lines with newlines between them', () => {
    const editable = document.createElement('div');
    editable.innerHTML = [
      '<div>intro</div>',
      '<div class="input-code-fence" data-fence="1">',
      '<div class="input-code-fence-line input-code-fence-marker">```ts</div>',
      '<div class="input-code-fence-line">const a = 1;</div>',
      '<div class="input-code-fence-line"><br></div>',
      '<div class="input-code-fence-line input-code-fence-marker">```</div>',
      '</div>',
      '<div>after</div>',
    ].join('');

    expect(extractEditableText(editable)).toBe('intro\n```ts\nconst a = 1;\n\n```\nafter');
  });

  it('reads an inline code span with its hidden backticks', () => {
    const editable = document.createElement('div');
    editable.innerHTML = [
      '<div>see ',
      '<span class="input-inline-code">',
      '<span class="input-inline-code-tick" contenteditable="false">`</span>',
      'foo.ts',
      '<span class="input-inline-code-tick" contenteditable="false">`</span>',
      '</span>',
      ' and <span class="input-inline-code">',
      '<span class="input-inline-code-tick" contenteditable="false">`</span>',
      'b',
      '<span class="input-inline-code-tick" contenteditable="false">`</span>',
      '</span></div>',
      '<div>next</div>',
    ].join('');

    expect(extractEditableText(editable)).toBe('see `foo.ts` and `b`\nnext');
  });

  it('gives the same text before and after the inline code decoration', async () => {
    const { decorateInputMarkup } = await import('../utils/codeFenceDecoration.js');
    const editable = document.createElement('div');
    const text = 'a `b` c\n```\n`d`\n```\n`e';
    editable.appendChild(document.createTextNode(text));
    const before = extractEditableText(editable);

    expect(decorateInputMarkup(editable, { allowNewLine: false })).toBe(true);
    expect(editable.querySelectorAll('.input-inline-code')).toHaveLength(1);
    expect(extractEditableText(editable)).toBe(before);
    expect(before).toBe(text);
  });
});
