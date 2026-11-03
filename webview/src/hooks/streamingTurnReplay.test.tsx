/**
 * Replay of a real Claude streaming turn (host trace "turn 75") through the
 * REAL window callbacks + useStreamingMessages hook.
 *
 * The host (src/bridge.ts) translates the daemon lines of that turn into this
 * webview message sequence:
 *   [STREAM_START]   -> onStreamStart
 *   [MESSAGE] x      -> onMessage (every type: system / assistant / user / result)
 *   [BLOCK_RESET]    -> onBlockReset
 *   [CONTENT_DELTA]  -> onContentDelta
 *   [THINKING_DELTA] -> onThinkingDelta
 *   [USAGE]          -> usage_data (no webview handler; ignored)
 *   [STREAM_END]     -> onTurnMessages (8 buffered assistant/user msgs), onStreamEnd
 * system task_notification messages also go to onTaskEvent.
 *
 * The daemon streams the narration "I will check two things first..." once,
 * and the final answer once. Both must render exactly once.
 */
import { act, render, renderHook, cleanup } from '@testing-library/react';
import { useWindowCallbacks } from './useWindowCallbacks.js';
import type { UseWindowCallbacksOptions } from './useWindowCallbacks.js';
import type { ClaudeMessage, ClaudeContentBlock } from '../types/index.js';
import { useStreamingMessages } from './useStreamingMessages.js';
import {
  getContentBlocks,
  getMessageKeys,
  mergeConsecutiveAssistantMessages,
  normalizeBlocks,
} from '../utils/messageUtils.js';
import { MessageList } from '../components/MessageList';

vi.mock('../utils/forceWebviewRepaint.js', () => ({ forceWebviewRepaint: vi.fn() }));

// Render each message as its visible text so the DOM shows what the user sees.
vi.mock('../components/MessageItem', () => ({
  MessageItem: ({
    message,
    getContentBlocks: blocksOf,
  }: {
    message: ClaudeMessage;
    getContentBlocks: (m: ClaudeMessage) => ClaudeContentBlock[];
  }) => (
    <div data-testid="message-item" data-type={message.type}>
      {blocksOf(message)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text?: string }).text ?? '')
        .join('')}
    </div>
  ),
}));
vi.mock('../components/WaitingIndicator', () => ({ default: () => null }));

const t = ((key: string) => key) as never;
const SESSION = '38de5a89-0873-421f-bc9d-85432b3fdc3a';

const NARRATION_DELTAS = [
  'I',
  ' will check',
  ' two things first: wh',
  "ether VS Code's own web",
  'view link handler also opens the',
  ' link, and where the web',
  'view s',
  'ends open',
  '-',
  'browser events.',
];
const NARRATION = NARRATION_DELTAS.join('');

const THINKING_DELTAS = [
  'Found', ' the bug', 's: V', "S Code's webview script", ' re', '-opens http',
  ' links already', ' handled by our markdown click', ' handler, caus', 'ing double op',
  'ens, and n', 'othing restores focus to', ' the input on', ' window ref',
  'ocus. Passing both f', 'ixes to the implementer.', '\n\n',
];

const FINAL_DELTAS = [
  'Both fixes are install', 'ed, committed as `b2', 'ec693`, and push', 'ed. Reload the VS',
  ' Code window to use', ' them.\n\n**1. External', ' links op', 'ened twice.** VS',
  " Code's own webview script opens", ' every clicked http link by', ' itself, and it ignores',
  ' our handler. The ext', 'ension then opened the same link again', '.', ' The markdown link',
  ' handler,', ' and the links in the C', 'LI and Community settings p',
  'ages, now stop the click before', ' it', " reaches VS Code's", ' script. The',
  ' link opens one time.', ' A test conf', 'irms it', '.\n\n**2. Focus', ' after Cmd+T',
  'ab.** A new hook wat', 'ches the window foc', 'us.', ' When you', ' return',
  ' to VS Code,', ' and the ch', 'at input was the last focused element', ', the h',
  'ook puts the', ' focus back', ' into', ' the input. The caret stays', ' where it was. The',
  ' hook does not take the focus', ' in', ' these', ' cases:\n\n- You', ' focused a',
  ' different text', ' field before', ' you', ' left.\n- You cl', 'icked a message',
  ' to select text before', ' you left.\n- The', ' input', ' is disabled.\n\nTest',
  ' both', ' after', ' the reload. For', ' the link, click this one: [', 'github.com/',
  'luk', 'icentur', 'i/vscode-cc', '-gui](https://github.', 'com/lukicenturi',
  '/vscode-cc-', 'gui). One tab must', ' open.',
];
const FINAL = FINAL_DELTAS.join('');

