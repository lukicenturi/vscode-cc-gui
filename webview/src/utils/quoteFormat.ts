/**
 * Format a text selection as a markdown block quote for the chat input.
 *
 * - Normalises CRLF / CR line endings to LF.
 * - Removes trailing whitespace on each line and drops leading/trailing blank lines.
 * - Removes the indentation that all non-empty lines share.
 * - Collapses runs of blank lines to a single blank line.
 * - Prefixes every line with "> " (blank lines become ">").
 * - Appends "\n\n" so the user can type below the quote.
 *
 * Returns '' when the selection contains no visible text.
 */
export function formatQuote(text: string): string {
  if (!text) return '';

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  if (start === end) return '';

  const body = lines.slice(start, end);

  const indents = body
    .filter((line) => line !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0] ?? '');
  let common = indents[0] ?? '';
  for (const indent of indents) {
    while (common && !indent.startsWith(common)) {
      common = common.slice(0, -1);
    }
  }

  const collapsed: string[] = [];
  for (const line of body) {
    const dedented = line.slice(common.length);
    if (dedented === '' && collapsed[collapsed.length - 1] === '') continue;
    collapsed.push(dedented);
  }

  return `${collapsed.map((line) => (line ? `> ${line}` : '>')).join('\n')}\n\n`;
}
