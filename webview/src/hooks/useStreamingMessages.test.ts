import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clampStreamingBlockBoundaries, useStreamingMessages } from './useStreamingMessages';
import type { ClaudeMessage } from '../types';
import { getContentBlocks, normalizeBlocks } from '../utils/messageUtils';

const localizeMessage = (text: string) => text;
const t = ((key: string) => key) as any;

const getRenderedBlocks = (message: ClaudeMessage) =>
  getContentBlocks(
    message,
    (raw) => normalizeBlocks(raw, localizeMessage, t),
    localizeMessage,
  );

describe('useStreamingMessages', () => {
  it('sets .content from streamingContentRef and syncs a single raw text block', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Hello world';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: false,
      raw: {
        message: {
          content: [{ type: 'text', text: 'Backend text' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    expect(patched.content).toBe('Hello world');
    expect(patched.isStreaming).toBe(true);
    // raw text block should stay aligned with what the UI renders during streaming
    const rawContent = (patched.raw as any).message.content;
    expect(rawContent).toHaveLength(1);
    expect(rawContent[0]).toMatchObject({ type: 'text', text: 'Hello world' });
  });

  it('preserves tool_use blocks in raw unchanged', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Running command.';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'Running command.',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'text', text: 'Running command.' },
            { type: 'tool_use', id: 'bash-1', name: 'run_command', input: { command: 'ls' } },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    expect(patched.content).toBe('Running command.');
    const rawContent = (patched.raw as any).message.content;
    expect(rawContent).toHaveLength(2);
    expect(rawContent[1]).toMatchObject({ type: 'tool_use', id: 'bash-1' });
  });

  it('preserves thinking blocks in raw unchanged', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Done.';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'Done.',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me think about this.' },
            { type: 'text', text: 'Done.' },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    const rawContent = (patched.raw as any).message.content;
    expect(rawContent).toHaveLength(2);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'Let me think about this.' });
  });

  it('uses backend content when it is longer than delta content (never goes backwards)', () => {
    const { result } = renderHook(() => useStreamingMessages());

    // Delta throttler hasn't flushed yet — streamingContentRef is behind
    result.current.streamingContentRef.current = 'ABC';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'ABCDE',  // backend snapshot is ahead
      isStreaming: true,
      raw: { message: { content: [{ type: 'text', text: 'ABCDE' }] } },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    // Should keep the longer backend content, not jump back to 'ABC'
    expect(patched.content).toBe('ABCDE');
    expect(patched.isStreaming).toBe(true);
  });

  it('uses delta content when it is longer than backend content', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'ABCDEF';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'ABC',
      isStreaming: true,
      raw: { message: { content: [{ type: 'text', text: 'ABC' }] } },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    expect(patched.content).toBe('ABCDEF');
  });

  it('handles missing raw gracefully', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Response';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
    };

    const patched = result.current.patchAssistantForStreaming(assistant);

    expect(patched.content).toBe('Response');
    expect(patched.isStreaming).toBe(true);
    expect(patched.raw).toBeUndefined();
  });

  it('extractRawBlocks correctly extracts blocks from raw', () => {
    const { result } = renderHook(() => useStreamingMessages());

    const blocks = result.current.extractRawBlocks({
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'thinking', thinking: 'Thinking...' },
        ],
      },
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'Hello' });
    expect(blocks[1]).toMatchObject({ type: 'thinking', thinking: 'Thinking...' });
  });

  it('extractRawBlocks returns empty array for null/undefined raw', () => {
    const { result } = renderHook(() => useStreamingMessages());

    expect(result.current.extractRawBlocks(null)).toEqual([]);
    expect(result.current.extractRawBlocks(undefined)).toEqual([]);
    expect(result.current.extractRawBlocks({})).toEqual([]);
  });

  it('keeps rendered text blocks in sync with streaming content when backend raw text is stale', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'ABCDE';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'ABC',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'text', text: 'ABC' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const renderedBlocks = getRenderedBlocks(patched);

    expect(renderedBlocks).toHaveLength(1);
    expect(renderedBlocks[0]).toMatchObject({ type: 'text', text: 'ABCDE' });
  });

  it('creates a visible thinking block before the first backend snapshot arrives', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'Thinking before snapshot';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const renderedBlocks = getRenderedBlocks(patched);

    expect(renderedBlocks).toHaveLength(1);
    expect(renderedBlocks[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Thinking before snapshot',
      text: 'Thinking before snapshot',
    });
  });

  it('does not duplicate earlier thinking content when a second thinking block follows a tool_use', () => {
    // Extended thinking turn:
    //   thinking_seg1 → tool_use → thinking_seg2
    // streamingThinkingRef accumulates the whole turn ("Let me think...Now I need...").
    // Backend raw blocks already split it into [thinking_1, tool_use, thinking_2].
    // The sync function must only assign the suffix ("Now I need...") to the
    // second block, not the cumulative buffer.
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'Let me think...Now I need...';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me think...', text: 'Let me think...' },
            { type: 'tool_use', id: 'search-1', name: 'search', input: { q: 'foo' } },
            { type: 'thinking', thinking: 'Now I need...', text: 'Now I need...' },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(3);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'Let me think...' });
    expect(rawContent[1]).toMatchObject({ type: 'tool_use', id: 'search-1' });
    // The critical assertion: second thinking block must NOT contain "Let me think..."
    expect(rawContent[2]).toMatchObject({ type: 'thinking', thinking: 'Now I need...' });
  });

  it('appends streamed text after trailing tool_use blocks instead of moving the tool card to the bottom', () => {
    const { result } = renderHook(() => useStreamingMessages());

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'Before tool.',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'text', text: 'Before tool.' },
            { type: 'tool_use', id: 'bash-1', name: 'shell_command', input: { command: 'git status' } },
          ],
        },
      },
    };

    result.current.streamingContentRef.current = 'Before tool.';
    const toolAppeared = result.current.patchAssistantForStreaming(assistant);
    expect(((toolAppeared.raw as any).message.content as ContentBlockTest[]).map((block) => block.type))
      .toEqual(['text', 'tool_use']);

    result.current.streamingContentRef.current = 'Before tool.After tool.';
    const patched = result.current.patchAssistantForStreaming(toolAppeared);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
    expect(rawContent[0]).toMatchObject({ type: 'text', text: 'Before tool.' });
    expect(rawContent[1]).toMatchObject({ type: 'tool_use', id: 'bash-1' });
    expect(rawContent[2]).toMatchObject({ type: 'text', text: 'After tool.' });

    result.current.streamingContentRef.current = 'Before tool.After tool.More output.';
    const patchedAgain = result.current.patchAssistantForStreaming(patched);
    const updatedRawContent = (patchedAgain.raw as any).message.content as ContentBlockTest[];

    expect(updatedRawContent.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
    expect(updatedRawContent[2]).toMatchObject({ type: 'text', text: 'After tool.More output.' });

    const staleBackendSnapshot: ClaudeMessage = {
      ...patchedAgain,
      content: 'Before tool.',
      raw: assistant.raw,
    };

    const recoveredFromStaleSnapshot = result.current.patchAssistantForStreaming(staleBackendSnapshot);
    const recoveredRawContent = (recoveredFromStaleSnapshot.raw as any).message.content as ContentBlockTest[];

    expect(recoveredRawContent.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
    expect(recoveredRawContent[2]).toMatchObject({ type: 'text', text: 'After tool.More output.' });
  });

  it('splits already-buffered text when the first tool snapshot arrives late', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Before tool.After tool.';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'Before tool.',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'text', text: 'Before tool.' },
            { type: 'tool_use', id: 'bash-late', name: 'shell_command', input: { command: 'git status' } },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent.map((block) => block.type)).toEqual(['text', 'tool_use', 'text']);
    expect(rawContent[0]).toMatchObject({ type: 'text', text: 'Before tool.' });
    expect(rawContent[1]).toMatchObject({ type: 'tool_use', id: 'bash-late' });
    expect(rawContent[2]).toMatchObject({ type: 'text', text: 'After tool.' });
  });

  it('extends the last thinking block as new deltas arrive (single segment)', () => {
    const { result } = renderHook(() => useStreamingMessages());

    // Backend snapshot is one frame behind the delta channel
    result.current.streamingThinkingRef.current = 'Thinking longer now';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'Thinking', text: 'Thinking' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(1);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'Thinking longer now' });
  });

  it('keeps backend raw structure intact when the cumulative thinking buffer cannot be reconciled', () => {
    const { result } = renderHook(() => useStreamingMessages());

    // streamingThinkingRef does not start with the earlier block's text — could
    // happen if the backend rewrote earlier blocks via dedup.  Sync function
    // should leave structure untouched rather than overwriting incorrectly.
    result.current.streamingThinkingRef.current = 'Completely different content';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'Original first', text: 'Original first' },
            { type: 'tool_use', id: 't1', name: 'noop', input: {} },
            { type: 'thinking', thinking: 'Original second', text: 'Original second' },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent[0]).toMatchObject({ thinking: 'Original first' });
    expect(rawContent[2]).toMatchObject({ thinking: 'Original second' });
  });

  it('splits a consecutive thinking block before the backend snapshot arrives', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First summary';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'First summarySecond summary';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'First summary', text: 'First summary' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(2);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'First summary' });
    expect(rawContent[1]).toMatchObject({ type: 'thinking', thinking: 'Second summary' });
  });

  it('splits a merged backend thinking block at a recorded boundary', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecond';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'FirstSecond', text: 'FirstSecond' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent.map((block) => block.thinking)).toEqual(['First', 'Second']);
  });

  it('extends a short backend thinking block before adding the next block', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecond';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'Fi', text: 'Fi' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent.map((block) => block.thinking)).toEqual(['First', 'Second']);
  });

  it('splits a merged backend text block at a recorded boundary', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingContentRef.current = 'Before';
    result.current.recordStreamingBlockReset();
    result.current.streamingContentRef.current = 'BeforeAfter';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'BeforeAfter',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'text', text: 'BeforeAfter' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent.map((block) => block.text)).toEqual(['Before', 'After']);
  });

  it('fills lagging thinking placeholders before splitting later blocks', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecond';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecondThird';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'First', text: 'First' },
            { type: 'thinking', thinking: '', text: '' },
            { type: 'thinking', thinking: '', text: '' },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(3);
    expect(rawContent.map((block) => block.thinking)).toEqual(['First', 'Second', 'Third']);
  });

  it('materializes the full block sequence when no backend block has arrived yet', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecond';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecondThird';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: { message: { content: [] } },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(3);
    expect(rawContent.map((block) => block.thinking)).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps materializing later blocks when earlier boundaries are already covered by the backend', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'First';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecond';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'FirstSecondThird';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'First', text: 'First' },
            { type: 'thinking', thinking: 'Second', text: 'Second' },
          ],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(3);
    expect(rawContent.map((block) => block.thinking)).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps a single thinking block when the boundary covers the whole buffer', () => {
    const { result } = renderHook(() => useStreamingMessages());

    // Boundary recorded at the current end of the buffer (e.g. a trailing
    // message_start reset with no further thinking deltas) must not produce
    // an empty extra block.
    result.current.streamingThinkingRef.current = 'Only block';
    result.current.recordStreamingBlockReset();

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'Only block', text: 'Only block' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(1);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'Only block' });
  });

  it('resetStreamingState clears recorded streaming block boundaries', () => {
    const { result } = renderHook(() => useStreamingMessages());

    result.current.streamingThinkingRef.current = 'A';
    result.current.recordStreamingBlockReset();
    result.current.streamingThinkingRef.current = 'AB';

    result.current.resetStreamingState();

    // Without the reset, the recorded boundary would split 'AB' into two
    // thinking blocks; after it, the buffer renders as a single block again.
    result.current.streamingThinkingRef.current = 'AB';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: '',
      isStreaming: true,
      raw: {
        message: {
          content: [{ type: 'thinking', thinking: 'AB', text: 'AB' }],
        },
      },
    };

    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(rawContent).toHaveLength(1);
    expect(rawContent[0]).toMatchObject({ type: 'thinking', thinking: 'AB' });
  });
});

