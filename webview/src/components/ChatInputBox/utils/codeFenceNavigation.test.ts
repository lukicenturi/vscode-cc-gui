import {
  CODE_FENCE_CLASS,
  CODE_FENCE_LANG_CLASS,
  CODE_FENCE_MARKER_CLASS,
  decorateCodeFences,
} from './codeFenceDecoration.js';
import {
  computeCodeFenceKeyAction,
  handleCodeFenceNavigationKey,
} from './codeFenceNavigation.js';
import { extractEditableText } from '../hooks/useTextContent.js';
import {
  getVirtualCursorPosition,
  setVirtualCursorPosition,
} from './virtualCursorUtils.js';

/** Make a decorated input. Each <br> in `trailingBreaks` adds an empty last line. */
function setup(text: string, caretOffset: number, trailingBreaks = 0) {
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  editable.appendChild(document.createTextNode(text));
  for (let i = 0; i < trailingBreaks; i++) {
    editable.appendChild(document.createElement('br'));
  }
  document.body.appendChild(editable);
  decorateCodeFences(editable, { allowNewLine: false });
  setVirtualCursorPosition(editable, caretOffset);
  const onInput = vi.fn();
  editable.addEventListener('input', onInput);
  return { editable, onInput };
}

function press(
  editable: HTMLElement,
  key: string,
  mods: { shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}
) {
  const event = { key, ...mods, preventDefault: vi.fn() };
  const handled = handleCodeFenceNavigationKey(event, editable);
  return { handled, event };
}

