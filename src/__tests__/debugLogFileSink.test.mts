import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { FileLogSink } from '../debugLogFileSink.ts';
import { createDebugGatedOutputChannel } from '../debugOutputChannel.ts';

const FIXED = new Date('2026-11-03T16:40:12.345Z');
const TS = '2026-11-03T16:40:12.345Z';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-sink-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fakeChannelFactory() {
  const lines: string[] = [];
  const create = (name: string): any => ({
    name,
    append: (v: string) => lines.push(v),
    appendLine: (v: string) => lines.push(`${v}\n`),
    replace: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  });
  return { create, lines };
}

describe('FileLogSink', () => {
  it('writes lines with an ISO timestamp prefix', () => {
    const filePath = path.join(tmp, 'ccgui-debug.log');
    const sink = new FileLogSink({ filePath, now: () => FIXED });
    sink.write('[D] first');
    sink.write('[ERR] second');
    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      `${TS} [D] first\n${TS} [ERR] second\n`,
    );
  });

  it('writes append chunks as-is and prefixes only at line start', () => {
    const filePath = path.join(tmp, 'ccgui-debug.log');
    const sink = new FileLogSink({ filePath, now: () => FIXED });
    sink.append('abc');
    sink.append('def\n');
    sink.append('ghi');
    sink.write('jkl');
    sink.write('mno');
    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      `${TS} abcdef\n${TS} ghijkl\n${TS} mno\n`,
    );
  });

  it('creates a missing parent directory', () => {
    const filePath = path.join(tmp, 'a', 'b', 'c', 'ccgui-debug.log');
    const sink = new FileLogSink({ filePath, now: () => FIXED });
    sink.write('hello');
    assert.equal(fs.readFileSync(filePath, 'utf8'), `${TS} hello\n`);
  });

  it('rotates to .1 when the file is over maxBytes', () => {
    const filePath = path.join(tmp, 'ccgui-debug.log');
    fs.writeFileSync(filePath, 'x'.repeat(100));
    fs.writeFileSync(`${filePath}.1`, 'old rotated content');
    const sink = new FileLogSink({ filePath, maxBytes: 50, sizeCheckInterval: 3, now: () => FIXED });

    // The first write checks the size: the 100-byte file is rotated.
    sink.write('one');
    assert.equal(fs.readFileSync(`${filePath}.1`, 'utf8'), 'x'.repeat(100));
    assert.equal(fs.readFileSync(filePath, 'utf8'), `${TS} one\n`);

    // Writes 2 and 3 do not check the size; write 4 does.
    sink.write('two');
    sink.write('three');
    const beforeCheck = fs.readFileSync(filePath, 'utf8');
    assert.ok(beforeCheck.length > 50);
    sink.write('four');
    assert.equal(fs.readFileSync(`${filePath}.1`, 'utf8'), beforeCheck);
    assert.equal(fs.readFileSync(filePath, 'utf8'), `${TS} four\n`);
  });

  it('does not rotate when the file is under maxBytes', () => {
    const filePath = path.join(tmp, 'ccgui-debug.log');
    const sink = new FileLogSink({ filePath, maxBytes: 10_000, sizeCheckInterval: 1, now: () => FIXED });
    for (let i = 0; i < 5; i++) sink.write(`line ${i}`);
    assert.equal(fs.existsSync(`${filePath}.1`), false);
    assert.equal(fs.readFileSync(filePath, 'utf8').split('\n').length, 6);
  });

  it('does not throw when the directory is not writable (path under a file)', () => {
    const blocker = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(blocker, 'file');
    const sink = new FileLogSink({ filePath: path.join(blocker, 'sub', 'ccgui-debug.log') });
    assert.doesNotThrow(() => {
      sink.write('dropped');
      sink.append('dropped too');
      sink.write('dropped again');
    });
  });
});

describe('createDebugGatedOutputChannel fileSink', () => {
  it('mirrors gated writes only when enabled and force writes always', () => {
    const filePath = path.join(tmp, 'logs', 'ccgui-debug.log');
    const { create, lines } = fakeChannelFactory();
    let enabled = false;
    const gated = createDebugGatedOutputChannel('CC GUI', () => enabled, create, { filePath });

    gated.log.appendLine('[D] hidden');
    gated.forceAppendLine('[BRIDGE] forced');
    enabled = true;
    gated.log.appendLine('[D] shown');
    gated.log.append('partial');
    gated.forceAppend(' end\n');

    assert.deepEqual(lines, ['[BRIDGE] forced\n', '[D] shown\n', 'partial', ' end\n']);
    const fileLines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
    assert.equal(fileLines.length, 3);
    assert.match(fileLines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[BRIDGE\] forced$/);
    assert.match(fileLines[1], /Z \[D\] shown$/);
    assert.match(fileLines[2], /Z partial end$/);
  });

  it('writes no file without a fileSink', () => {
    const { create } = fakeChannelFactory();
    const gated = createDebugGatedOutputChannel('CC GUI', () => true, create);
    gated.log.appendLine('x');
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
});