let uuidCounter = 0;
const nextUuid = () => `uuid-${(uuidCounter += 1)}`;

const systemMessage = (subtype: string, extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype,
  session_id: SESSION,
  uuid: nextUuid(),
  ...extra,
});

const toolUseMessage = (id: string, name: string, input: Record<string, unknown>, msgId: string) => ({
  type: 'assistant',
  message: {
    model: 'claude-fable-5-1',
    id: msgId,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: null,
    usage: { input_tokens: 2, output_tokens: 8 },
  },
  parent_tool_use_id: null,
  session_id: SESSION,
  uuid: nextUuid(),
});

const toolResultMessage = (toolUseId: string, content: string) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ tool_use_id: toolUseId, type: 'tool_result', content, is_error: false }],
  },
  parent_tool_use_id: null,
  session_id: SESSION,
  uuid: nextUuid(),
  timestamp: new Date().toISOString(),
  tool_use_result: { stdout: content, stderr: '', interrupted: false },
});

type RafMode = 'eager' | 'burst';

function createOptions(overrides: Partial<UseWindowCallbacksOptions>): UseWindowCallbacksOptions {
  return {
    t: t as unknown as UseWindowCallbacksOptions['t'],
    addToast: vi.fn(),
    clearToasts: vi.fn(),
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    setLoading: vi.fn(),
    setLoadingStartTime: vi.fn(),
    setIsThinking: vi.fn(),
    setExpandedThinking: vi.fn(),
    setStreamingActive: vi.fn(),
    setHistoryData: vi.fn(),
    setCurrentSessionId: vi.fn(),
    setCustomSessionTitle: vi.fn(),
    setUsagePercentage: vi.fn(),
    setUsageUsedTokens: vi.fn(),
    setUsageMaxTokens: vi.fn(),
    setSubagentHistories: vi.fn(),
    setPermissionMode: vi.fn(),
    setClaudePermissionMode: vi.fn(),
    setCodexPermissionMode: vi.fn(),
    setSelectedClaudeModel: vi.fn(),
    setSelectedCodexModel: vi.fn(),
    setProviderConfigVersion: vi.fn(),
    setActiveProviderConfig: vi.fn(),
    setClaudeSettingsAlwaysThinkingEnabled: vi.fn(),
    setStreamingEnabledSetting: vi.fn(),
    setSendShortcut: vi.fn(),
    setAutoOpenFileEnabled: vi.fn(),
    setPermissionDialogTimeoutSeconds: vi.fn(),
    setStreamStallTimeoutSeconds: vi.fn(),
    setSdkStatus: vi.fn(),
    setSdkStatusLoaded: vi.fn(),
    setIsRewinding: vi.fn(),
    setRewindDialogOpen: vi.fn(),
    setCurrentRewindRequest: vi.fn(),
    setContextInfo: vi.fn(),
    setSelectedAgent: vi.fn(),
    setTaskEvents: vi.fn(),
    currentProviderRef: { current: 'claude' },
    messagesContainerRef: { current: null },
    isUserAtBottomRef: { current: true },
    userPausedRef: { current: false },
    suppressNextStatusToastRef: { current: false },
    syncActiveProviderModelMapping: vi.fn(),
    openPermissionDialog: vi.fn(),
    openAskUserQuestionDialog: vi.fn(),
    openPlanApprovalDialog: vi.fn(),
    forceClosePermissionDialog: vi.fn(),
    forceCloseAskUserQuestionDialog: vi.fn(),
    forceClosePlanApprovalDialog: vi.fn(),
    openContextUsageDialog: vi.fn(),
    updateContextUsageData: vi.fn(),
    closeContextUsageDialog: vi.fn(),
    customSessionTitleRef: { current: null },
    currentSessionIdRef: { current: SESSION },
    updateHistoryTitle: vi.fn(),
    applyHistoryTitleLocal: vi.fn(),
    ...overrides,
  } as unknown as UseWindowCallbacksOptions;
}

