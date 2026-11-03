import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { openFile } from '../utils/bridge';
import { copyToClipboard } from '../utils/copyUtils';
import { COPY_ICON_SVG, highlightCode } from '../utils/highlightCode';
import { looksLikePathSegment } from '../utils/pathSegment';
import { findInlineCodeRanges } from './ChatInputBox/utils/codeFenceDecoration';

interface CollapsibleTextBlockProps {
  content: string;
}

/** Heuristic that prevents matching bare @mentions without path-like structure. */
function isLikelyFilePath(path: string): boolean {
  return (
    /[\\/]/.test(path) || // has path separator
    /:\/\//.test(path) || // protocol:// (terminal, service)
    /\.[A-Za-z]{2,10}$/.test(path) // has source-file extension (≥2 chars)
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Extract a file path starting after `@` at position `start` in `text`.
 * Returns `[fullMatch, filePath, lineStart?, lineEnd?]` or null.
 *
 * Scans forward character-by-character, allowing spaces inside the path
 * when the next word segment looks like a path continuation (contains
 * a path separator or a file extension).  A trailing `#L10-20` line marker
 * is parsed into separate line-start / line-end groups.
 */
function extractAtFilePath(
  text: string,
  start: number,
): { rawPath: string; lineStart?: number; lineEnd?: number } | null {
  const afterAt = text.slice(start);
  let endPos = 0;
  let lineStart: number | undefined;
  let lineEnd: number | undefined;

  while (endPos < afterAt.length) {
    const ch = afterAt[endPos];
    if (ch === '\n' || ch === '\r' || ch === '@') break;

    if (ch === ' ' || ch === '\t') {
      // Look ahead: does the next word look like a path segment?
      const peekRemainder = afterAt.slice(endPos + 1);
      if (
        peekRemainder.length > 0 &&
        peekRemainder[0] !== ' ' &&
        peekRemainder[0] !== '\t' &&
        peekRemainder[0] !== '\n' &&
        peekRemainder[0] !== '\r' &&
        peekRemainder[0] !== '@' &&
        looksLikePathSegment(peekRemainder.split(/\s/)[0])
      ) {
        endPos++; // space is inside the path
        continue;
      }
      break;
    }

    endPos++;
  }

  let rawPath = afterAt.slice(0, endPos);

  // Detect #L10-20 suffix (display-only line marker, not part of the path).
  // Use lastIndexOf so paths like C:\C#\App.cs are not falsely split.
  const hashIndex = rawPath.lastIndexOf('#');
  if (hashIndex !== -1) {
    const suffix = rawPath.slice(hashIndex);
    const lineMatch = suffix.match(/^#L(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      lineStart = Number(lineMatch[1]);
      lineEnd = lineMatch[2] !== undefined ? Number(lineMatch[2]) : undefined;
      rawPath = rawPath.slice(0, hashIndex);
    }
  }

  if (!isLikelyFilePath(rawPath)) return null;

  return { rawPath, lineStart, lineEnd };
}

/**
 * Convert @path references into compact clickable `<a>` links at display time.
 *
 * Before: "@C:\Users\Bob\proj\src\app.ts#L10-20"
 * After:  "<a href=... data-linkify=file>@app.ts#L10-20</a>"
 *
 * The href preserves the full absolute path (with :line format for navigation).
 * Protocol layer text sent to the AI is unchanged — this transformation is
 * display-only.
 *
 * @visibleForTesting
 */
export function convertAtFileRefsToLinks(text: string): string {
  if (!text || !text.includes('@')) {
    return escapeHtml(text);
  }

  let result = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '@') {
      result += escapeHtml(text[i]);
      i++;
      continue;
    }

    // Skip @@ (escaped literal @)
    if (i + 1 < text.length && text[i + 1] === '@') {
      result += '@@';
      i += 2;
      continue;
    }

    const extracted = extractAtFilePath(text, i + 1);
    if (!extracted) {
      result += escapeHtml(text[i]);
      i++;
      continue;
    }

    const { rawPath, lineStart, lineEnd } = extracted;
    const fileName = rawPath.split(/[/\\]/).pop() || rawPath;

    // Build display text
    let displayText: string;
    if (lineStart !== undefined) {
      displayText = lineEnd !== undefined
        ? `@${fileName}#L${lineStart}-${lineEnd}`
        : `@${fileName}#L${lineStart}`;
    } else {
      displayText = `@${fileName}`;
    }

    // Build href — use :line format for openFile / parseFileLinkTarget compatibility
    const encodedPath = rawPath.replace(/ /g, '%20');
    let href: string;
    if (lineStart !== undefined) {
      href = lineEnd !== undefined
        ? `${encodedPath}:${lineStart}-${lineEnd}`
        : `${encodedPath}:${lineStart}`;
    } else {
      href = encodedPath;
    }

    result += `<a class="file-link" data-linkify="file" href="${escapeHtml(href)}" title="${escapeHtml(rawPath)}">${escapeHtml(displayText)}</a>`;

    // Advance past the full match: @ + rawPath + optional #L suffix
    i += 1 + extracted.rawPath.length; // skip '@' + rawPath
    if (extracted.lineStart !== undefined) {
      // Skip past the #L marker text in the original
      const marker = extracted.lineEnd !== undefined
        ? `#L${extracted.lineStart}-${extracted.lineEnd}`
        : `#L${extracted.lineStart}`;
      i += marker.length;
    }
  }

  return result;
}