describe('clampStreamingBlockBoundaries', () => {
  it('keeps boundaries that are inside both new lengths', () => {
    const boundaries = [
      { contentLength: 2, thinkingLength: 1 },
      { contentLength: 5, thinkingLength: 3 },
    ];
    expect(clampStreamingBlockBoundaries(boundaries, 5, 3)).toEqual(boundaries);
  });

  it('clamps only the offset that is past its new length', () => {
    expect(clampStreamingBlockBoundaries(
      [{ contentLength: 10, thinkingLength: 2 }],
      4,
      6,
    )).toEqual([{ contentLength: 4, thinkingLength: 2 }]);
  });

  it('merges boundaries that become equal after the clamp and keeps the order', () => {
    expect(clampStreamingBlockBoundaries(
      [
        { contentLength: 1, thinkingLength: 0 },
        { contentLength: 4, thinkingLength: 0 },
        { contentLength: 8, thinkingLength: 0 },
        { contentLength: 12, thinkingLength: 0 },
      ],
      3,
      0,
    )).toEqual([
      { contentLength: 1, thinkingLength: 0 },
      { contentLength: 3, thinkingLength: 0 },
    ]);
  });
});

describe('useStreamingMessages rollbackStreamingBuffers', () => {
  const textsOf = (message: ClaudeMessage, kind: 'text' | 'thinking') =>
    ((message.raw as any)?.message?.content as ContentBlockTest[] ?? [])
      .filter((block) => block.type === kind)
      .map((block) => (kind === 'thinking' ? block.thinking : block.text));

  it('truncates both buffers and clamps at 0', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Hello world';
    result.current.streamingThinkingRef.current = 'Hmm';

    result.current.rollbackStreamingBuffers(6, 10);

    expect(result.current.streamingContentRef.current).toBe('Hello');
    expect(result.current.streamingThinkingRef.current).toBe('');
  });

  it('does nothing for a zero or invalid rollback', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Hello';
    result.current.rollbackStreamingBuffers(0, 0);
    result.current.rollbackStreamingBuffers(Number.NaN, -3);
    expect(result.current.streamingContentRef.current).toBe('Hello');

    const assistant: ClaudeMessage = { type: 'assistant', content: 'Hello there', isStreaming: true };
    // No rollback happened, so the longer message content still wins.
    expect(result.current.patchAssistantForStreaming(assistant).content).toBe('Hello there');
  });

  it('keeps a recorded boundary that is still inside the shorter buffer', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Before';
    result.current.recordStreamingBlockReset();
    result.current.streamingContentRef.current = 'BeforeAfterX';

    result.current.rollbackStreamingBuffers(1, 0);

    const patched = result.current.patchAssistantForStreaming({
      type: 'assistant',
      content: 'BeforeAfterX',
      isStreaming: true,
      raw: { message: { content: [{ type: 'text', text: 'BeforeAfterX' }] } },
    });
    expect(patched.content).toBe('BeforeAfter');
    expect(textsOf(patched, 'text')).toEqual(['Before', 'After']);
  });

  it('clamps a boundary that is past the shorter buffer instead of keeping the old offset', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Before';
    result.current.recordStreamingBlockReset();
    result.current.streamingContentRef.current = 'BeforeAfter';

    result.current.rollbackStreamingBuffers(8, 0);
    expect(result.current.streamingContentRef.current).toBe('Bef');

    // The retried answer grows past the old boundary offset (6). The stale
    // offset must not split the new text at 6.
    result.current.streamingContentRef.current = 'BefXYZWVUTS';
    const patched = result.current.patchAssistantForStreaming({
      type: 'assistant',
      content: 'BeforeAfter',
      isStreaming: true,
      raw: { message: { content: [{ type: 'text', text: 'Before' }, { type: 'text', text: 'After' }] } },
    });
    expect(patched.content).toBe('BefXYZWVUTS');
    // The boundary is clamped to the rollback point (3), where the retried
    // message starts its new block.
    expect(textsOf(patched, 'text')).toEqual(['Bef', 'XYZWVUTS']);
  });

  it('replaces longer rendered text and thinking with the shorter buffers', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingThinkingRef.current = 'Think';
    result.current.streamingContentRef.current = 'Answer';

    result.current.rollbackStreamingBuffers(6, 5);

    const patched = result.current.patchAssistantForStreaming({
      type: 'assistant',
      content: 'Answer',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'thinking', thinking: 'Think', text: 'Think' },
            { type: 'text', text: 'Answer' },
          ],
        },
      },
    });

    expect(patched.content).toBe('');
    expect(textsOf(patched, 'thinking')).toEqual([]);
    expect(textsOf(patched, 'text')).toEqual([]);
  });

  it('drops the failed text after a tool_use but keeps the tool block and earlier text', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Pre textPost';

    const assistant: ClaudeMessage = {
      type: 'assistant',
      content: 'Pre textPost',
      isStreaming: true,
      raw: {
        message: {
          content: [
            { type: 'text', text: 'Pre text' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
            { type: 'text', text: 'Post' },
          ],
        },
      },
    };

    result.current.rollbackStreamingBuffers(4, 0);
    const patched = result.current.patchAssistantForStreaming(assistant);
    const rawContent = (patched.raw as any).message.content as ContentBlockTest[];

    expect(patched.content).toBe('Pre text');
    expect(rawContent.map((block) => block.type)).toEqual(['text', 'tool_use']);
    expect(rawContent[0].text).toBe('Pre text');
  });

  it('applies the rollback one time per message, then longer backend content wins again', () => {
    const { result } = renderHook(() => useStreamingMessages());
    result.current.streamingContentRef.current = 'Old partial';
    result.current.rollbackStreamingBuffers(11, 0);
    result.current.streamingContentRef.current = 'New';

    const first = result.current.patchAssistantForStreaming({
      type: 'assistant',
      content: 'Old partial',
      isStreaming: true,
    });
    expect(first.content).toBe('New');

    // A later backend snapshot that is ahead of the deltas is accepted again.
    const second = result.current.patchAssistantForStreaming({ ...first, content: 'New answer' });
    expect(second.content).toBe('New answer');
  });
});

interface ContentBlockTest {
  type: string;
  thinking?: string;
  text?: string;
  id?: string;
}