/** Wire the real streaming hook into the real callbacks with a manual rAF queue. */
function setupReplay() {
  const rafQueue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  // Step the clock on each read so the 33 ms render throttle never defers.
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));

  const { result: streaming } = renderHook(() => useStreamingMessages());
  const hook = streaming.current;
  // Earlier turns of the same long session (history has uuids). There are more
  // than 15 messages, so MessageList slides its visible window during the turn.
  const history: ClaudeMessage[] = Array.from({ length: 20 }, (_, i) => ({
    type: i % 2 === 0 ? 'user' : 'assistant',
    content: `history message ${i}`,
    timestamp: `2026-11-03T09:00:${String(i).padStart(2, '0')}.000Z`,
    raw: {
      type: i % 2 === 0 ? 'user' : 'assistant',
      uuid: `history-${i}`,
      message: { content: [{ type: 'text', text: `history message ${i}` }] },
    },
  }) as ClaudeMessage);
  const buffer = {
    current: [
      ...history,
      {
        type: 'user',
        content: 'another issues I want you to fix',
        timestamp: '2026-11-03T09:57:52.588Z',
        raw: { type: 'user', uuid: 'prev-user', message: { role: 'user', content: 'another issues I want you to fix' } },
      },
    ] as ClaudeMessage[],
  };
  const snapshots: ClaudeMessage[][] = [];
  const setMessages = vi.fn((value: unknown) => {
    buffer.current = typeof value === 'function'
      ? (value as (prev: ClaudeMessage[]) => ClaudeMessage[])(buffer.current)
      : value as ClaudeMessage[];
    snapshots.push(buffer.current);
  });
  const opts = createOptions({
    setMessages: setMessages as unknown as UseWindowCallbacksOptions['setMessages'],
    streamingContentRef: hook.streamingContentRef,
    streamingThinkingRef: hook.streamingThinkingRef,
    recordStreamingBlockReset: hook.recordStreamingBlockReset,
    clearStreamingBlockResets: hook.clearStreamingBlockResets,
    rollbackStreamingBuffers: hook.rollbackStreamingBuffers,
    resetStreamingContentBuffer: hook.resetStreamingContentBuffer,
    isStreamingRef: hook.isStreamingRef,
    useBackendStreamingRenderRef: hook.useBackendStreamingRenderRef,
    autoExpandedThinkingKeysRef: hook.autoExpandedThinkingKeysRef,
    streamingMessageIndexRef: hook.streamingMessageIndexRef,
    streamingTurnIdRef: hook.streamingTurnIdRef,
    turnIdCounterRef: hook.turnIdCounterRef,
    lastContentUpdateRef: hook.lastContentUpdateRef,
    contentUpdateTimeoutRef: hook.contentUpdateTimeoutRef,
    lastThinkingUpdateRef: hook.lastThinkingUpdateRef,
    thinkingUpdateTimeoutRef: hook.thinkingUpdateTimeoutRef,
    findLastAssistantIndex: hook.findLastAssistantIndex,
    extractRawBlocks: hook.extractRawBlocks,
    getOrCreateStreamingAssistantIndex: hook.getOrCreateStreamingAssistantIndex,
    patchAssistantForStreaming: hook.patchAssistantForStreaming,
  });
  renderHook(() => useWindowCallbacks(opts));

  const flushRaf = () => {
    let guard = 0;
    while (rafQueue.length > 0 && guard < 1000) {
      guard += 1;
      rafQueue.shift()!(0);
    }
  };
  /** The input box appends the sent user message (useMessageSender). */
  const sendUserMessage = (text: string) => {
    setMessages((prev: ClaudeMessage[]) => [
      ...prev,
      { type: 'user', content: text, timestamp: '2026-11-03T10:04:47.673Z', isOptimistic: true, raw: { message: { content: [{ type: 'text', text }] } } } as ClaudeMessage,
    ]);
  };
  return { hook, buffer, snapshots, flushRaf, sendUserMessage };
}

