import * as fs from 'fs';
import * as path from 'path';

/** Default rotation limit: 20 MB. */
export const DEFAULT_DEBUG_LOG_MAX_BYTES = 20 * 1024 * 1024;
/** Check the file size at most once per this many writes. */
export const DEFAULT_SIZE_CHECK_INTERVAL = 200;

export interface FileLogSinkOptions {
  filePath: string;
  /** Rotate to `<filePath>.1` when the file is larger than this. Default 20 MB. */
  maxBytes?: number;
  /** Number of writes between size checks. Default 200. */
  sizeCheckInterval?: number;
  /** Clock for the timestamp prefix (tests). */
  now?: () => Date;
}

/**
 * Append debug log lines to a file on disk.
 *
 * - `write(line)` writes `<ISO timestamp> <line>\n` (same as `append(line + '\n')`).
 * - `append(chunk)` writes the chunk as-is (no newline is added). The
 *   timestamp prefix is added only when the previous write ended with a
 *   newline (that is, at the start of a line). Newlines inside a chunk do not
 *   get a timestamp.
 *
 * All writes are synchronous so the order is the same as the output channel.
 * Errors are dropped silently: logging must not break the extension.
 */
export class FileLogSink {
  readonly filePath: string;
  private readonly maxBytes: number;
  private readonly sizeCheckInterval: number;
  private readonly now: () => Date;
  private dirReady = false;
  private writesSinceSizeCheck: number;
  private atLineStart = true;

  constructor(options: FileLogSinkOptions) {
    this.filePath = options.filePath;
    this.maxBytes =
      typeof options.maxBytes === 'number' && options.maxBytes > 0
        ? options.maxBytes
        : DEFAULT_DEBUG_LOG_MAX_BYTES;
    this.sizeCheckInterval =
      typeof options.sizeCheckInterval === 'number' && options.sizeCheckInterval > 0
        ? Math.floor(options.sizeCheckInterval)
        : DEFAULT_SIZE_CHECK_INTERVAL;
    this.now = options.now ?? (() => new Date());
    // Check the size on the first write (an old file can already be large).
    this.writesSinceSizeCheck = this.sizeCheckInterval;
  }

  write(line: string): void {
    // Same as the output channel: appendLine(x) is append(x + '\n').
    this.append(`${line}\n`);
  }

  append(chunk: string): void {
    if (!chunk) return;
    const text = this.atLineStart ? `${this.timestamp()} ${chunk}` : chunk;
    if (this.writeRaw(text)) {
      this.atLineStart = chunk.endsWith('\n');
    }
  }

  private timestamp(): string {
    try {
      return this.now().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private writeRaw(text: string): boolean {
    try {
      if (!this.dirReady) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this.dirReady = true;
      }
      this.rotateIfNeeded();
      fs.appendFileSync(this.filePath, text, 'utf8');
      return true;
    } catch {
      // Drop the write. Try to create the directory again on the next write.
      this.dirReady = false;
      return false;
    }
  }

  private rotateIfNeeded(): void {
    this.writesSinceSizeCheck += 1;
    if (this.writesSinceSizeCheck < this.sizeCheckInterval) return;
    this.writesSinceSizeCheck = 0;
    let size: number;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      return; // no file yet
    }
    if (size <= this.maxBytes) return;
    const rotated = `${this.filePath}.1`;
    try {
      fs.rmSync(rotated, { force: true });
    } catch {
      // ignore; renameSync replaces the file on most platforms
    }
    fs.renameSync(this.filePath, rotated);
  }
}