/** A part of the user text, as segmentUserText gives it. */
export type UserTextSegment =
  | { type: 'text'; text: string }
  | { type: 'inline-code'; text: string }
  | { type: 'fence'; code: string; lang: string };

/** An opening fence line: up to 3 spaces, 3 or more ` or ~, an info string. */
const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A closing fence line: up to 3 spaces, 3 or more ` or ~, only spaces after. */
const CLOSE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** The language names that the code element can show in its class. */
const SAFE_LANG_RE = /^[\w#+.-]+$/;

/** The opening fence of a line, or null when the line is not an opening fence. */
function matchOpenFence(line: string): { marker: string; lang: string } | null {
  const match = OPEN_FENCE_RE.exec(line.replace(/\r$/, ''));
  if (!match) return null;
  const marker = match[1];
  const info = match[2];
  // The info string of a ``` fence cannot have a backtick (CommonMark):
  // ```a``` on one line is not a fence.
  if (marker[0] === '`' && info.includes('`')) return null;
  const lang = info.trim().split(/\s+/)[0] ?? '';
  return { marker, lang: SAFE_LANG_RE.test(lang) ? lang : '' };
}

/** True when the line closes a fence that opened with the marker. */
function isCloseFence(line: string, openMarker: string): boolean {
  const match = CLOSE_FENCE_RE.exec(line.replace(/\r$/, ''));
  return (
    match !== null &&
    match[1][0] === openMarker[0] &&
    match[1].length >= openMarker.length
  );
}

/** Split plain lines into text and inline code segments. */
function pushInlineSegments(lines: string[], segments: UserTextSegment[]): void {
  let text = '';
  lines.forEach((line, index) => {
    if (index > 0) text += '\n';
    let pos = 0;
    for (const range of findInlineCodeRanges(line)) {
      text += line.slice(pos, range.start);
      if (text) segments.push({ type: 'text', text });
      text = '';
      segments.push({ type: 'inline-code', text: line.slice(range.start + 1, range.end) });
      pos = range.end + 1;
    }
    text += line.slice(pos);
  });
  if (text) segments.push({ type: 'text', text });
}

/**
 * Split user text into fenced code blocks, inline code and plain text.
 *
 * - A fence starts at a line with 3 or more ` or ~ (and an optional
 *   language). It stops at a closing line with the same character and at
 *   least the same count, or at the end of the text. The fence lines are not
 *   in the segment, and the line breaks next to a fence are removed because
 *   the code block is a block element.
 * - Inline code follows the rules of the chat input: one backtick on each
 *   side, at least one character between, in one line. A run of 2 or more
 *   backticks is plain text.
 *
 * @visibleForTesting
 */
export function segmentUserText(text: string): UserTextSegment[] {
  const segments: UserTextSegment[] = [];
  if (!text) return segments;

  const lines = text.split('\n');
  let plain: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const open = matchOpenFence(lines[i]);
    if (!open) {
      plain.push(lines[i]);
      i++;
      continue;
    }

    pushInlineSegments(plain, segments);
    plain = [];

    let end = i + 1;
    while (end < lines.length && !isCloseFence(lines[end], open.marker)) end++;
    const code = lines
      .slice(i + 1, end)
      .map((line) => line.replace(/\r$/, ''))
      .join('\n');
    segments.push({ type: 'fence', code, lang: open.lang });
    i = end + 1; // skip the closing line (or go past the end)
  }

  pushInlineSegments(plain, segments);
  return segments;
}

interface CodeBlockLabels {
  copyCode: string;
  copySuccess: string;
}

/**
 * Build the HTML of user text. Code blocks get the same structure as the
 * code blocks of MarkdownBlock, thus the same CSS and copy button apply.
 *
 * @visibleForTesting
 */
export function renderUserTextHtml(text: string, labels: CodeBlockLabels): string {
  const copyCode = escapeHtml(labels.copyCode);
  const copySuccess = escapeHtml(labels.copySuccess);

  return segmentUserText(text)
    .map((segment) => {
      switch (segment.type) {
        case 'text':
          return convertAtFileRefsToLinks(segment.text);
        case 'inline-code':
          return `<code>${escapeHtml(segment.text)}</code>`;
        case 'fence': {
          const classAttr = segment.lang ? ` class="language-${escapeHtml(segment.lang)}"` : '';
          return (
            '<div class="code-block-wrapper">' +
            `<pre><code${classAttr}>${highlightCode(segment.code, segment.lang)}</code></pre>` +
            `<button type="button" class="copy-code-btn" title="${copyCode}" aria-label="${copyCode}">` +
            `<span class="copy-icon">${COPY_ICON_SVG.trim()}</span>` +
            `<span class="copy-tooltip">${copySuccess}</span>` +
            '</button>' +
            '</div>'
          );
        }
      }
    })
    .join('');
}

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: ['a', 'div', 'pre', 'code', 'span', 'button', 'svg', 'path'],
  ALLOWED_ATTR: [
    'class',
    'href',
    'data-linkify',
    'data-lang',
    'title',
    'aria-label',
    'type',
    // Copy icon
    'width',
    'height',
    'viewBox',
    'fill',
    'fill-opacity',
    'd',
    'xmlns',
  ],
};

