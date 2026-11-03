import * as path from 'path';

/**
 * Font presets from the local Claude desktop app.
 *
 * The Claude desktop app ships its UI fonts as variable TTF files:
 * - macOS: /Applications/Claude.app/Contents/Resources/fonts/
 * - Windows: %LOCALAPPDATA%\AnthropicClaude\app-<version>\resources\fonts\
 *
 * The file names have a version part, for example
 * AnthropicSans-Romans-Variable-25x258.ttf. Thus the detection looks for a
 * prefix and the .ttf extension.
 */

export type ClaudeAppFontPresetId = 'claudeSans' | 'claudeSerif';

export interface ClaudeAppFontPreset {
  id: ClaudeAppFontPresetId;
  label: string;
  path: string;
}

export interface ClaudeAppFontDetectionOptions {
  platform: NodeJS.Platform;
  /** True when the file or directory exists */
  exists: (p: string) => boolean;
  /** The entry names of a directory. When not given, only known file names are tried. */
  readDir?: (p: string) => string[];
  /** Environment variables (HOME, LOCALAPPDATA) */
  env?: Record<string, string | undefined>;
}

interface PresetSpec {
  id: ClaudeAppFontPresetId;
  label: string;
  /** File name prefix (before the version part) */
  prefix: string;
  /** File name of a known release, used when the directory cannot be listed */
  knownFile: string;
}

const PRESET_SPECS: readonly PresetSpec[] = [
  {
    id: 'claudeSans',
    label: 'Claude app (Anthropic Sans)',
    prefix: 'AnthropicSans-Romans-Variable',
    knownFile: 'AnthropicSans-Romans-Variable-25x258.ttf',
  },
  {
    id: 'claudeSerif',
    label: 'Claude app (Anthropic Serif)',
    prefix: 'AnthropicSerif-Romans-Variable',
    knownFile: 'AnthropicSerif-Romans-Variable-25x258.ttf',
  },
];

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Compare "app-1.2.3" directory names by version, newest first. */
function compareAppDirsNewestFirst(a: string, b: string): number {
  const parse = (name: string) =>
    name.replace(/^app-/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] ?? 0) - (va[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function safeReadDir(readDir: ClaudeAppFontDetectionOptions['readDir'], dir: string): string[] {
  if (!readDir) return [];
  try {
    return readDir(dir);
  } catch {
    return [];
  }
}

/** The font directories of the Claude desktop app to look in, in order. */
export function getClaudeAppFontDirs(options: ClaudeAppFontDetectionOptions): string[] {
  const { platform, exists, readDir, env = {} } = options;
  const p = pathApi(platform);

  if (platform === 'darwin') {
    const dirs = ['/Applications/Claude.app/Contents/Resources/fonts'];
    if (env.HOME) {
      dirs.push(p.join(env.HOME, 'Applications', 'Claude.app', 'Contents', 'Resources', 'fonts'));
    }
    return dirs;
  }

  if (platform === 'win32') {
    const localAppData =
      env.LOCALAPPDATA || (env.USERPROFILE ? p.join(env.USERPROFILE, 'AppData', 'Local') : '');
    if (!localAppData) return [];
    const root = p.join(localAppData, 'AnthropicClaude');
    if (!exists(root)) return [];
    return safeReadDir(readDir, root)
      .filter((name) => /^app-\d/.test(name))
      .sort(compareAppDirsNewestFirst)
      .map((name) => p.join(root, name, 'resources', 'fonts'));
  }

  return [];
}

/** The path of the preset font file in the directory, or null. */
function findPresetFile(
  spec: PresetSpec,
  dir: string,
  options: ClaudeAppFontDetectionOptions
): string | null {
  const p = pathApi(options.platform);
  const matches = safeReadDir(options.readDir, dir)
    .filter((name) => name.startsWith(spec.prefix) && name.toLowerCase().endsWith('.ttf'))
    .sort();
  // The last name in sort order is the newest version
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = p.join(dir, matches[i]);
    if (options.exists(candidate)) return candidate;
  }
  const known = p.join(dir, spec.knownFile);
  return options.exists(known) ? known : null;
}

/**
 * Find the Claude desktop app fonts that exist on this computer.
 * Returns one preset for each font that it finds (Sans first, then Serif).
 */
export function detectClaudeAppFontPresets(
  options: ClaudeAppFontDetectionOptions
): ClaudeAppFontPreset[] {
  const dirs = getClaudeAppFontDirs(options).filter((dir) => options.exists(dir));
  const presets: ClaudeAppFontPreset[] = [];
  for (const spec of PRESET_SPECS) {
    for (const dir of dirs) {
      const file = findPresetFile(spec, dir, options);
      if (file) {
        presets.push({ id: spec.id, label: spec.label, path: file });
        break;
      }
    }
  }
  return presets;
}
