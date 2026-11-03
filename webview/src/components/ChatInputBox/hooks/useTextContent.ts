import { useCallback, useRef } from 'react';
import { perfTimer } from '../../../utils/debug.js';
import { getQuoteTagText, QUOTE_TAG_CLASS } from '../utils/quoteTag.js';

interface TextContentCache {
  content: string;
  htmlSnapshot: string;
  valid: boolean;
  timestamp: number;
}

interface UseTextContentOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
}

interface UseTextContentReturn {
  /** Get text content from editable element (with cache optimization) */
  getTextContent: () => string;
  /** Invalidate cache to force fresh content read */
  invalidateCache: () => void;
}

interface ExtractEditableTextOptions {
  /**
   * When set, each quote chip gives this string instead of its markdown
   * block quote. renderFileTags uses it to keep the chips when it rebuilds
   * the input HTML.
   */
  quotePlaceholder?: string;
}

/**
 * Extract plain text from a contenteditable element.
 *
 * - A file tag gives "@<data-file-path>".
 * - A quote chip gives the markdown block quote of its data-quote text,
 *   without the trailing newlines (the <br> elements after the chip give them).
 * - <br> gives "\n"; <div>/<p> start on a new line.
 *
 * Performance: uses array + join instead of string concatenation (O(n) vs O(n^2)).
 */
export function extractEditableText(
  root: HTMLElement,
  options: ExtractEditableTextOptions = {}
): string {
  const textParts: string[] = [];
  let endsWithNewline = false;

  // Recursive traversal, but for file-tag / quote-tag only read the data
  // attribute without descending
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent || '';
      if (content) {
        textParts.push(content);
        endsWithNewline = content.endsWith('\n');
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();

      // Handle line break elements
      if (tagName === 'br') {
        textParts.push('\n');
        endsWithNewline = true;
      } else if (tagName === 'div' || tagName === 'p') {
        // Add newline before div/p (if not first element and doesn't already end with newline)
        if (textParts.length > 0 && !endsWithNewline) {
          textParts.push('\n');
          endsWithNewline = true;
        }
        node.childNodes.forEach(walk);
      } else if (element.classList.contains('file-tag')) {
        const filePath = element.getAttribute('data-file-path') || '';
        textParts.push(`@${filePath}`);
        endsWithNewline = false;
        // Don't traverse file-tag children to avoid duplicate filename and close button text
      } else if (element.classList.contains(QUOTE_TAG_CLASS)) {
        const quoteText = options.quotePlaceholder ?? getQuoteTagText(element);
        if (quoteText) {
          textParts.push(quoteText);
          endsWithNewline = false;
        }
        // Don't traverse quote-tag children (preview text and close button)
      } else {
        // Continue traversing child nodes
        node.childNodes.forEach(walk);
      }
    }
  };

  root.childNodes.forEach(walk);

  // Join all parts into final text
  let text = textParts.join('');

  // Only remove trailing newline that JCEF might add (not user-entered newlines)
  // If there are multiple trailing newlines, only remove the last one (JCEF added)
  if (text.endsWith('\n') && root.childNodes.length > 0) {
    const lastChild = root.lastChild;
    // Only remove if last node is not a br tag (meaning it's JCEF added)
    if (
      lastChild?.nodeType !== Node.ELEMENT_NODE ||
      (lastChild as HTMLElement).tagName?.toLowerCase() !== 'br'
    ) {
      text = text.slice(0, -1);
    }
  }

  return text;
}

/**
 * useTextContent - Extract plain text from contenteditable element
 *
 * Performance optimization:
 * - Uses cache to avoid repeated DOM traversal
 * - Cache is invalidated when the exact innerHTML snapshot changes
 * - Properly handles file tags by reading data-file-path attribute
 */
export function useTextContent({
  editableRef,
}: UseTextContentOptions): UseTextContentReturn {
  const textCacheRef = useRef<TextContentCache>({
    content: '',
    htmlSnapshot: '',
    valid: false,
    timestamp: 0,
  });

  /**
   * Invalidate cache to force fresh content read
   */
  const invalidateCache = useCallback(() => {
    textCacheRef.current = { content: '', htmlSnapshot: '', valid: false, timestamp: 0 };
  }, []);

  /**
   * Get plain text content from editable element
   * Extracts text including file tag references in @path format
   *
   * Performance optimization:
   * - Uses array + join instead of string concatenation (O(n) vs O(n²))
   * - Tracks last character type to avoid repeated string operations
   */
  const getTextContent = useCallback((): string => {
    const timer = perfTimer('getTextContent');
    if (!editableRef.current) return '';

    // Performance optimization: Check cache validity
    // Comparing only innerHTML.length allows different DOM states with the same
    // size to reuse stale text. File icon SVG sizes make that collision depend
    // on the referenced extension, which is especially confusing for users.
    const currentHtml = editableRef.current.innerHTML;
    const cache = textCacheRef.current;

    // Return cached content only when the exact DOM snapshot is unchanged.
    if (cache.valid && currentHtml === cache.htmlSnapshot) {
      timer.mark('cache-hit');
      timer.end();
      return cache.content;
    }
    timer.mark('cache-miss');

    const text = extractEditableText(editableRef.current);
    timer.mark('dom-walk');

    // Update cache
    textCacheRef.current = {
      content: text,
      htmlSnapshot: currentHtml,
      valid: true,
      timestamp: Date.now(),
    };

    timer.end();
    return text;
  }, [editableRef]);

  return {
    getTextContent,
    invalidateCache,
  };
}
