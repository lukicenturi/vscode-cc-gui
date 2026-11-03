import { emitAccumulatedUsage, mergeUsage } from '../../utils/usage-utils.js';
import { truncateErrorContent, truncateToolResultBlock } from './message-output-filter.js';
import {
  normalizeStreamDelta,
  resolveSnapshotDelta,
  resetTurnBlockState,
  prepareAssistantSnapshotBlock,
} from './stream-delta-normalizer.js';

export function emitUsageTag(msg) {
  if (msg.type === 'assistant' && msg.message?.usage) {
    const {
      input_tokens = 0,
      output_tokens = 0,
      cache_creation_input_tokens = 0,
      cache_read_input_tokens = 0
    } = msg.message.usage;
    console.log('[USAGE]', JSON.stringify({
      input_tokens,
      output_tokens,
      cache_creation_input_tokens,
      cache_read_input_tokens
    }));
  }
}

export function createTurnState(requestContext, runtime) {
  return {
    streamingEnabled: requestContext.streamingEnabled,
    streamStarted: false,
    streamEnded: false,
    hasStreamEvents: false,
    lastAssistantContent: '',
    lastThinkingContent: '',
    textBlockContentByIndex: new Map(),
    thinkingBlockContentByIndex: new Map(),
    finalSessionId: requestContext.requestedSessionId || runtime?.sessionId || '',
    accumulatedUsage: null,
    // Per message attempt bookkeeping for [STREAM_ROLLBACK] (see emitStreamRollback).
    emittedContentSinceMessageStart: 0,
    emittedThinkingSinceMessageStart: 0,
    messageOpen: false
  };
}

/**
 * Write one [CONTENT_DELTA] line and count its characters against the current
 * message attempt, so that a later API retry can roll the attempt back.
 */
export function writeContentDelta(turnState, delta) {
  process.stdout.write(`[CONTENT_DELTA] ${JSON.stringify(delta)}\n`);
  turnState.emittedContentSinceMessageStart = (turnState.emittedContentSinceMessageStart || 0) + delta.length;
}

/** Thinking counterpart of {@link writeContentDelta}. */
export function writeThinkingDelta(turnState, delta) {
  process.stdout.write(`[THINKING_DELTA] ${JSON.stringify(delta)}\n`);
  turnState.emittedThinkingSinceMessageStart = (turnState.emittedThinkingSinceMessageStart || 0) + delta.length;
}

/**
 * Discard the text that the current (failed) message attempt streamed.
 *
 * When the API stream fails mid-response, Claude Code retries the request and
 * streams the answer again from the start. Without a rollback, the frontend
 * appends the regenerated answer to the partial one and shows the same prefix
 * several times. The frontend removes the last `content` / `thinking`
 * characters from its cumulative buffers when it receives this marker.
 *
 * Marker format: `[STREAM_ROLLBACK] {"content":<n>,"thinking":<m>}`
 */
export function emitStreamRollback(turnState) {
  const content = turnState.emittedContentSinceMessageStart || 0;
  const thinking = turnState.emittedThinkingSinceMessageStart || 0;
  if (content > 0 || thinking > 0) {
    process.stdout.write(`[STREAM_ROLLBACK] ${JSON.stringify({ content, thinking })}\n`);
  }
  turnState.emittedContentSinceMessageStart = 0;
  turnState.emittedThinkingSinceMessageStart = 0;
  resetTurnBlockState(turnState);
}

/**
 * Handle a `{type:'system', subtype:'api_retry'}` message from Claude Code.
 * Returns true when the message was an api_retry message.
 */
export function processApiRetry(msg, turnState) {
  if (msg?.type !== 'system' || msg.subtype !== 'api_retry') return false;
  const error = typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error ?? '');
  console.error(
    `[RETRY] API retry attempt=${msg.attempt}/${msg.max_retries}`
    + ` delay_ms=${msg.retry_delay_ms} status=${msg.error_status ?? ''}`
    + ` error=${String(error).slice(0, 300)}`
  );
  if (!turnState.streamingEnabled) return true;
  emitStreamRollback(turnState);
  turnState.messageOpen = false;
  return true;
}

