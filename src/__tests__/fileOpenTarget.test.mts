import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';

import { parseFileOpenTarget, resolveFileOpenPath } from '../bridge/handlers/fileOpenTarget.ts';

describe('parseFileOpenTarget', () => {
  it('keeps bare relative paths', () => {
    assert.deepEqual(parseFileOpenTarget('CERTIFICATE_BACKEND_PRD.md'), { path: 'CERTIFICATE_BACKEND_PRD.md' });
    assert.deepEqual(parseFileOpenTarget('./docs/x.md'), { path: './docs/x.md' });
    assert.deepEqual(parseFileOpenTarget('../x.md'), { path: '../x.md' });
  });

  it('strips surrounding whitespace and quotes', () => {
    assert.deepEqual(parseFileOpenTarget('  "docs/x.md"  '), { path: 'docs/x.md' });
    assert.deepEqual(parseFileOpenTarget("'docs/x.md:3'"), { path: 'docs/x.md', line: 3 });
  });

  it('strips the vscode-webview origin prefix', () => {
    assert.deepEqual(
      parseFileOpenTarget('vscode-webview://11ofo0elqcb0eu1mhr9lmq1cm1fl643rgll4t68942h3g7hrh28h/CERTIFICATE_BACKEND_PRD.md'),
      { path: 'CERTIFICATE_BACKEND_PRD.md' },
    );
  });

  it('percent-decodes vscode-webview paths', () => {
    assert.deepEqual(parseFileOpenTarget('vscode-webview://abc/docs/My%20File.md'), { path: 'docs/My File.md' });
    assert.deepEqual(parseFileOpenTarget('vscode-webview://abc/docs/x.md#L4'), { path: 'docs/x.md', line: 4 });
  });

  it('converts file:// URIs to filesystem paths', () => {
    assert.deepEqual(parseFileOpenTarget('file:///Users/me/a.ts'), { path: '/Users/me/a.ts' });
    assert.deepEqual(parseFileOpenTarget('file:///Users/me/My%20File.ts#L9'), { path: '/Users/me/My File.ts', line: 9 });
  });

  it('parses :line and :line-line suffixes', () => {
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts:12'), { path: '/abs/path.ts', line: 12 });
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts:12-20'), { path: '/abs/path.ts', line: 12 });
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts:12:5'), { path: '/abs/path.ts', line: 12 });
  });

  it('parses #L line anchors', () => {
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts#L12'), { path: '/abs/path.ts', line: 12 });
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts#L10-20'), { path: '/abs/path.ts', line: 10 });
    assert.deepEqual(parseFileOpenTarget('/abs/path.ts#L10-L20'), { path: '/abs/path.ts', line: 10 });
  });

  it('does not break Windows drive letters', () => {
    assert.deepEqual(parseFileOpenTarget('C:\\proj\\a.ts:7'), { path: 'C:\\proj\\a.ts', line: 7 });
    assert.deepEqual(parseFileOpenTarget('C:\\proj\\a.ts'), { path: 'C:\\proj\\a.ts' });
    assert.deepEqual(parseFileOpenTarget('D:/proj/a.ts#L3'), { path: 'D:/proj/a.ts', line: 3 });
  });

  it('expands ~/ to the home directory', () => {
    assert.deepEqual(parseFileOpenTarget('~/notes/a.md'), { path: path.join(os.homedir(), 'notes/a.md') });
  });
});

describe('resolveFileOpenPath', () => {
  const never = () => false;

  it('returns absolute paths unchanged', () => {
    assert.equal(resolveFileOpenPath('/abs/path.ts', ['/root'], never), '/abs/path.ts');
    assert.equal(resolveFileOpenPath('C:\\proj\\a.ts', ['/root'], never), 'C:\\proj\\a.ts');
    assert.equal(resolveFileOpenPath('\\\\server\\share\\a.ts', ['/root'], never), '\\\\server\\share\\a.ts');
  });

  it('picks the first root where the file exists', () => {
    const existing = new Set([path.join('/second', 'CERTIFICATE_BACKEND_PRD.md'), path.join('/third', 'CERTIFICATE_BACKEND_PRD.md')]);
    const exists = (p: string) => existing.has(p);
    assert.equal(
      resolveFileOpenPath('CERTIFICATE_BACKEND_PRD.md', ['/first', '/second', '/third'], exists),
      path.join('/second', 'CERTIFICATE_BACKEND_PRD.md'),
    );
  });

  it('normalizes ./ and ../ segments against the root', () => {
    const exists = (p: string) => p === path.join('/root', 'docs', 'x.md') || p === path.join('/x.md');
    assert.equal(resolveFileOpenPath('./docs/x.md', ['/root'], exists), path.join('/root', 'docs', 'x.md'));
    assert.equal(resolveFileOpenPath('../x.md', ['/root'], exists), path.join('/x.md'));
  });

  it('falls back to the first non-empty root when nothing exists', () => {
    assert.equal(
      resolveFileOpenPath('CERTIFICATE_BACKEND_PRD.md', ['', undefined, '/first', '/second'], never),
      path.join('/first', 'CERTIFICATE_BACKEND_PRD.md'),
    );
  });

  it('returns the raw path when there are no roots', () => {
    assert.equal(resolveFileOpenPath('CERTIFICATE_BACKEND_PRD.md', [], never), 'CERTIFICATE_BACKEND_PRD.md');
  });
});
