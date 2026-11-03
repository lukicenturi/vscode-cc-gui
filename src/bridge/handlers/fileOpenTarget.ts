import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Pure helpers (no `vscode` import) for turning an `open_file` bridge payload
 * into an absolute file path + optional line number.
 */

export interface FileOpenTarget {
  path: string;
  line?: number;
}

const WEBVIEW_PREFIX_RE = /^vscode-webview:\/\/[^/?#]*\/?/i;
const FILE_URI_RE = /^file:/i;
const HASH_LINE_RE = /#L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/i;
// `:12`, `:12-20`, `:12:5`. Only trailing digits, so Windows drive letters
// (`C:\foo`) are never mistaken for a line suffix.
const COLON_LINE_RE = /:(\d+)(?:[-:]\d+)?$/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\/;

function safeDecode(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function stripWrapping(value: string): string {
  let current = value.trim();
  for (;;) {
    const first = current.charAt(0);
    const last = current.charAt(current.length - 1);
    const pairs: Record<string, string> = { '"': '"', "'": "'", '`': '`', '<': '>' };
    if (current.length >= 2 && pairs[first] === last) {
      current = current.slice(1, -1).trim();
      continue;
    }
    return current;
  }
}

function fileUriToPath(uri: string): string {
  try {
    const fsPath = fileURLToPath(uri);
    // `file:///C:/foo` on posix yields `/C:/foo`; drop the leading slash.
    if (/^\/[A-Za-z]:[\\/]/.test(fsPath)) return fsPath.slice(1);
    return fsPath;
  } catch {
    const stripped = safeDecode(uri.replace(/^file:(\/\/[^/]*)?/i, ''));
    return /^\/[A-Za-z]:[\\/]/.test(stripped) ? stripped.slice(1) : stripped;
  }
}

export function parseFileOpenTarget(raw: string): FileOpenTarget {
  let value = stripWrapping(String(raw ?? ''));
  let line: number | undefined;

  const takeLine = (match: RegExpMatchArray | null): void => {
    if (!match) return;
    const parsed = Number(match[1]);
    if (line === undefined && Number.isFinite(parsed) && parsed > 0) line = parsed;
    value = value.slice(0, match.index);
  };

  if (WEBVIEW_PREFIX_RE.test(value)) {
    value = value.replace(WEBVIEW_PREFIX_RE, '');
    // Webview origins have no meaningful query string for file navigation.
    const hashIndex = value.indexOf('#');
    const queryIndex = value.indexOf('?');
    if (queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex)) {
      value = value.slice(0, queryIndex) + (hashIndex >= 0 ? value.slice(hashIndex) : '');
    }
    takeLine(value.match(HASH_LINE_RE));
    value = safeDecode(value);
  } else if (FILE_URI_RE.test(value)) {
    takeLine(value.match(HASH_LINE_RE));
    value = fileUriToPath(value);
  } else {
    takeLine(value.match(HASH_LINE_RE));
  }

  takeLine(value.match(COLON_LINE_RE));
  value = value.trim();

  if (value === '~') {
    value = os.homedir();
  } else if (/^~[\\/]/.test(value)) {
    value = path.join(os.homedir(), value.slice(2));
  }

  return line === undefined ? { path: value } : { path: value, line };
}

export function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_DRIVE_RE.test(value) || UNC_RE.test(value) || path.isAbsolute(value);
}

function joinRoot(root: string, target: string): string {
  return WINDOWS_DRIVE_RE.test(root) || UNC_RE.test(root)
    ? path.win32.join(root, target)
    : path.join(root, target);
}

export function resolveFileOpenPath(
  targetPath: string,
  candidateRoots: Array<string | null | undefined>,
  exists: (p: string) => boolean,
): string {
  if (!targetPath || isAbsoluteFilePath(targetPath)) return targetPath;

  const roots: string[] = [];
  for (const root of candidateRoots) {
    const trimmed = String(root ?? '').trim();
    if (trimmed && !roots.includes(trimmed)) roots.push(trimmed);
  }

  for (const root of roots) {
    const candidate = joinRoot(root, targetPath);
    if (exists(candidate)) return candidate;
  }

  return roots.length > 0 ? joinRoot(roots[0], targetPath) : targetPath;
}