/**
 * Mark the current message attempt as complete. A complete message is final,
 * so a later retry (for example of the next request in a tool-use loop) must
 * not roll back its text.
 */
function closeStreamMessage(turnState) {
  turnState.messageOpen = false;
  turnState.emittedContentSinceMessageStart = 0;
  turnState.emittedThinkingSinceMessageStart = 0;
}

export function processStreamEvent(msg, turnState) {
  const event = msg.event;
  if (!event) return;

  if (event.type === 'message_start') {
    // A new message_start while the previous message never closed means that
    // Claude Code restarted the request (stream failure + retry). Discard the
    // text of the failed attempt before the regenerated answer streams in.
    if (turnState.messageOpen && turnState.streamingEnabled) {
      emitStreamRollback(turnState);
    }
    turnState.messageOpen = true;
    turnState.emittedContentSinceMessageStart = 0;
    turnState.emittedThinkingSinceMessageStart = 0;
    // Turn boundary: each assistant message (incl. every tool_use loop iteration)
    // re-numbers its content blocks from index 0. Clear the index-keyed block maps
    // so the prior turn's accumulator / locked stream-mode cannot corrupt or
    // duplicate this turn's index-0 block (see resetTurnBlockState). Usage still
    // accumulates across turns.
    resetTurnBlockState(turnState);
    // Emit BLOCK_RESET signal BEFORE any subsequent deltas to ensure frontend
    // clears its streaming refs (streamingThinkingRef, streamingContentRef).
    // This prevents new turn's thinking/text from merging with previous turn's content.
    // Must emit synchronously here, not in the delta handlers, to guarantee ordering.
    if (turnState.streamingEnabled) {
      process.stdout.write('[BLOCK_RESET]\n');
    }
    if (event.message?.usage) {
      turnState.accumulatedUsage = mergeUsage(turnState.accumulatedUsage, event.message.usage);
    }
  }

  if (event.type === 'content_block_start' && event.content_block) {
    const hasPreviousBlock =
      (turnState.textBlockContentByIndex instanceof Map && turnState.textBlockContentByIndex.size > 0)
      || (turnState.thinkingBlockContentByIndex instanceof Map
        && turnState.thinkingBlockContentByIndex.size > 0);
    if (hasPreviousBlock) {
      resetTurnBlockState(turnState);
      process.stdout.write('[BLOCK_RESET]\n');
    }
  }

  if (event.type === 'message_delta' && event.usage) {
    turnState.accumulatedUsage = mergeUsage(turnState.accumulatedUsage, event.usage);
    emitAccumulatedUsage(turnState.accumulatedUsage);
  }

  if (event.type === 'message_stop' || (event.type === 'message_delta' && event.delta?.stop_reason)) {
    closeStreamMessage(turnState);
  }

  if (event.type === 'content_block_delta' && event.delta) {
    if (event.delta.type === 'text_delta' && event.delta.text) {
      const delta = normalizeStreamDelta(turnState, 'text', event.index, event.delta.text);
      if (delta) {
        writeContentDelta(turnState, delta);
        turnState.lastAssistantContent += delta;
      }
    } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
      const delta = normalizeStreamDelta(turnState, 'thinking', event.index, event.delta.thinking);
      if (delta) {
        writeThinkingDelta(turnState, delta);
        turnState.lastThinkingContent += delta;
      }
    }
  }
}

