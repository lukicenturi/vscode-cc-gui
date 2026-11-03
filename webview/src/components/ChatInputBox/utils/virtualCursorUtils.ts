/**
 * Virtual cursor position utilities for contenteditable elements with file tags.
 *
 * File tags (<span class="file-tag" data-file-path="...">) are represented as
 * "@filepath" in virtual text (getTextContent). These utilities handle the mapping
 * between DOM cursor positions and virtual text offsets.
 *
 * Quote chips (<span class="quote-tag" data-quote="...">) are atomic in the
 * same way: their length is the length of their markdown block quote text.
 *
 * Extracted from useTriggerDetection.ts for reuse in useFileTags.ts and other hooks.
 */

import { getAtomicTagTextLength } from './quoteTag.js';

/** Sentinel target offset: the start of a line element (<div>/<p>). */
const LINE_START = -2;

/** True when the element is a line element (<div>/<p>). */
function isBlockLine(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase();
  return tagName === 'div' || tagName === 'p';
}

/**
 * The first child of the node when it is a line element (<div>/<p>), else
 * null. Skips leading non-editable elements that give no text (for example
 * the language badge of a code fence block).
 */
function getFirstLineChild(node: Node): HTMLElement | null {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) return null;
    const el = child as HTMLElement;
    if (isBlockLine(el)) return el;
    const isEmptyDecoration =
      el.getAttribute('contenteditable') === 'false' && !el.textContent;
    if (!isEmptyDecoration) return null;
  }
  return null;
}

/**
 * Helper: check if text ends with a newline
 */
function textEndsWithNewline(text: string | null): boolean {
  return text !== null && text.length > 0 && text.endsWith('\n');
}

/**
 * Get the virtual cursor position in a contenteditable element.
 *
 * "Virtual position" means the character offset in the text returned by getTextContent(),
 * where file tags are counted as "@" + filepath length (not their visible DOM text).
 *
 * @param element - The contenteditable element
 * @returns The virtual character offset, or 0 if cursor is not found
 */
export function getVirtualCursorPosition(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);

  let position = 0;
  let found = false;
  let endsWithNewline = false;

  const walk = (node: Node): boolean => {
    if (found) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (range.endContainer === node) {
        position += range.endOffset;
        found = true;
        return true;
      }
      position += text.length;
      endsWithNewline = textEndsWithNewline(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      if (tagName === 'br') {
        if (
          range.endContainer === el ||
          (range.endContainer === element &&
            el === element.childNodes[range.endOffset - 1])
        ) {
          found = true;
          return true;
        }
        position += 1;
        endsWithNewline = true;
        return false;
      }

      if (tagName === 'div' || tagName === 'p') {
        if (position > 0 && !endsWithNewline) {
          position += 1;
          endsWithNewline = true;
        }

        if (range.endContainer === el) {
          const children = Array.from(el.childNodes);
          for (let i = 0; i < range.endOffset && i < children.length; i++) {
            const child = children[i];
            if (child.nodeType === Node.TEXT_NODE) {
              position += child.textContent?.length || 0;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const childEl = child as HTMLElement;
              const childTag = childEl.tagName.toLowerCase();
              if (childTag === 'br') {
                position += 1;
              } else if (getAtomicTagTextLength(childEl) !== null) {
                position += getAtomicTagTextLength(childEl) ?? 0;
              } else {
                position += childEl.textContent?.length || 0;
              }
            }
          }
          found = true;
          return true;
        }

        for (const child of Array.from(el.childNodes)) {
          if (walk(child)) return true;
        }
        return false;
      }

      const atomicTagLength = getAtomicTagTextLength(el);
      if (atomicTagLength !== null) {
        const tagLength = atomicTagLength;

        if (el.contains(range.endContainer)) {
          position += tagLength;
          found = true;
          return true;
        }
        position += tagLength;
        endsWithNewline = false;
      } else {
        if (range.endContainer === el) {
          const children = Array.from(el.childNodes);
          for (let i = 0; i < range.endOffset && i < children.length; i++) {
            const child = children[i];
            if (child.nodeType === Node.TEXT_NODE) {
              position += child.textContent?.length || 0;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const childEl = child as HTMLElement;
              const childTag = childEl.tagName.toLowerCase();
              if (childTag === 'br') {
                position += 1;
              } else if (getAtomicTagTextLength(childEl) !== null) {
                position += getAtomicTagTextLength(childEl) ?? 0;
              } else {
                position += childEl.textContent?.length || 0;
              }
            }
          }
          found = true;
          return true;
        }
        for (const child of Array.from(node.childNodes)) {
          if (walk(child)) return true;
        }
      }
    }
    return false;
  };

  for (const child of Array.from(element.childNodes)) {
    if (walk(child)) break;
  }

  return position;
}

