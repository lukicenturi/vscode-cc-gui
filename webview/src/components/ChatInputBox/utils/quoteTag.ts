import { formatQuote } from '../../../utils/quoteFormat.js';
import { escapeHtmlAttr } from './htmlEscape.js';

/**
 * Quote chips in the chat input.
 *
 * A quote chip is a non-editable span that shows a short preview of a quoted
 * message selection. The raw selected text is kept in `data-quote`. When the
 * input text is read (getTextContent), the chip becomes the markdown block
 * quote of that text, without the trailing blank line. The line breaks that
 * follow the chip in the DOM give the blank line.
 */

export const QUOTE_TAG_CLASS = 'quote-tag';
export const QUOTE_TAG_SELECTOR = '.quote-tag';
export const QUOTE_TAG_CLOSE_SELECTOR = '.quote-tag-close';

const PREVIEW_MAX_CHARS = 40;
const TOOLTIP_MAX_CHARS = 300;

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** The first non-empty line of the text, cut to a short preview. */
export function getQuotePreview(rawText: string): string {
  const firstLine =
    rawText
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  return truncate(firstLine, PREVIEW_MAX_CHARS);
}

/** True when the node is a quote chip element. */
export function isQuoteTag(node: Node | null | undefined): node is HTMLElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).classList.contains(QUOTE_TAG_CLASS)
  );
}

/**
 * The text that a quote chip gives in getTextContent: the markdown block
 * quote of the raw text, without the trailing newlines.
 */
export function getQuoteTagText(element: Element): string {
  const raw = element.getAttribute('data-quote') ?? '';
  return formatQuote(raw).replace(/\n+$/, '');
}

/**
 * The HTML of a quote chip for the raw selected text.
 * Returns '' when the text has no visible characters.
 */
export function createQuoteTagHtml(rawText: string): string {
  if (!formatQuote(rawText)) return '';

  const tooltip = truncate(rawText.trim(), TOOLTIP_MAX_CHARS);
  return [
    `<span class="${QUOTE_TAG_CLASS} has-tooltip" contenteditable="false" data-quote="${escapeHtmlAttr(rawText)}" data-tooltip="${escapeHtmlAttr(tooltip)}">`,
    `<span class="quote-tag-icon codicon codicon-quote"></span>`,
    `<span class="quote-tag-text">“${escapeHtmlText(getQuotePreview(rawText))}”</span>`,
    `<span class="quote-tag-close">&times;</span>`,
    `</span>`,
  ].join('');
}

/**
 * Create a quote chip element for the raw selected text.
 * Returns null when the text has no visible characters.
 */
export function createQuoteTagElement(rawText: string): HTMLElement | null {
  const html = createQuoteTagHtml(rawText);
  if (!html) return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as HTMLElement | null;
}

/**
 * The length of an atomic tag (file tag or quote chip) in the text that
 * getTextContent returns, or null when the element is not an atomic tag.
 */
export function getAtomicTagTextLength(element: HTMLElement): number | null {
  if (element.classList.contains('file-tag')) {
    return (element.getAttribute('data-file-path') || '').length + 1;
  }
  if (element.classList.contains(QUOTE_TAG_CLASS)) {
    return getQuoteTagText(element).length;
  }
  return null;
}