const MAX_HEIGHT = 160; // Approx 7-8 lines

// Very large pasted texts (hundreds of KB) must not be fully materialized in the
// DOM while collapsed: the node is laid out (and re-measured by the
// ResizeObserver) even though max-height hides it visually. Above the
// threshold only a preview slice is rendered until the user expands.
const LARGE_CONTENT_THRESHOLD = 20000;
const COLLAPSED_PREVIEW_CHARS = 10000;

const CollapsibleTextBlock: React.FC<CollapsibleTextBlockProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const copyCode = t('markdown.copyCode');
  const copySuccess = t('markdown.copySuccess');

  const isLargeContent = content.length > LARGE_CONTENT_THRESHOLD;
  const displayContent = !expanded && isLargeContent
    ? content.slice(0, COLLAPSED_PREVIEW_CHARS)
    : content;
  // Large content always overflows the collapsed height — force the affordance on
  const showOverflow = isOverflowing || isLargeContent;

  // Render code fences and inline code, and convert @path references in the
  // plain text to clickable links. A fence that the large-content slice cuts
  // continues to the end of the slice.
  // Sanitize the resulting HTML through DOMPurify as a defense-in-depth measure
  // (all text is already escaped by renderUserTextHtml, but
  // dangerouslySetInnerHTML warrants a final sanitization pass).
  // Memoized: user messages re-render with every parent update, but the
  // conversion only depends on displayContent and the labels.
  const htmlContent = useMemo(
    () =>
      DOMPurify.sanitize(
        renderUserTextHtml(displayContent, { copyCode, copySuccess }),
        SANITIZE_OPTIONS,
      ),
    [displayContent, copyCode, copySuccess],
  );

  useEffect(() => {
    if (!contentRef.current) return;

    const checkHeight = () => {
      if (contentRef.current) {
        setIsOverflowing(contentRef.current.scrollHeight > MAX_HEIGHT);
      }
    };

    // Check initially
    checkHeight();

    // Use ResizeObserver to detect size changes (e.g. window resize or content loading)
    const observer = new ResizeObserver(checkHeight);
    observer.observe(contentRef.current);

    return () => observer.disconnect();
  }, [displayContent]);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  // Delegate clicks: copy buttons of code blocks, and file-link anchors
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    // The target can be a Text node: use its parent element for closest()
    const targetNode = e.target as unknown as Node;
    const target = targetNode.nodeType === Node.TEXT_NODE
      ? (targetNode as Text).parentElement
      : (e.target as HTMLElement);
    if (!target) return;

    const copyBtn = target.closest('button.copy-code-btn') as HTMLButtonElement | null;
    if (copyBtn && contentRef.current?.contains(copyBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const codeElement = copyBtn
        .closest('.code-block-wrapper')
        ?.querySelector('pre code') as HTMLElement | null;
      const text = codeElement?.textContent ?? '';
      if (await copyToClipboard(text)) {
        copyBtn.classList.add('copied');
        window.setTimeout(() => copyBtn.classList.remove('copied'), 1500);
      }
      return;
    }

    const anchor = target.closest('a[data-linkify="file"]') as HTMLAnchorElement | null;
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute('href');
      if (href) openFile(href);
    }
  }, []);

  const contentStyle: React.CSSProperties = {
    maxHeight: (expanded || !showOverflow) ? 'none' : `${MAX_HEIGHT}px`,
    overflow: 'hidden',
  };
  const chevronStyle: React.CSSProperties = {
    transform: expanded ? 'rotate(180deg)' : 'none',
    transition: 'transform 0.2s',
  };

  return (
    <div className={`collapsible-block ${expanded ? 'expanded' : 'collapsed'}`}>
      <div
        className="collapsible-content"
        ref={contentRef}
        style={contentStyle}
        onClick={handleClick}
      >
        <div
          className="plain-text-content markdown-content"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* Gradient overlay when collapsed */}
        {!expanded && showOverflow && (
             <div className="collapse-overlay"></div>
        )}
      </div>

      {showOverflow && (
        <div className="collapse-toggle" onClick={toggleExpand}>
            <span className="codicon codicon-chevron-down" style={chevronStyle}></span>
        </div>
      )}
    </div>
  );
};

export default CollapsibleTextBlock;