/** Feed the host -> webview sequence derived from the turn 75 trace. */
function replayTurn75(flushRaf: () => void, mode: RafMode, sendUserMessage: (text: string) => void) {
  const send = (obj: unknown) => window.onMessage!(JSON.stringify(obj));
  const deltas = (parts: string[], fn: (s: string) => void) => {
    for (const part of parts) {
      fn(part);
      if (mode === 'eager') flushRaf();
    }
    flushRaf();
  };
  const tool1 = toolUseMessage('toolu_01LTC12PG4vBHcsL63rgNWLY', 'Bash', { command: 'grep -rn open_browser webview/src' }, 'msg_011CgfoAkFNLTDfRMbvhgE6K');
  const result1 = toolResultMessage('toolu_01LTC12PG4vBHcsL63rgNWLY', '--- open_browser senders in webview ---');
  const tool2 = toolUseMessage('toolu_01TFmhexTNX39Q6ZXnSdLLiW', 'Bash', { command: 'sed -n 1,80p index.html' }, 'msg_011CgfoCdsw964mEyWj2FQ74');
  const result2 = toolResultMessage('toolu_01TFmhexTNX39Q6ZXnSdLLiW', 'le.length - 1; i >= 0; i--) {');
  const tool3 = toolUseMessage('toolu_01SufRiYr6AZbDxyHSQce8Ma', 'Agent', { description: 'Fix double link open and focus restore', subagent_type: 'implementer', prompt: '...' }, 'msg_011CgfoDTCGNEJGgGpgqoUdb');
  const result3 = toolResultMessage('toolu_01SufRiYr6AZbDxyHSQce8Ma', "This agent's report was delivered");
  const tool4 = toolUseMessage('toolu_01FpGgGQ5DChgtpuHBpRjQfy', 'Bash', { command: 'npm run build && git commit' }, 'msg_011CgfocCTPimfJzmwN3nFgu');
  const result4 = toolResultMessage('toolu_01FpGgGQ5DChgtpuHBpRjQfy', ' M webview/src/components/ChatInputBox/ChatInputBox.tsx');

  act(() => {
    window.onStreamStart!();
    send(systemMessage('init', { cwd: '/Users/lukicenturi/Sites/vscode-cc-gui', tools: ['Bash'] }));
    send(systemMessage('status', { status: 'requesting' }));
    window.onBlockReset!();
    send(systemMessage('thinking_tokens', { estimated_tokens: 50 }));
    window.onBlockReset!();
    flushRaf();
  });
  // Narration text, streamed once.
  act(() => { deltas(NARRATION_DELTAS, (s) => window.onContentDelta!(s)); });
  // Iteration 1: tool_use block start, assistant tool_use snapshot, tool result.
  act(() => {
    window.onBlockReset!();
    send(tool1);
    flushRaf();
    send(result1);
    send(systemMessage('status', { status: 'requesting' }));
    window.onBlockReset!();
    send(systemMessage('thinking_tokens', { estimated_tokens: 50 }));
    window.onBlockReset!();
    flushRaf();
  });
  // Iteration 2.
  act(() => {
    send(tool2);
    send(result2);
    send(systemMessage('status', { status: 'requesting' }));
    window.onBlockReset!();
    send(systemMessage('thinking_tokens', { estimated_tokens: 50 }));
    window.onBlockReset!();
    flushRaf();
  });
  // Iteration 3: thinking text, then an Agent tool_use with task_* events.
  act(() => { deltas(THINKING_DELTAS, (s) => window.onThinkingDelta!(s)); });
  act(() => {
    window.onBlockReset!();
    send(tool3);
    send(systemMessage('task_started', { task_id: 'ad55d859f1d2c2dc4', tool_use_id: 'toolu_01SufRiYr6AZbDxyHSQce8Ma' }));
    send(systemMessage('task_progress', { task_id: 'ad55d859f1d2c2dc4', tool_use_id: 'toolu_01SufRiYr6AZbDxyHSQce8Ma' }));
    const notification = systemMessage('task_notification', {
      task_id: 'bcdratdi1', tool_use_id: 'toolu_01AUREwU6amSyKBbD6dqJkfV', status: 'completed', summary: 'Write hook tests',
    });
    window.onTaskEvent?.(JSON.stringify(notification));
    send(notification);
    const notification2 = systemMessage('task_notification', {
      task_id: 'ad55d859f1d2c2dc4', tool_use_id: 'toolu_01SufRiYr6AZbDxyHSQce8Ma', status: 'completed', summary: 'done',
    });
    window.onTaskEvent?.(JSON.stringify(notification2));
    send(notification2);
    send(result3);
    send(systemMessage('status', { status: 'requesting' }));
    window.onBlockReset!();
    window.onBlockReset!();
    flushRaf();
  });
  // Iteration 4.
  act(() => {
    send(tool4);
    send(systemMessage('task_started', { task_id: 'bjidi2zzr', tool_use_id: 'toolu_01FpGgGQ5DChgtpuHBpRjQfy' }));
    send(systemMessage('task_notification', { task_id: 'bjidi2zzr', tool_use_id: 'toolu_01FpGgGQ5DChgtpuHBpRjQfy', status: 'completed' }));
    send(systemMessage('vcs_state_changed'));
    send(result4);
    send(systemMessage('status', { status: 'requesting' }));
    flushRaf();
  });
  // Final answer: block start, then a 15 ms burst of deltas.
  act(() => {
    window.onBlockReset!();
    deltas(FINAL_DELTAS, (s) => window.onContentDelta!(s));
  });
  // STREAM_END: result message, turn_messages flush, stream_end.
  act(() => {
    send({ type: 'result', subtype: 'success', result: FINAL, stop_reason: 'end_turn', session_id: SESSION, uuid: nextUuid(), usage: { input_tokens: 100, output_tokens: 9491 } });
    window.onTurnMessages!(JSON.stringify([tool1, result1, tool2, result2, tool3, result3, tool4, result4]));
    window.onStreamEnd!();
    flushRaf();
  });
  // 10:04:47.673: the queued message is sent and the next turn (id 159) starts.
  act(() => {
    sendUserMessage('another feature I like: Quote in the context menu');
    window.onStreamStart!();
    flushRaf();
  });
}

