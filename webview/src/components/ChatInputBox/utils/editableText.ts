import { findCodeFenceRanges } from './codeFenceDecoration.js';
import { createQuoteTagElement, QUOTE_TAG_SELECTOR } from './quoteTag.js';
import { formatQuote } from '../../../utils/quoteFormat.js';
import { setCursorOffset } from './selectionUtils.js';
import { setVirtualCursorPosition } from './virtualCursorUtils.js';

/**
 * Write plain text back into the chat input.
 *
 * The text that getTextContent returns has no quote chips: each chip gives
 * its markdown block quote. When a restore path (history, controlled value,
 * setValue, completion, prompt enhancer) writes that text back, the chips
 * must come back. Otherwise the user sees the "> ..." lines of the quote.
 */

/** A part of the text: plain text, or a block quote that becomes a quote chip. */
export type EditableTextPart =
  | { kind: 'text'; text: string }
  | { kind: 'quote'; raw: string };

/** A line of a markdown block quote: "> text" or ">" alone. */
function isQuoteLine(line: string): boolean {
  return line === '>' || line.startsWith('> ');
}

/** The line without its "> " (or ">") prefix. */
function stripQuotePrefix(line: string): string {
  return line === '>' ? '' : line.slice(2);
}

/**
 * Split the text into plain text parts and quote parts.
 *
 * A quote part is a block of consecutive lines that all start with "> " or
 * are exactly ">", outside a code fence, followed by a blank line (the text
 * continues with "\n\n" after the block). The block text must be exactly the
 * text that a quote chip gives (formatQuote of the raw text without the
 * trailing newlines). Thus the chip gives the same text again and a restore
 * is loss-free. A block that does not agree (for example a single ">" line,
 * or a line with trailing spaces) stays plain text.
 *
 * The "\n\n" after a quote part is in the next text part (the two line
 * breaks after the chip).
 */
export function splitQuoteBlocks(text: string): EditableTextPart[] {
  if (!text.includes('>')) return [{ kind: 'text', text }];

  const lines = text.split('\n');
  const inFence = new Array<boolean>(lines.length).fill(false);
  for (const range of findCodeFenceRanges(lines)) {
    for (let i = range.start; i <= range.end; i++) inFence[i] = true;
  }
  const isQuoteLineAt = (i: number) => !inFence[i] && isQuoteLine(lines[i]);

  const parts: EditableTextPart[] = [];
  // Index of the first line that is not in a part yet
  let textStart = 0;
  // After a chip, textStart is the blank line after the chip, and the text
  // continues with the line break that ends the chip line.
  let afterChip = false;
  const textFrom = (start: number, endLine: number) =>
    `${afterChip ? '\n' : ''}${lines.slice(start, endLine).join('\n')}`;
  let i = 0;
  while (i < lines.length) {
    if (!isQuoteLineAt(i)) {
      i++;
      continue;
    }

    let end = i;
    while (end < lines.length && isQuoteLineAt(end)) end++;

    // The block must be followed by a blank line: an empty line, and then a
    // line break after it.
    const followedByBlankLine = end < lines.length - 1 && lines[end] === '';
    const block = lines.slice(i, end);
    const raw = block.map(stripQuotePrefix).join('\n');
    const chipText = formatQuote(raw).replace(/\n+$/, '');

    if (followedByBlankLine && chipText !== '' && chipText === block.join('\n')) {
      if (i > textStart) {
        // The text before the block, with the line break before the block
        parts.push({ kind: 'text', text: `${textFrom(textStart, i)}\n` });
      }
      parts.push({ kind: 'quote', raw });
      textStart = end;
      afterChip = true;
    }
    i = end;
  }

  if (parts.length === 0) return [{ kind: 'text', text }];

  // The text after the last chip starts with the "\n\n" of the blank line
  parts.push({ kind: 'text', text: textFrom(textStart, lines.length) });
  return parts;
}

/** Append plain text as text nodes, with a <br> for each "\n" (as the innerText setter does). */
function appendPlainText(target: DocumentFragment, text: string): void {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) target.appendChild(document.createElement('br'));
    if (line) target.appendChild(document.createTextNode(line));
  });
}

/**
 * Write the text into the editable element.
 *
 * Markdown block quotes (see splitQuoteBlocks) become quote chips. All other
 * text is written as the innerText setter writes it. When the text has no
 * such block quote, the function sets innerText, as before.
 * extractEditableText of the element gives the same text again.
 *
 * The function does not move the caret. Each caller sets the caret.
 *
 * @returns true when the element has a quote chip after the write
 */
export function setEditableText(editable: HTMLElement, text: string): boolean {
  const parts = splitQuoteBlocks(text);
  if (!parts.some((part) => part.kind === 'quote')) {
    editable.innerText = text;
    return false;
  }

  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind === 'text') {
      appendPlainText(fragment, part.text);
      continue;
    }
    const chip = createQuoteTagElement(part.raw);
    if (chip) {
      fragment.appendChild(chip);
    } else {
      // splitQuoteBlocks makes a quote part only when the chip has text
      appendPlainText(fragment, formatQuote(part.raw).replace(/\n+$/, ''));
    }
  }
  editable.replaceChildren(fragment);
  return true;
}

/**
 * Put the caret at an offset in the text that getTextContent returns.
 *
 * When the element has a quote chip, uses the virtual cursor (the chip counts
 * as its text length, a <br> as 1). Otherwise uses setCursorOffset, as before.
 */
export function setCaretAtTextOffset(editable: HTMLElement, offset: number): boolean {
  if (editable.querySelector(QUOTE_TAG_SELECTOR)) {
    return setVirtualCursorPosition(editable, offset);
  }
  return setCursorOffset(editable, offset);
}