function caretElement(): Element | null {
  const node = window.getSelection()?.anchorNode ?? null;
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function expectCaretNotInMarker() {
  expect(caretElement()).not.toBeNull();
  expect(caretElement()?.closest(`.${CODE_FENCE_MARKER_CLASS}`) ?? null).toBeNull();
}

function expectCaretOutsideBlock() {
  expect(caretElement()?.closest(`.${CODE_FENCE_CLASS}`) ?? null).toBeNull();
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('ArrowDown / ArrowRight on the last content line', () => {
  it('moves the caret to the start of the line after a closed fence', () => {
    const text = '```ts\nconst a = 1;\nreturn a;\n```\nafter';
    const { editable, onInput } = setup(text, '```ts\nconst a = 1;\nret'.length);

    const { handled, event } = press(editable, 'ArrowDown');

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(getVirtualCursorPosition(editable)).toBe('```ts\nconst a = 1;\nreturn a;\n```\n'.length);
    expectCaretOutsideBlock();
    expect(extractEditableText(editable)).toBe(text);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('adds an empty line after a closed fence when no line follows', () => {
    const text = 'see:\n```ts\nx\n```';
    const { editable, onInput } = setup(text, 'see:\n```ts\nx'.length);

    expect(press(editable, 'ArrowDown').handled).toBe(true);

    expect(extractEditableText(editable)).toBe(`${text}\n`);
    expect(getVirtualCursorPosition(editable)).toBe(text.length + 1);
    expectCaretOutsideBlock();
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('closes an unclosed fence and moves the caret to a new line', () => {
    const text = 'look:\n```py\nprint(1)';
    const { editable, onInput } = setup(text, text.length);

    expect(press(editable, 'ArrowDown').handled).toBe(true);

    expect(extractEditableText(editable)).toBe(`${text}\n\`\`\`\n`);
    expect(getVirtualCursorPosition(editable)).toBe(`${text}\n\`\`\`\n`.length);
    expectCaretOutsideBlock();
    expectCaretNotInMarker();
    const block = editable.querySelector(`.${CODE_FENCE_CLASS}`)!;
    expect(block.getAttribute('data-fence-closed')).toBe('true');
    expect(block.querySelectorAll(`.${CODE_FENCE_MARKER_CLASS}`)).toHaveLength(2);
    expect(block.querySelector(`.${CODE_FENCE_LANG_CLASS}`)?.getAttribute('data-lang')).toBe('py');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('closes an unclosed fence with the same number of backticks', () => {
    const text = '````\nx';
    const { editable } = setup(text, text.length);

    press(editable, 'ArrowDown');

    expect(extractEditableText(editable)).toBe('````\nx\n````\n');
  });

  it('does not handle ArrowDown on a line that is not the last one', () => {
    const text = '```\na\nb\n```';
    const { editable } = setup(text, '```\na'.length);

    const { handled, event } = press(editable, 'ArrowDown');

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ArrowRight at the end of the last line leaves the block', () => {
    const text = '```\nab\n```\nnext';
    const { editable } = setup(text, '```\nab'.length);

    expect(press(editable, 'ArrowRight').handled).toBe(true);

    expect(getVirtualCursorPosition(editable)).toBe('```\nab\n```\n'.length);
    expectCaretOutsideBlock();
  });

  it('ArrowRight in the middle of the last line gets the browser default', () => {
    const text = '```\nab\n```\nnext';
    const { editable } = setup(text, '```\na'.length);
    expect(press(editable, 'ArrowRight').handled).toBe(false);
  });

  it('does not handle the key with Shift (selection)', () => {
    const text = '```\nab\n```\nnext';
    const { editable } = setup(text, '```\nab'.length);
    expect(press(editable, 'ArrowDown', { shiftKey: true }).handled).toBe(false);
  });
});

describe('ArrowUp / ArrowLeft on the first content line', () => {
  it('moves the caret to the end of the line before the fence', () => {
    const text = 'intro\n```ts\nconst a;\nb\n```';
    const { editable, onInput } = setup(text, 'intro\n```ts\ncon'.length);

    expect(press(editable, 'ArrowUp').handled).toBe(true);

    expect(getVirtualCursorPosition(editable)).toBe('intro'.length);
    expectCaretOutsideBlock();
    expect(extractEditableText(editable)).toBe(text);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('adds an empty line before a fence at the start of the input', () => {
    const text = '```\nx\n```';
    const { editable, onInput } = setup(text, '```\nx'.length);

    expect(press(editable, 'ArrowUp').handled).toBe(true);

    expect(extractEditableText(editable)).toBe(`\n${text}`);
    expect(getVirtualCursorPosition(editable)).toBe(0);
    expectCaretOutsideBlock();
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('does not handle ArrowUp on a line that is not the first one', () => {
    const text = '```\na\nb\n```';
    const { editable } = setup(text, '```\na\nb'.length);
    expect(press(editable, 'ArrowUp').handled).toBe(false);
  });

  it('ArrowLeft at the start of the first line leaves the block', () => {
    const text = 'intro\n```\nab\n```';
    const { editable } = setup(text, 'intro\n```\n'.length);

    expect(press(editable, 'ArrowLeft').handled).toBe(true);

    expect(getVirtualCursorPosition(editable)).toBe('intro'.length);
    expectCaretOutsideBlock();
  });

  it('ArrowLeft in the middle of the first line gets the browser default', () => {
    const text = 'intro\n```\nab\n```';
    const { editable } = setup(text, 'intro\n```\na'.length);
    expect(press(editable, 'ArrowLeft').handled).toBe(false);
  });
});

describe('Backspace and Delete at the edges of a block', () => {
  it('removes a closed fence that has only an empty line', () => {
    const text = 'a\n```\n\n```\nb';
    const { editable, onInput } = setup(text, 'a\n```\n'.length);

    expect(press(editable, 'Backspace').handled).toBe(true);

    expect(editable.querySelector(`.${CODE_FENCE_CLASS}`)).toBeNull();
    expect(extractEditableText(editable)).toBe('a\n\nb');
    expect(getVirtualCursorPosition(editable)).toBe('a\n'.length);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('removes an unclosed fence that has only an empty line', () => {
    // 'x\n```' + <br> gives 'x\n```\n': the fence has 1 empty line
    const { editable, onInput } = setup('x\n```', 'x\n```\n'.length, 1);
    expect(extractEditableText(editable)).toBe('x\n```\n');
    expect(editable.querySelector(`.${CODE_FENCE_CLASS}`)).not.toBeNull();

    expect(press(editable, 'Backspace').handled).toBe(true);

    expect(editable.querySelector(`.${CODE_FENCE_CLASS}`)).toBeNull();
    expect(extractEditableText(editable)).toBe('x\n');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('does not join the first line to the hidden ``` line', () => {
    const text = '```ts\ncode\n```';
    const { editable, onInput } = setup(text, '```ts\n'.length);

    const { handled, event } = press(editable, 'Backspace');

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(extractEditableText(editable)).toBe(text);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('removes an empty first line when more lines follow', () => {
    const text = '```\n\ncode\n```';
    const { editable } = setup(text, '```\n'.length);

    expect(press(editable, 'Backspace').handled).toBe(true);

    expect(extractEditableText(editable)).toBe('```\ncode\n```');
    expect(getVirtualCursorPosition(editable)).toBe('```\n'.length);
    expectCaretNotInMarker();
  });

  it('Backspace in the middle of a line gets the browser default', () => {
    const text = '```\ncode\n```';
    const { editable } = setup(text, '```\nco'.length);
    expect(press(editable, 'Backspace').handled).toBe(false);
  });

  it('Delete at the end of the last line of a closed fence does nothing', () => {
    const text = '```\ncode\n```\nafter';
    const { editable } = setup(text, '```\ncode'.length);

    expect(press(editable, 'Delete').handled).toBe(true);
    expect(extractEditableText(editable)).toBe(text);
  });

  it('Backspace on an empty line after a block removes the line', () => {
    const text = '```\ncode\n```\n\nafter';
    const { editable, onInput } = setup(text, '```\ncode\n```\n'.length);

    expect(press(editable, 'Backspace').handled).toBe(true);

    expect(extractEditableText(editable)).toBe('```\ncode\n```\nafter');
    expect(getVirtualCursorPosition(editable)).toBe('```\ncode'.length);
    expectCaretNotInMarker();
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('Backspace at the start of a line after a block moves into the block', () => {
    const text = '```\ncode\n```\nafter';
    const { editable } = setup(text, '```\ncode\n```\n'.length);

    expect(press(editable, 'Backspace').handled).toBe(true);

    expect(extractEditableText(editable)).toBe(text);
    expect(getVirtualCursorPosition(editable)).toBe('```\ncode'.length);
    expectCaretNotInMarker();
  });

  it('Delete on an empty line before a block removes the line', () => {
    const text = 'a\n\n```\ncode\n```';
    const { editable } = setup(text, 'a\n'.length);

    expect(press(editable, 'Delete').handled).toBe(true);

    expect(extractEditableText(editable)).toBe('a\n```\ncode\n```');
    expect(getVirtualCursorPosition(editable)).toBe('a\n```\n'.length);
    expectCaretNotInMarker();
  });
});

describe('computeCodeFenceKeyAction', () => {
  it('gives null when the block shows its markers (no content line)', () => {
    const text = '```ts';
    const { editable } = setup(text, text.length);
    expect(computeCodeFenceKeyAction(editable, 'ArrowDown')).toBeNull();
    expect(computeCodeFenceKeyAction(editable, 'Backspace')).toBeNull();
  });

  it('gives null for keys that it does not handle', () => {
    const text = '```\nx\n```';
    const { editable } = setup(text, '```\nx'.length);
    expect(computeCodeFenceKeyAction(editable, 'Enter')).toBeNull();
    expect(computeCodeFenceKeyAction(editable, 'a')).toBeNull();
  });

  it('gives the exit actions on the edge lines', () => {
    const text = '```\nx\n```';
    const { editable } = setup(text, '```\nx'.length);
    expect(computeCodeFenceKeyAction(editable, 'ArrowDown')?.type).toBe('exit-after');
    expect(computeCodeFenceKeyAction(editable, 'ArrowUp')?.type).toBe('exit-before');
  });
});

describe('the caret is never in a hidden marker line', () => {
  it('after each move', () => {
    const text = 'a\n```ts\nb\nc\n```\nd';
    const { editable } = setup(text, 'a\n```ts\nb'.length);
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'Backspace'];
    for (const key of keys) {
      press(editable, key);
      expectCaretNotInMarker();
    }
  });

  it('when the key comes before the debounced decoration', () => {
    // The user typed the closing ``` and pressed a key before the decoration ran
    const editable = document.createElement('div');
    editable.appendChild(document.createTextNode('```\nx\n```'));
    document.body.appendChild(editable);
    setVirtualCursorPosition(editable, '```\nx\n```'.length);

    const { handled } = press(editable, 'ArrowLeft');

    // The move out of the hidden ``` line is the key action
    expect(handled).toBe(true);
    expectCaretNotInMarker();
    expect(extractEditableText(editable)).toBe('```\nx\n```');
    expect(getVirtualCursorPosition(editable)).toBe('```\nx'.length);
  });

  it('Backspace right after the user typed ``` uses the DOM as it is', () => {
    const editable = document.createElement('div');
    editable.appendChild(document.createTextNode('```\nx\n```'));
    document.body.appendChild(editable);
    setVirtualCursorPosition(editable, '```\nx\n```'.length);

    expect(press(editable, 'Backspace').handled).toBe(false);
    expect(editable.querySelector(`.${CODE_FENCE_CLASS}`)).toBeNull();
  });
});