/**
 * Set the cursor at a virtual character offset in a contenteditable element.
 *
 * Walks the DOM tree, counting virtual positions (file tags = "@" + filepath length),
 * and places the cursor at the correct DOM node/offset corresponding to the virtual offset.
 *
 * @param element - The contenteditable element
 * @param virtualOffset - The target virtual character offset
 * @returns true if cursor was set successfully
 */
export function setVirtualCursorPosition(
  element: HTMLElement,
  virtualOffset: number
): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  let position = 0;
  let targetNode: Node | null = null;
  let targetOffset = 0;
  let endsWithNewline = false;

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const len = text.length;
      if (position + len >= virtualOffset) {
        targetNode = node;
        targetOffset = virtualOffset - position;
        return true;
      }
      position += len;
      endsWithNewline = textEndsWithNewline(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      if (tagName === 'br') {
        // A <br> that is the last child of a line <div> is the placeholder of
        // an empty line. The offset after its newline is the start of the
        // next line, so continue to the next node.
        const isLinePlaceholder =
          el.nextSibling === null &&
          el.parentElement !== null &&
          el.parentElement !== element &&
          isBlockLine(el.parentElement);
        if (
          position + 1 > virtualOffset ||
          (position + 1 === virtualOffset && !isLinePlaceholder)
        ) {
          targetNode = el;
          targetOffset = 0;
          return true;
        }
        position += 1;
        endsWithNewline = true;
        return false;
      }

      if (tagName === 'div' || tagName === 'p') {
        if (position > 0 && !endsWithNewline) {
          if (position + 1 >= virtualOffset) {
            // The offset is the start of this line
            targetNode = el;
            targetOffset = LINE_START;
            return true;
          }
          position += 1;
          endsWithNewline = true;
        }

        for (const child of Array.from(el.childNodes)) {
          if (walk(child)) return true;
        }
        return false;
      }

      const atomicTagLength = getAtomicTagTextLength(el);
      if (atomicTagLength !== null) {
        const tagLength = atomicTagLength;

        if (position + tagLength >= virtualOffset) {
          // Target is inside file tag; place cursor after the tag
          targetNode = el;
          targetOffset = -1; // sentinel: means "after this element"
          return true;
        }
        position += tagLength;
        endsWithNewline = false;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (walk(child)) return true;
        }
      }
    }
    return false;
  };

  for (const child of Array.from(element.childNodes)) {
    if (walk(child)) break;
  }

  if (!targetNode) {
    // Offset beyond content: place cursor at end
    if (element.lastChild) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    return false;
  }

  try {
    const range = document.createRange();
    const node: Node = targetNode;

    if (targetOffset === -1) {
      // Sentinel: place cursor after this element (file tag)
      range.setStartAfter(node);
      range.collapse(true);
    } else if (targetOffset === LINE_START) {
      // Sentinel: place cursor at the start of this line element. Go into
      // nested line elements (a code fence block holds line <div>s).
      let lineNode: Node = node;
      let firstLine = getFirstLineChild(lineNode);
      while (firstLine) {
        lineNode = firstLine;
        firstLine = getFirstLineChild(lineNode);
      }
      range.setStart(lineNode, 0);
      range.collapse(true);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const maxOffset = textNode.textContent?.length ?? 0;
      range.setStart(textNode, Math.min(targetOffset, maxOffset));
      range.collapse(true);
    } else {
      // Element node (br, div, etc.)
      range.selectNodeContents(node as HTMLElement);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}
