/**
 * Pure helpers for the "Start Remote Control" command.
 * This file has no `vscode` import, so node:test can load it directly.
 */

export const RECENT_FOLDERS_KEY = 'ccg.remoteControl.recentFolders';
export const WORKING_DIRECTORY_KEY = 'ccg.working_directory';
export const MAX_RECENT_FOLDERS = 8;
export const DEFAULT_CLAUDE_PATH = 'claude';

export interface RemoteControlCommandOptions {
  claudePath?: string;
  sessionName: string;
  keepAwake: boolean;
  platform: string;
  extraArgs?: string;
}

export type FolderCandidateSource = 'workspace' | 'workingDirectory' | 'recent';

export interface FolderCandidate {
  path: string;
  source: FolderCandidateSource;
}

export interface FolderCandidateInput {
  workspaceFolders: readonly string[];
  workingDirectory?: string;
  recentFolders?: readonly string[];
  /** Returns true when the folder exists. Workspace folders are not checked. */
  exists: (folder: string) => boolean;
  maxRecent?: number;
}

/** Quote a value for a POSIX shell with single quotes. */
export function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a value for cmd.exe / PowerShell with double quotes. */
export function quoteWindowsArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteArg(value: string, platform: string): string {
  return platform === 'win32' ? quoteWindowsArg(value) : quotePosixArg(value);
}

/** Quote the executable path only when it contains characters that the shell would split or expand. */
function formatExecutable(claudePath: string, platform: string): string {
  if (platform === 'win32') {
    return /\s/.test(claudePath) ? quoteWindowsArg(claudePath) : claudePath;
  }
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(claudePath) ? claudePath : quotePosixArg(claudePath);
}

/** Build the exact shell command that starts a Remote Control session. */
export function buildRemoteControlCommand(options: RemoteControlCommandOptions): string {
  const claudePath = options.claudePath?.trim() || DEFAULT_CLAUDE_PATH;
  const parts = [
    formatExecutable(claudePath, options.platform),
    // The `remote-control` subcommand starts the persistent server (spawn
    // mode). The Claude phone app lists it as a device and can start new
    // sessions in the folder. The older `--remote-control` flag only
    // registers one interactive session, which the phone does not list.
    'remote-control',
    '--name',
    quoteArg(options.sessionName, options.platform),
    '--spawn',
    'same-dir',
  ];
  const extraArgs = options.extraArgs?.trim();
  if (extraArgs) {
    parts.push(extraArgs);
  }
  const command = parts.join(' ');
  if (options.keepAwake && options.platform === 'darwin') {
    return `caffeinate -i ${command}`;
  }
  return command;
}

/** Return an error message for an invalid session name, or undefined when the name is valid. */
export function validateSessionName(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return 'Session name cannot be empty.';
  }
  if (/["'`]/.test(value)) {
    return 'Session name cannot contain quotes.';
  }
  if (/[\r\n]/.test(value)) {
    return 'Session name cannot contain line breaks.';
  }
  return undefined;
}

/** Remove trailing path separators, but keep a root path ("/" or "C:\") as it is. */
export function normalizeFolderPath(folder: string): string {
  const trimmed = folder.trim();
  const stripped = trimmed.replace(/[\\/]+$/, '');
  if (stripped === '' || /^[A-Za-z]:$/.test(stripped)) {
    return trimmed;
  }
  return stripped;
}

/** Last path segment of a folder; the full path when there is no segment (for example "/"). */
export function folderBasename(folder: string): string {
  const normalized = normalizeFolderPath(folder);
  const segments = normalized.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
}

export function defaultSessionName(folder: string): string {
  return folderBasename(folder);
}

/** Put the folder at the front of the recent list, without duplicates, limited to `max` items. */
export function updateRecentFolders(
  recent: readonly string[] | undefined,
  folder: string,
  max: number = MAX_RECENT_FOLDERS
): string[] {
  const target = normalizeFolderPath(folder);
  const rest = (recent ?? [])
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map(normalizeFolderPath)
    .filter((item) => item !== target);
  return [target, ...Array.from(new Set(rest))].slice(0, Math.max(0, max));
}

/**
 * Candidate folders for the picker, in this order and without duplicates:
 * workspace folders, the effective working directory, then recent folders.
 */
export function buildFolderCandidates(input: FolderCandidateInput): FolderCandidate[] {
  const seen = new Set<string>();
  const result: FolderCandidate[] = [];
  const add = (folder: string | undefined, source: FolderCandidateSource): boolean => {
    if (typeof folder !== 'string' || folder.trim().length === 0) return false;
    const normalized = normalizeFolderPath(folder);
    if (seen.has(normalized)) return false;
    if (source !== 'workspace' && !input.exists(normalized)) return false;
    seen.add(normalized);
    result.push({ path: normalized, source });
    return true;
  };

  for (const folder of input.workspaceFolders) {
    add(folder, 'workspace');
  }
  add(input.workingDirectory, 'workingDirectory');

  const maxRecent = input.maxRecent ?? MAX_RECENT_FOLDERS;
  let recentCount = 0;
  for (const folder of input.recentFolders ?? []) {
    if (recentCount >= maxRecent) break;
    if (add(folder, 'recent')) recentCount += 1;
  }
  return result;
}
