import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useKeyboardHandler } from './useKeyboardHandler.js';
import type { UseKeyboardHandlerOptions } from './useKeyboardHandler.js';
import { extractEditableText } from './useTextContent.js';
import {
  getVirtualCursorPosition,
  setVirtualCursorPosition,
} from '../utils/virtualCursorUtils.js';
import { CODE_FENCE_CLASS, decorateCodeFences } from '../utils/codeFenceDecoration.js';

function reactKeyEvent({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  isComposing = false,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}) {
  const e = {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    nativeEvent: { isComposing, key },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as React.KeyboardEvent<HTMLDivElement>;
}

describe('useKeyboardHandler', () => {
  it('sends on Enter (enter mode) when allowed', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        sdkStatusLoading: false,
        sdkInstalled: true,
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(submittedOnEnterRef.current).toBe(true);
  });

  it('does not send when completion handles Enter', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: false };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        sdkStatusLoading: false,
        sdkInstalled: true,
        fileCompletion: { isOpen: true, handleKeyDown: vi.fn(() => true) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(completionSelectedRef.current).toBe(true);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('resets submit refs on key up', () => {
    const handleSubmit = vi.fn();
    const submittedOnEnterRef = { current: true };
    const completionSelectedRef = { current: false };

    const { result } = renderHook(() =>
      useKeyboardHandler({
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        sdkStatusLoading: false,
        sdkInstalled: true,
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef,
        submittedOnEnterRef,
        handleSubmit,
      })
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyUp(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(submittedOnEnterRef.current).toBe(false);
  });

  describe('Enter inside a code fence', () => {
    function setup(text: string, caretOffset: number, sendShortcut: 'enter' | 'cmdEnter' = 'enter') {
      const editable = document.createElement('div');
      editable.appendChild(document.createTextNode(text));
      document.body.appendChild(editable);
      setVirtualCursorPosition(editable, caretOffset);
      const handleSubmit = vi.fn();
      const options: UseKeyboardHandlerOptions = {
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut,
        sdkStatusLoading: false,
        sdkInstalled: true,
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown: vi.fn(() => false),
        completionSelectedRef: { current: false },
        submittedOnEnterRef: { current: false },
        handleSubmit,
        editableRef: { current: editable },
      };
      const { result } = renderHook(() => useKeyboardHandler(options));
      return { editable, handleSubmit, result };
    }

    afterEach(() => {
      document.body.innerHTML = '';
      window.getSelection()?.removeAllRanges();
    });

    it('inserts a newline in an open fence instead of sending', () => {
      const text = 'look:\n```ts\nconst a = 1;';
      const { editable, handleSubmit, result } = setup(text, text.length);

      const e = reactKeyEvent({ key: 'Enter' });
      result.current.onKeyDown(e);

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
      expect(extractEditableText(editable)).toBe(`${text}\n`);
    });

    it('inserts a newline on a line inside a closed fence', () => {
      const text = '```\nline\n```';
      const { handleSubmit, result } = setup(text, '```\nline'.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));

      expect(handleSubmit).not.toHaveBeenCalled();
    });

    it('sends on Enter after the closing fence line', () => {
      const text = '```\nline\n```';
      const { handleSubmit, result } = setup(text, text.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));

      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    it('sends on Cmd+Enter and Ctrl+Enter inside a fence', () => {
      const text = '```\nline';
      const { editable, handleSubmit, result } = setup(text, text.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'Enter', metaKey: true }));
      result.current.onKeyDown(reactKeyEvent({ key: 'Enter', ctrlKey: true }));

      expect(handleSubmit).toHaveBeenCalledTimes(2);
      expect(extractEditableText(editable)).toBe(text);
    });

    it('leaves Shift+Enter to the browser inside a fence', () => {
      const text = '```\nline';
      const { editable, handleSubmit, result } = setup(text, text.length);

      const e = reactKeyEvent({ key: 'Enter', shiftKey: true });
      result.current.onKeyDown(e);

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(extractEditableText(editable)).toBe(text);
    });
  });
  describe('keys at the edges of a code fence block', () => {
    function setupFence(text: string, caretOffset: number) {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      editable.appendChild(document.createTextNode(text));
      document.body.appendChild(editable);
      decorateCodeFences(editable, { allowNewLine: false });
      setVirtualCursorPosition(editable, caretOffset);
      const onInput = vi.fn();
      editable.addEventListener('input', onInput);
      const handleSubmit = vi.fn();
      const handleHistoryKeyDown = vi.fn(() => false);
      const options: UseKeyboardHandlerOptions = {
        isComposingRef: { current: false },
        lastCompositionEndTimeRef: { current: Date.now() - 1000 },
        sendShortcut: 'enter',
        sdkStatusLoading: false,
        sdkInstalled: true,
        fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
        handleMacCursorMovement: vi.fn(() => false),
        handleHistoryKeyDown,
        completionSelectedRef: { current: false },
        submittedOnEnterRef: { current: false },
        handleSubmit,
        editableRef: { current: editable },
      };
      const { result } = renderHook(() => useKeyboardHandler(options));
      return { editable, onInput, handleSubmit, handleHistoryKeyDown, result };
    }

    function caretInBlock(): boolean {
      const node = window.getSelection()?.anchorNode ?? null;
      const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
      return !!el?.closest(`.${CODE_FENCE_CLASS}`);
    }

    afterEach(() => {
      document.body.innerHTML = '';
      window.getSelection()?.removeAllRanges();
    });

    it('ArrowDown on the last line of a closed fence moves the caret after the block', () => {
      const text = '```\ncode\n```\nafter';
      const { editable, result } = setupFence(text, '```\ncode'.length);

      const e = reactKeyEvent({ key: 'ArrowDown' });
      result.current.onKeyDown(e);

      expect(e.preventDefault).toHaveBeenCalled();
      expect(caretInBlock()).toBe(false);
      expect(getVirtualCursorPosition(editable)).toBe('```\ncode\n```\n'.length);
      expect(extractEditableText(editable)).toBe(text);
    });

    it('ArrowDown on the last line of an unclosed fence adds the closing ``` and a new line', () => {
      const text = '```ts\nconst a = 1;';
      const { editable, onInput, result } = setupFence(text, text.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'ArrowDown' }));

      expect(extractEditableText(editable)).toBe(`${text}\n\`\`\`\n`);
      expect(caretInBlock()).toBe(false);
      expect(onInput).toHaveBeenCalledTimes(1);
    });

    it('ArrowUp on the first line moves the caret before the block', () => {
      const text = 'intro\n```\ncode\n```';
      const { editable, result } = setupFence(text, 'intro\n```\nco'.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'ArrowUp' }));

      expect(caretInBlock()).toBe(false);
      expect(getVirtualCursorPosition(editable)).toBe('intro'.length);
    });

    it('Backspace on the empty only line of a fence removes the fence', () => {
      const text = 'a\n```\n\n```\nb';
      const { editable, onInput, result } = setupFence(text, 'a\n```\n'.length);

      result.current.onKeyDown(reactKeyEvent({ key: 'Backspace' }));

      expect(editable.querySelector(`.${CODE_FENCE_CLASS}`)).toBeNull();
      expect(extractEditableText(editable)).toBe('a\n\nb');
      expect(onInput).toHaveBeenCalledTimes(1);
    });

    it('lets the input history take ArrowUp first', () => {
      const text = '```\ncode\n```';
      const { editable, handleHistoryKeyDown, result } = setupFence(text, '```\nco'.length);
      handleHistoryKeyDown.mockReturnValue(true);

      result.current.onKeyDown(reactKeyEvent({ key: 'ArrowUp' }));

      expect(extractEditableText(editable)).toBe(text);
      expect(caretInBlock()).toBe(true);
    });
  });
});
