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
});