export function processMessageContent(msg, turnState) {
  if (msg.type !== 'assistant') return;
  // An assistant message means that the SDK accepted (part of) the response.
  // Close the message so that the next message_start of a tool-use loop does
  // not roll back, even when message_stop was not delivered.
  turnState.messageOpen = false;
  const content = msg.message?.content;

  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i += 1) {
      const block = content[i];
      if (block.type === 'text') {
        const text = block.text || '';
        if (prepareAssistantSnapshotBlock(turnState, 'text', i, text, msg)) {
          process.stdout.write('[BLOCK_RESET]\n');
        }
        emitSnapshotText(text, turnState, i);
      } else if (block.type === 'thinking') {
        const thinking = block.thinking || block.text || '';
        if (prepareAssistantSnapshotBlock(turnState, 'thinking', i, thinking, msg)) {
          process.stdout.write('[BLOCK_RESET]\n');
        }
        emitSnapshotThinking(thinking, turnState, i);
      }
    }
  } else if (typeof content === 'string') {
    if (prepareAssistantSnapshotBlock(turnState, 'text', 0, content, msg)) {
      process.stdout.write('[BLOCK_RESET]\n');
    }
    emitSnapshotText(content, turnState, 0);
  }
}

/**
 * Emit a text block carried by an assistant snapshot.
 *
 * Routes the full snapshot through resolveSnapshotDelta — the same novelty/
 * correction engine the live delta path uses — so a mid-stream corrective
 * rewrite is absorbed rather than mis-sliced by a naive substring, and the
 * block map / mode bookkeeping stay single-sourced.
 *
 * Emit gate (unchanged from the tail-fill / new-block-suppression fix):
 *   - !hasStreamEvents: pre-stream fallback, emit the whole computed delta
 *   - hasStreamEvents && hadPrevious: genuine tail-fill / snapshot correction
 *   - hasStreamEvents && !hadPrevious: stream will deliver this block, suppress
 */
function emitSnapshotText(currentText, turnState, blockIndex) {
  if (!turnState.streamingEnabled) {
    console.log('[CONTENT]', truncateErrorContent(currentText));
    return;
  }
  const { delta, hadPrevious } = resolveSnapshotDelta(turnState, 'text', blockIndex, currentText);
  if (delta && (!turnState.hasStreamEvents || hadPrevious)) {
    writeContentDelta(turnState, delta);
  }
  turnState.lastAssistantContent = currentText;
}

/** Thinking-block counterpart to {@link emitSnapshotText}. */
function emitSnapshotThinking(thinkingText, turnState, blockIndex) {
  if (!turnState.streamingEnabled) {
    console.log('[THINKING]', thinkingText);
    return;
  }
  const { delta, hadPrevious } = resolveSnapshotDelta(turnState, 'thinking', blockIndex, thinkingText);
  if (delta && (!turnState.hasStreamEvents || hadPrevious)) {
    writeThinkingDelta(turnState, delta);
  }
  turnState.lastThinkingContent = thinkingText;
}

export function processToolResultMessages(msg) {
  if (msg.type !== 'user') return;
  const content = msg.message?.content ?? msg.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === 'tool_result') {
      console.log('[TOOL_RESULT]', JSON.stringify(truncateToolResultBlock(block)));
    }
  }
}

export function shouldOutputMessage(msg, turnState) {
  // Always output non-assistant messages
  if (msg.type !== 'assistant') {
    return true;
  }

  // Non-streaming mode: always output
  if (!turnState.streamingEnabled) {
    return true;
  }

  // Streaming mode: only emit [MESSAGE] when the snapshot carries tool_use blocks.
  // Pure text/thinking content is delivered via [CONTENT_DELTA] / [THINKING_DELTA]
  // (processStreamEvent for live deltas, processMessageContent for tail-fill).
  // Mirrors the legacy message-sender.js shouldOutput rule. Emitting redundant
  // [MESSAGE] for text-only assistants forces the Java ReplayDeduplicator to
  // reconcile the same content twice and was the upstream cause of duplicated
  // markdown blocks reported on v0.4.x streaming.
  const content = msg?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => block?.type === 'tool_use');
}
