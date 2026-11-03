import { memo, useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { TFunction } from 'i18next';
import type { ClaudeMessage, ClaudeContentBlock, ToolResultBlock } from '../types';
import { getMessageKeys } from '../utils/messageUtils';
import { MessageItem } from './MessageItem';
import WaitingIndicator from './WaitingIndicator';
import { ContextMenu } from './ContextMenu';
import { useContextMenu, copySelection } from '../hooks/useContextMenu.js';
import { formatQuote } from '../utils/quoteFormat';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const QUOTE_SHORTCUT_LABEL = IS_MAC ? '⌘⇧Q' : 'Ctrl+Shift+Q';

function isQuoteShortcut(e: KeyboardEvent): boolean {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  return mod && e.shiftKey && !e.altKey && (e.key === 'q' || e.key === 'Q');
}

/** Put the selected text into the chat input as a quote chip. */
function quoteSelection(selectedText: string): void {
  const quote = formatQuote(selectedText);
  if (!quote) return;
  // Show the quote as a chip in the input. The sent text has the same
  // markdown block quote. Older inputs get the plain text.
  if (window.insertQuoteIntoChatInput) {
    window.insertQuoteIntoChatInput(selectedText);
  } else {
    window.insertTextIntoChatInput?.(quote);
  }
}
import type { MessageListRevealHandle } from './ConversationSearch/types';

/** Always render at least this many recent messages. Earlier messages are collapsed. */
const VISIBLE_MESSAGE_WINDOW = 15;
/** Number of additional earlier messages to reveal per "show earlier" click. */
const REVEAL_PAGE_SIZE = 30;

function extractToolResultPreview(result: ToolResultBlock | null | undefined): string {
  if (!result) return 'pending';

  let text = '';
  if (typeof result.content === 'string') {
    text = result.content;
  } else if (Array.isArray(result.content)) {
    text = result.content
      .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  const preview = text.length > 200 ? text.slice(0, 200) : text;
  return `${result.is_error === true ? 'error' : 'ok'}:${text.length}:${preview}`;
}

function getMessageToolResultSignature(
  message: ClaudeMessage,
  messageIndex: number,
  getContentBlocks: (message: ClaudeMessage) => ClaudeContentBlock[],
  findToolResult: (toolId: string | undefined, messageIndex: number) => ToolResultBlock | null | undefined,
): string {
  const toolUses = getContentBlocks(message).filter(
    (block): block is Extract<ClaudeContentBlock, { type: 'tool_use' }> => block.type === 'tool_use',
  );
  if (toolUses.length === 0) return '';

  return toolUses
    .map((block) => `${block.id ?? 'unknown'}:${extractToolResultPreview(findToolResult(block.id, messageIndex))}`)
    .join('|');
}

interface MessageListProps {
  messages: ClaudeMessage[];
  streamingActive: boolean;
  isThinking: boolean;
  loading: boolean;
  loadingStartTime: number | null;
  t: TFunction;
  getMessageText: (message: ClaudeMessage) => string;
  getContentBlocks: (message: ClaudeMessage) => ClaudeContentBlock[];
  findToolResult: (toolId: string | undefined, messageIndex: number) => ToolResultBlock | null | undefined;
  extractMarkdownContent: (message: ClaudeMessage) => string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onMessageNodeRef?: (id: string, node: HTMLDivElement | null) => void;
  /** Notify parent when the number of collapsed (hidden) messages changes. */
  onCollapsedCountChange?: (count: number) => void;
  onNavigateToProviderSettings?: () => void;
  onNavigateToDependencySettings?: () => void;
}

export const MessageList = memo(forwardRef<MessageListRevealHandle, MessageListProps>(function MessageList({
  messages,
  streamingActive,
  isThinking,
  loading,
  loadingStartTime,
  t,
  getMessageText,
  getContentBlocks,
  findToolResult,
  extractMarkdownContent,
  messagesEndRef,
  onMessageNodeRef,
  onCollapsedCountChange,
  onNavigateToProviderSettings,
  onNavigateToDependencySettings,
}, ref) {
  // Number of earlier messages revealed beyond VISIBLE_MESSAGE_WINDOW. Grows in
  // page-size chunks as the user clicks "show earlier", avoiding a single huge
  // mount when sessions exceed hundreds of messages.
  const [revealedCount, setRevealedCount] = useState(0);

  // Context menu for message list (copy and quote, when text selected)
  const ctxMenu = useContextMenu();
  const handleMessageContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      ctxMenu.open(e);
    }
  }, [ctxMenu.open]);

  // Quote shortcut: Cmd+Shift+Q (macOS) / Ctrl+Shift+Q when the selection
  // lies inside the message list. Listen on the document because the
  // selection, not the focus, decides where the key applies.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isQuoteShortcut(e)) return;
      const sel = window.getSelection();
      const text = sel?.toString() ?? '';
      if (!sel || sel.rangeCount === 0 || !text.trim()) return;
      const anchor = sel.getRangeAt(0).commonAncestorContainer;
      if (!listRef.current?.contains(anchor)) return;
      e.preventDefault();
      quoteSelection(text);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Reset revealed count when a new session starts (first message ID changes)
  const firstMsgIdRef = useRef(messages[0]?.id);
  useEffect(() => {
    const currentFirstId = messages[0]?.id;
    if (currentFirstId !== firstMsgIdRef.current) {
      setRevealedCount(0);
    }
    firstMsgIdRef.current = currentFirstId;
  }, [messages]);

  const totalEarlierMessages = Math.max(0, messages.length - VISIBLE_MESSAGE_WINDOW);
  const effectiveRevealed = Math.min(revealedCount, totalEarlierMessages);
  const shouldCollapse = effectiveRevealed < totalEarlierMessages;
  const collapsedCount = totalEarlierMessages - effectiveRevealed;
  const nextChunkSize = Math.min(REVEAL_PAGE_SIZE, collapsedCount);

  const handleRevealMore = useCallback(() => {
    setRevealedCount((prev) => prev + REVEAL_PAGE_SIZE);
  }, []);

  // Imperative API so the in-page search can expand everything before scanning.
  // Returns the number of messages that were just revealed (0 when nothing
  // was collapsed). This lets the search panel surface "Expanded N earlier
  // messages" exactly once per panel-open, per the agreed design.
  useImperativeHandle(ref, (): MessageListRevealHandle => ({
    revealAll: () => {
      if (totalEarlierMessages === 0) return 0;
      const previouslyHidden = collapsedCount;
      if (previouslyHidden === 0) return 0;
      setRevealedCount(totalEarlierMessages);
      return previouslyHidden;
    },
  }), [totalEarlierMessages, collapsedCount]);

  // Notify parent of collapsed count changes (for anchor rail sync)
  useEffect(() => {
    onCollapsedCountChange?.(collapsedCount);
  }, [collapsedCount, onCollapsedCountChange]);
  const visibleMessages = useMemo(
    () => (shouldCollapse ? messages.slice(collapsedCount) : messages),
    [messages, shouldCollapse, collapsedCount]
  );
  // Unique keys over the full list (see getMessageKeys): duplicate keys make
  // React leave stale message nodes behind, which shows the same text twice.
  const messageKeys = useMemo(() => getMessageKeys(messages), [messages]);

  return (
    <div ref={listRef} onContextMenu={handleMessageContextMenu}>
      {ctxMenu.visible && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={ctxMenu.close}
          items={[
            {
              label: t('contextMenu.quote', 'Quote'),
              shortcut: QUOTE_SHORTCUT_LABEL,
              action: () => quoteSelection(ctxMenu.selectedText),
            },
            { label: t('contextMenu.copy', 'Copy'), action: () => copySelection(ctxMenu.savedRange, ctxMenu.selectedText) },
          ]}
        />
      )}
      {shouldCollapse && (
        <div
          className="collapsed-messages-indicator"
          onClick={handleRevealMore}
        >
          {t('chat.showEarlierMessages', { count: nextChunkSize })}
          {collapsedCount > nextChunkSize ? ` (${collapsedCount})` : ''}
        </div>
      )}

      {visibleMessages.map((message, visibleIndex) => {
        const messageIndex = shouldCollapse ? visibleIndex + collapsedCount : visibleIndex;
        const messageKey = messageKeys[messageIndex];
        const toolResultSignature = getMessageToolResultSignature(message, messageIndex, getContentBlocks, findToolResult);

        return (
          <MessageItem
            key={messageKey}
            message={message}
            messageIndex={messageIndex}
            messageKey={messageKey}
            isLast={messageIndex === messages.length - 1}
            streamingActive={streamingActive}
            isThinking={isThinking}
            t={t}
            getMessageText={getMessageText}
            getContentBlocks={getContentBlocks}
            findToolResult={findToolResult}
            extractMarkdownContent={extractMarkdownContent}
            onNodeRef={onMessageNodeRef}
            onNavigateToProviderSettings={onNavigateToProviderSettings}
            onNavigateToDependencySettings={onNavigateToDependencySettings}
            toolResultSignature={toolResultSignature}
          />
        );
      })}

      {/* Loading indicator */}
      {loading && <WaitingIndicator startTime={loadingStartTime ?? undefined} />}
      <div ref={messagesEndRef} />
    </div>
  );
}));
