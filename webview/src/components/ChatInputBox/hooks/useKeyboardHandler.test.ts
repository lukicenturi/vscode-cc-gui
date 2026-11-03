import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useKeyboardHandler } from './useKeyboardHandler.js';
import type { UseKeyboardHandlerOptions } from './useKeyboardHandler.js';
import { extractEditableText } from './useTextContent.js';
import { setVirtualCursorPosition } from '../utils/virtualCursorUtils.js';

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
});
