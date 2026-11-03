import { describe, expect, it } from 'vitest';
import { formatQuote } from './quoteFormat';

describe('formatQuote', () => {
  it('quotes a single line', () => {
    expect(formatQuote('hello world')).toBe('> hello world\n\n');
  });

  it('quotes every line of a multi-line selection', () => {
    expect(formatQuote('first\nsecond\nthird')).toBe('> first\n> second\n> third\n\n');
  });

  it('turns blank lines into a bare ">"', () => {
    expect(formatQuote('line one\n\nline two')).toBe('> line one\n>\n> line two\n\n');
  });

  it('collapses runs of blank lines to a single blank line', () => {
    expect(formatQuote('a\n\n\n\nb')).toBe('> a\n>\n> b\n\n');
    expect(formatQuote('a\n  \n\t\n\nb')).toBe('> a\n>\n> b\n\n');
  });

  it('normalises CRLF line endings', () => {
    expect(formatQuote('one\r\ntwo\r\n\r\nthree')).toBe('> one\n> two\n>\n> three\n\n');
  });

  it('removes surrounding blank lines and whitespace', () => {
    expect(formatQuote('\n\n   hello  \n \n')).toBe('> hello\n\n');
  });

  it('keeps relative indentation while removing the shared indentation', () => {
    expect(formatQuote('    if (x) {\n      y();\n    }')).toBe('> if (x) {\n>   y();\n> }\n\n');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(formatQuote('')).toBe('');
    expect(formatQuote('  \n\r\n\t ')).toBe('');
  });
});
