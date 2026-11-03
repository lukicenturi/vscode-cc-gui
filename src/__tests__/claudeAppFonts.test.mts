import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectClaudeAppFontPresets,
  getClaudeAppFontDirs,
} from '../bridge/services/claudeAppFonts.ts';

const MAC_FONTS = '/Applications/Claude.app/Contents/Resources/fonts';

/** A fake file system: a map of directory -> entry names. */
function fakeFs(tree: Record<string, string[]>) {
  const files = new Set<string>();
  for (const [dir, names] of Object.entries(tree)) {
    files.add(dir);
    for (const name of names) {
      files.add(dir.includes('\\') ? `${dir}\\${name}` : `${dir}/${name}`);
    }
  }
  return {
    exists: (p: string) => files.has(p),
    readDir: (p: string) => {
      if (!(p in tree)) throw new Error(`ENOENT: ${p}`);
      return tree[p];
    },
  };
}

describe('detectClaudeAppFontPresets', () => {
  it('finds Sans and Serif in the macOS app', () => {
    const fs = fakeFs({
      [MAC_FONTS]: [
        'AnthropicSans-Italics-Variable-25x258.ttf',
        'AnthropicSans-Romans-Variable-25x258.ttf',
        'AnthropicSerif-Italics-Variable-25x258.ttf',
        'AnthropicSerif-Romans-Variable-25x258.ttf',
      ],
    });

    const presets = detectClaudeAppFontPresets({ platform: 'darwin', ...fs, env: {} });

    assert.deepEqual(presets, [
      {
        id: 'claudeSans',
        label: 'Claude app (Anthropic Sans)',
        path: `${MAC_FONTS}/AnthropicSans-Romans-Variable-25x258.ttf`,
      },
      {
        id: 'claudeSerif',
        label: 'Claude app (Anthropic Serif)',
        path: `${MAC_FONTS}/AnthropicSerif-Romans-Variable-25x258.ttf`,
      },
    ]);
  });

  it('accepts a different version part in the file name', () => {
    const fs = fakeFs({ [MAC_FONTS]: ['AnthropicSans-Romans-Variable-30x300.ttf'] });

    const presets = detectClaudeAppFontPresets({ platform: 'darwin', ...fs, env: {} });

    assert.equal(presets.length, 1);
    assert.equal(presets[0].id, 'claudeSans');
    assert.equal(presets[0].path, `${MAC_FONTS}/AnthropicSans-Romans-Variable-30x300.ttf`);
  });

  it('uses the known file name when the directory cannot be listed', () => {
    const known = `${MAC_FONTS}/AnthropicSerif-Romans-Variable-25x258.ttf`;
    const exists = (p: string) => p === MAC_FONTS || p === known;

    const presets = detectClaudeAppFontPresets({ platform: 'darwin', exists, env: {} });

    assert.deepEqual(presets.map((preset) => preset.id), ['claudeSerif']);
    assert.equal(presets[0].path, known);
  });

  it('looks in ~/Applications on macOS', () => {
    const userFonts = '/Users/me/Applications/Claude.app/Contents/Resources/fonts';
    const fs = fakeFs({ [userFonts]: ['AnthropicSans-Romans-Variable-25x258.ttf'] });

    const presets = detectClaudeAppFontPresets({
      platform: 'darwin',
      ...fs,
      env: { HOME: '/Users/me' },
    });

    assert.equal(presets[0]?.path, `${userFonts}/AnthropicSans-Romans-Variable-25x258.ttf`);
  });

  it('returns no presets when the app is not installed', () => {
    const fs = fakeFs({});
    assert.deepEqual(detectClaudeAppFontPresets({ platform: 'darwin', ...fs, env: {} }), []);
    assert.deepEqual(detectClaudeAppFontPresets({ platform: 'linux', ...fs, env: {} }), []);
  });

  it('uses the newest app folder on Windows', () => {
    const root = 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude';
    const fs = fakeFs({
      [root]: ['app-0.9.2', 'app-0.10.1', 'packages', 'Update.exe'],
      [`${root}\\app-0.9.2\\resources\\fonts`]: ['AnthropicSans-Romans-Variable-25x258.ttf'],
      [`${root}\\app-0.10.1\\resources\\fonts`]: ['AnthropicSans-Romans-Variable-25x258.ttf'],
    });

    const presets = detectClaudeAppFontPresets({
      platform: 'win32',
      ...fs,
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
    });

    assert.deepEqual(presets, [
      {
        id: 'claudeSans',
        label: 'Claude app (Anthropic Sans)',
        path: `${root}\\app-0.10.1\\resources\\fonts\\AnthropicSans-Romans-Variable-25x258.ttf`,
      },
    ]);
  });

  it('ignores files that are not .ttf', () => {
    const fs = fakeFs({ [MAC_FONTS]: ['AnthropicSans-Romans-Variable-25x258.woff2'] });
    assert.deepEqual(detectClaudeAppFontPresets({ platform: 'darwin', ...fs, env: {} }), []);
  });
});

describe('getClaudeAppFontDirs', () => {
  it('gives no Windows folders without LOCALAPPDATA or USERPROFILE', () => {
    const dirs = getClaudeAppFontDirs({ platform: 'win32', exists: () => true, env: {} });
    assert.deepEqual(dirs, []);
  });
});