const normalize = (raw?: ClaudeMessage['raw']) => normalizeBlocks(raw, (text: string) => text, t);
const blocksOf = (message: ClaudeMessage) => getContentBlocks(message, normalize, (text: string) => text);

/** The visible assistant text blocks of turn 75, after the same merge the UI applies. */
function visibleAssistantTexts(messages: ClaudeMessage[]): string[] {
  const turnStart = messages.findIndex((m) => (m.raw as { uuid?: string } | undefined)?.uuid === 'prev-user');
  const merged = mergeConsecutiveAssistantMessages(messages.slice(turnStart + 1), normalize);
  return merged
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => blocksOf(m))
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .filter((text) => text.trim().length > 0);
}

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('streaming turn replay (turn 75 trace)', () => {
  beforeEach(() => {
    uuidCounter = 0;
    window.__sessionTransitioning = false;
    window.__sessionTransitionToken = null;
    window.__deniedToolIds = new Set();
    window.__minAcceptedUpdateSequence = 0;
    window.__streamHardStopped = false;
    window.__lastStreamEndedTurnId = undefined;
    window.__lastStreamEndedAt = undefined;
    window.sendToJava = vi.fn();
  });

  afterEach(() => {
    cleanup();
    if (window.__stallWatchdogInterval != null) {
      clearInterval(window.__stallWatchdogInterval);
      window.__stallWatchdogInterval = null;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not repeat the final answer as cut prefixes after two narrated tool calls', () => {
    const { buffer, flushRaf } = setupReplay();
    const send = (obj: unknown) => window.onMessage!(JSON.stringify(obj));
    const narrationA = 'First I read the handler.';
    const narrationB = 'Now I run the tests and the build.';
    const finalAnswer = 'Done. The feature is built and installed. **How to use** Reload the VS Code window.';
    act(() => {
      window.onStreamStart!();
      window.onBlockReset!();
      window.onContentDelta!(narrationA);
      flushRaf();
      window.onBlockReset!();
      send(toolUseMessage('toolu_a', 'Bash', { command: 'a' }, 'msg_a'));
      send(toolResultMessage('toolu_a', 'ok a'));
      window.onBlockReset!();
      window.onContentDelta!(narrationB);
      flushRaf();
      window.onBlockReset!();
      send(toolUseMessage('toolu_b', 'Bash', { command: 'b' }, 'msg_b'));
      send(toolResultMessage('toolu_b', 'ok b'));
      // Extended thinking before the answer gives the slot raw blocks.
      window.onBlockReset!();
      window.onThinkingDelta!('Both steps passed.');
      flushRaf();
      window.onBlockReset!();
      window.onContentDelta!(finalAnswer.slice(0, 40));
      window.onContentDelta!(finalAnswer.slice(40));
      flushRaf();
      window.onStreamEnd!();
      flushRaf();
    });

    const texts = visibleAssistantTexts(buffer.current);
    expect(texts).toEqual([narrationA, narrationB, finalAnswer]);
  });

  for (const mode of ['eager', 'burst'] as RafMode[]) {
    it(`shows the narration and the final answer exactly once in the message list (rAF ${mode})`, () => {
      const { buffer, flushRaf, sendUserMessage } = setupReplay();
      replayTurn75(flushRaf, mode, sendUserMessage);

      const texts = visibleAssistantTexts(buffer.current);
      const all = texts.join('\n');
      expect(countOccurrences(all, 'I will check two things first')).toBe(1);
      expect(countOccurrences(all, 'Both fixes are install')).toBe(1);
      expect(texts).toContain(NARRATION);
      expect(texts).toContain(FINAL);
      // No visible text block is a cut prefix of another one.
      for (const a of texts) {
        for (const b of texts) {
          if (a !== b) expect(b.startsWith(a)).toBe(false);
        }
      }
    });

    it(`gives every rendered message a unique React key during the whole turn (rAF ${mode})`, () => {
      const { snapshots, flushRaf, sendUserMessage } = setupReplay();
      replayTurn75(flushRaf, mode, sendUserMessage);

      for (const snapshot of snapshots) {
        const merged = mergeConsecutiveAssistantMessages(snapshot, normalize);
        const keys = getMessageKeys(merged);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });

    it(`renders the narration and the final answer once in the DOM (rAF ${mode})`, () => {
      const { snapshots, flushRaf, sendUserMessage } = setupReplay();
      replayTurn75(flushRaf, mode, sendUserMessage);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const listProps = {
        streamingActive: true,
        isThinking: false,
        loading: false,
        loadingStartTime: null,
        t,
        getMessageText: (m: ClaudeMessage) => m.content ?? '',
        getContentBlocks: blocksOf,
        findToolResult: () => null,
        extractMarkdownContent: (m: ClaudeMessage) => m.content ?? '',
        messagesEndRef: { current: null },
      };
      const view = (messages: ClaudeMessage[]) => (
        <MessageList {...listProps} messages={mergeConsecutiveAssistantMessages(messages, normalize)} />
      );
      const { container, rerender } = render(view(snapshots[0]));
      for (const snapshot of snapshots.slice(1)) {
        rerender(view(snapshot));
      }
      errorSpy.mockRestore();

      const text = container.textContent ?? '';
      expect(countOccurrences(text, 'I will check two things first')).toBe(1);
      expect(countOccurrences(text, 'Both fixes are install')).toBe(1);
    });
  }
});
