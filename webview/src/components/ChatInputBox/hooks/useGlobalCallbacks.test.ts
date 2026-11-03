import { renderHook } from '@testing-library/react';
import { useGlobalCallbacks } from './useGlobalCallbacks.js';
import { useFileTags } from './useFileTags.js';
import { extractEditableText } from './useTextContent.js';

function createEditable(): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  document.body.appendChild(el);

  if (typeof (el as HTMLDivElement & { innerText?: string }).innerText === 'undefined') {
    Object.defineProperty(el, 'innerText', {
      get() {
        return readEditableText(this as HTMLDivElement);
      },
      set(value: string) {
        this.textContent = value;
      },
      configurable: true,
    });
  }

  return el;
}

function readEditableText(element: HTMLDivElement): string {
  let text = '';
  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (node.nodeName === 'BR') {
      text += '\n';
    }
  });
  return text;
}

function placeCaretInsideFirstTextNode(element: HTMLDivElement, offset: number): void {
  const textNode = element.firstChild;
  if (!textNode) {
    throw new Error('editable has no text node');
  }
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderUseGlobalCallbacks(
  editable: HTMLDivElement,
  getTextContent: () => string = () => readEditableText(editable)
) {
  const pathMappingRef = { current: new Map<string, string>() };
  const setHasContent = vi.fn();
  const adjustHeight = vi.fn();
  const renderFileTags = vi.fn();
  const onInput = vi.fn();
  const closeAllCompletions = vi.fn();
  const focusInput = vi.fn(() => editable.focus());

  renderHook(() =>
    useGlobalCallbacks({
      editableRef: { current: editable },
      pathMappingRef,
      getTextContent,
      adjustHeight,
      renderFileTags,
      setHasContent,
      onInput,
      closeAllCompletions,
      focusInput,
    })
  );

  return {
    getTextContent,
    pathMappingRef,
    setHasContent,
    adjustHeight,
    renderFileTags,
    onInput,
  };
}

describe('useGlobalCallbacks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete window.insertCodeSnippetAtCursor;
    delete window.insertTextIntoChatInput;
    delete window.insertQuoteIntoChatInput;
    delete window.handleFilePathFromJava;
    document.body.innerHTML = '';
  });

  it('appends external snippet directly when input is empty', () => {
    const editable = createEditable();
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    window.insertCodeSnippetAtCursor?.('console payload');
    vi.runAllTimers();

    expect(getTextContent()).toBe('console payload ');
  });

  it('appends external snippet on a new line when input already has content', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('draft question'));
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    window.insertCodeSnippetAtCursor?.('console payload');
    vi.runAllTimers();

    expect(getTextContent()).toBe('draft question\nconsole payload ');
  });

  it('inserts external snippet at caret position when caret is inside editable', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('abc'));
    placeCaretInsideFirstTextNode(editable, 1);
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    window.insertCodeSnippetAtCursor?.('XYZ');
    vi.runAllTimers();

    expect(getTextContent()).toBe('aXYZ bc');
  });

  it('falls back to appending at end when caret is not inside editable', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('draft question'));
    // Place caret outside editable to simulate external action (e.g. project tree right-click)
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    window.insertCodeSnippetAtCursor?.('@/path/to/file');
    vi.runAllTimers();

    expect(getTextContent()).toBe('draft question\n@/path/to/file ');
  });

  it('does not wipe existing content when a stale non-collapsed selection exists (#1700)', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('existing draft'));
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    // Simulate the real repro: user selected text inside the box earlier, then went
    // back to the IDE editor and triggered "Add selection to CC GUI". The webview's
    // stale select-all range is still non-collapsed and still anchored in editable.
    editable.blur();
    const selectAll = document.createRange();
    selectAll.selectNodeContents(editable);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectAll);

    window.insertCodeSnippetAtCursor?.('@src/file.ts#L10-20');
    vi.runAllTimers();

    // The snippet is appended at the end; the pre-existing draft must survive.
    expect(getTextContent()).toBe('existing draft\n@src/file.ts#L10-20 ');
  });

  it('handleFilePathFromJava does not wipe content on stale non-collapsed selection (#1700)', () => {
    const editable = createEditable();
    editable.appendChild(document.createTextNode('existing draft'));
    const { getTextContent } = renderUseGlobalCallbacks(editable);

    editable.blur();
    const selectAll = document.createRange();
    selectAll.selectNodeContents(editable);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectAll);

    window.handleFilePathFromJava?.('/abs/path/Helper.ts');
    vi.runAllTimers();

    expect(getTextContent()).toContain('existing draft');
    expect(getTextContent()).toContain('@/abs/path/Helper.ts ');
  });

  it('keeps a legacy non-absolute payload as plain text instead of dropping it', () => {
    const editable = createEditable();
    const { getTextContent, pathMappingRef } = renderUseGlobalCallbacks(editable);

    window.handleFilePathFromJava?.('docs/relative/note.md');
    vi.runAllTimers();

    expect(getTextContent()).toBe('docs/relative/note.md ');
    expect(pathMappingRef.current.size).toBe(0);
    expect(editable.querySelectorAll('.file-tag')).toHaveLength(0);
  });

  it('registers a strict line-number reference with spaces through the generic bridge', () => {
    const editable = createEditable();
    const { getTextContent, pathMappingRef } = renderUseGlobalCallbacks(editable);

    window.insertCodeSnippetAtCursor?.('@C:\\Program Files\\src\\Main.java#L10-12');
    vi.runAllTimers();

    expect(getTextContent()).toBe('@C:\\Program Files\\src\\Main.java#L10-12 ');
    expect(pathMappingRef.current.get('C:\\Program Files\\src\\Main.java')).toBe(
      'C:\\Program Files\\src\\Main.java'
    );
    expect(pathMappingRef.current.get('C:\\Program Files\\src\\Main.java#L10-12')).toBe(
      'C:\\Program Files\\src\\Main.java'
    );
  });

  it('registers explicit file references sent through insertCodeSnippetAtCursor (sendFilePath)', () => {
    const editable = createEditable();
    const { getTextContent, pathMappingRef } = renderUseGlobalCallbacks(editable);

    // The VS Code host sends `@path1 @path2` as one string through this
    // generic bridge (ccGui.sendFilePath), so explicit absolute references
    // must be registered here for chip rendering to survive the multi-@
    // fallback guard.
    window.insertCodeSnippetAtCursor?.(
      '@C:\\project\\templates\\view file.xml @C:\\project\\pages\\index.vue'
    );
    vi.runAllTimers();

    expect(getTextContent()).toBe(
      '@C:\\project\\templates\\view file.xml @C:\\project\\pages\\index.vue '
    );
    expect(pathMappingRef.current.get('view file.xml')).toBe(
      'C:\\project\\templates\\view file.xml'
    );
    expect(pathMappingRef.current.get('index.vue')).toBe(
      'C:\\project\\pages\\index.vue'
    );
  });

  describe('insertTextIntoChatInput', () => {
    function caretIsAtEnd(editable: HTMLDivElement): boolean {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      const endRange = document.createRange();
      endRange.selectNodeContents(editable);
      endRange.collapse(false);
      return range.collapsed && range.compareBoundaryPoints(Range.START_TO_START, endRange) === 0;
    }

    it('appends text to an empty input, updates state and focuses the input', () => {
      const editable = createEditable();
      const { getTextContent, setHasContent, adjustHeight, onInput } = renderUseGlobalCallbacks(editable);

      window.insertTextIntoChatInput?.('> quoted\n\n');

      expect(getTextContent()).toBe('> quoted\n\n');
      expect(setHasContent).toHaveBeenCalledWith(true);
      expect(adjustHeight).toHaveBeenCalled();
      expect(onInput).toHaveBeenCalledWith('> quoted\n\n');
      expect(document.activeElement).toBe(editable);
      expect(caretIsAtEnd(editable)).toBe(true);
    });

    it('adds a newline separator when existing content does not end with a newline', () => {
      const editable = createEditable();
      editable.appendChild(document.createTextNode('draft question'));
      const { getTextContent } = renderUseGlobalCallbacks(editable);

      window.insertTextIntoChatInput?.('> quoted\n\n');

      expect(getTextContent()).toBe('draft question\n> quoted\n\n');
      expect(caretIsAtEnd(editable)).toBe(true);
    });

    it('does not add a separator when existing content ends with a newline', () => {
      const editable = createEditable();
      editable.appendChild(document.createTextNode('draft question'));
      editable.appendChild(document.createElement('br'));
      const { getTextContent } = renderUseGlobalCallbacks(editable);

      window.insertTextIntoChatInput?.('> quoted\n\n');

      expect(getTextContent()).toBe('draft question\n> quoted\n\n');
    });

    it('appends at the end even when the caret is inside the input', () => {
      const editable = createEditable();
      editable.appendChild(document.createTextNode('abcdef'));
      const { getTextContent } = renderUseGlobalCallbacks(editable);
      placeCaretInsideFirstTextNode(editable, 3);
      editable.dispatchEvent(new Event('pointerup'));

      window.insertTextIntoChatInput?.('> q\n\n');

      expect(getTextContent()).toBe('abcdef\n> q\n\n');
    });

    it('does not parse file references and keeps existing file tags', () => {
      const editable = createEditable();
      const tag = document.createElement('span');
      tag.className = 'file-tag';
      tag.setAttribute('data-file-path', '/abs/existing.ts');
      editable.appendChild(tag);
      editable.appendChild(document.createTextNode(' note'));
      const { pathMappingRef, renderFileTags } = renderUseGlobalCallbacks(editable);

      window.insertTextIntoChatInput?.('> see @/abs/other.ts\n\n');
      vi.runAllTimers();

      expect(editable.contains(tag)).toBe(true);
      expect(editable.firstChild).toBe(tag);
      expect(pathMappingRef.current.size).toBe(0);
      expect(renderFileTags).not.toHaveBeenCalled();
    });

    it('ignores empty text', () => {
      const editable = createEditable();
      const { onInput } = renderUseGlobalCallbacks(editable);

      window.insertTextIntoChatInput?.('');

      expect(editable.childNodes.length).toBe(0);
      expect(onInput).not.toHaveBeenCalled();
    });
  });
  describe('insertQuoteIntoChatInput', () => {
    function caretIsAtEnd(editable: HTMLDivElement): boolean {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      const endRange = document.createRange();
      endRange.selectNodeContents(editable);
      endRange.collapse(false);
      return range.collapsed && range.compareBoundaryPoints(Range.START_TO_START, endRange) === 0;
    }

    function renderWithChipText(editable: HTMLDivElement) {
      return renderUseGlobalCallbacks(editable, () => extractEditableText(editable));
    }

    it('inserts a quote chip that holds the raw text and updates state', () => {
      const editable = createEditable();
      const { getTextContent, setHasContent, adjustHeight, onInput } = renderWithChipText(editable);

      window.insertQuoteIntoChatInput?.('line one\n\nline two');

      const chip = editable.querySelector('.quote-tag') as HTMLElement;
      expect(chip).not.toBeNull();
      expect(chip.getAttribute('contenteditable')).toBe('false');
      expect(chip.classList.contains('has-tooltip')).toBe(true);
      expect(chip.getAttribute('data-quote')).toBe('line one\n\nline two');
      expect(chip.getAttribute('data-tooltip')).toBe('line one\n\nline two');
      expect(chip.querySelector('.quote-tag-text')?.textContent).toBe('\u201Cline one\u201D');
      expect(chip.querySelector('.quote-tag-close')).not.toBeNull();

      expect(getTextContent()).toBe('> line one\n>\n> line two\n\n');
      expect(setHasContent).toHaveBeenCalledWith(true);
      expect(adjustHeight).toHaveBeenCalled();
      expect(onInput).toHaveBeenCalledWith('> line one\n>\n> line two\n\n');
      expect(document.activeElement).toBe(editable);
      expect(caretIsAtEnd(editable)).toBe(true);
    });

    it('appends typed text after the blank line that follows the quote', () => {
      const editable = createEditable();
      const { getTextContent } = renderWithChipText(editable);

      window.insertQuoteIntoChatInput?.('line one\n\nline two');
      editable.appendChild(document.createTextNode('my question'));

      expect(getTextContent()).toBe('> line one\n>\n> line two\n\nmy question');
    });

    it('puts the chip on its own line after existing text', () => {
      const editable = createEditable();
      editable.appendChild(document.createTextNode('draft question'));
      const { getTextContent } = renderWithChipText(editable);

      window.insertQuoteIntoChatInput?.('quoted');

      expect(getTextContent()).toBe('draft question\n> quoted\n\n');
      expect(editable.childNodes[1].nodeName).toBe('BR');
      expect((editable.childNodes[2] as HTMLElement).classList.contains('quote-tag')).toBe(true);
    });

    it('escapes the quoted text and cuts a long preview', () => {
      const editable = createEditable();
      renderWithChipText(editable);
      const raw = '<b>"tag"</b> & a very long first line that goes on and on and on';

      window.insertQuoteIntoChatInput?.(raw);

      const chip = editable.querySelector('.quote-tag') as HTMLElement;
      expect(chip.querySelector('b')).toBeNull();
      expect(chip.getAttribute('data-quote')).toBe(raw);
      const preview = chip.querySelector('.quote-tag-text')?.textContent ?? '';
      expect(preview.startsWith('\u201C<b>"tag"</b>')).toBe(true);
      expect(preview.endsWith('\u2026\u201D')).toBe(true);
    });

    it('ignores whitespace-only text', () => {
      const editable = createEditable();
      const { onInput } = renderWithChipText(editable);

      window.insertQuoteIntoChatInput?.('  \n ');

      expect(editable.childNodes.length).toBe(0);
      expect(onInput).not.toHaveBeenCalled();
    });

    it('removes the chip and its line breaks when the close button is clicked', () => {
      const editable = createEditable();
      const { getTextContent } = renderWithChipText(editable);
      renderHook(() =>
        useFileTags({
          editableRef: { current: editable },
          getTextContent,
          onCloseCompletions: vi.fn(),
        })
      );
      const onInputEvent = vi.fn();
      editable.addEventListener('input', onInputEvent);

      window.insertQuoteIntoChatInput?.('quoted');
      editable.appendChild(document.createTextNode('my question'));
      (editable.querySelector('.quote-tag-close') as HTMLElement).click();

      expect(editable.querySelector('.quote-tag')).toBeNull();
      expect(getTextContent()).toBe('my question');
      expect(onInputEvent).toHaveBeenCalled();
    });
  });
});
