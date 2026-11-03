import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECENT_FOLDERS,
  buildFolderCandidates,
  buildRemoteControlCommand,
  defaultSessionName,
  folderBasename,
  updateRecentFolders,
  validateSessionName,
} from '../remoteControlHelpers.ts';

describe('buildRemoteControlCommand', () => {
  it('wraps the command in caffeinate on macOS when keepAwake is on', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'My Project', keepAwake: true, platform: 'darwin' }),
      "caffeinate -i claude --remote-control 'My Project'"
    );
  });

  it('does not use caffeinate on macOS when keepAwake is off', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'My Project', keepAwake: false, platform: 'darwin' }),
      "claude --remote-control 'My Project'"
    );
  });

  it('ignores keepAwake on Linux and Windows', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'app', keepAwake: true, platform: 'linux' }),
      "claude --remote-control 'app'"
    );
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'My App', keepAwake: true, platform: 'win32' }),
      'claude --remote-control "My App"'
    );
  });

  it('escapes a single quote in the session name on POSIX', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: "Bob's repo", keepAwake: false, platform: 'linux' }),
      "claude --remote-control 'Bob'\\''s repo'"
    );
  });

  it('keeps shell metacharacters literal inside single quotes', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'a $(rm -rf) `x` ; b', keepAwake: false, platform: 'darwin' }),
      "claude --remote-control 'a $(rm -rf) `x` ; b'"
    );
  });

  it('appends extraArgs verbatim after the session name', () => {
    assert.equal(
      buildRemoteControlCommand({
        sessionName: 'web',
        keepAwake: true,
        platform: 'darwin',
        extraArgs: '  --permission-mode acceptEdits ',
      }),
      "caffeinate -i claude --remote-control 'web' --permission-mode acceptEdits"
    );
  });

  it('ignores empty extraArgs', () => {
    assert.equal(
      buildRemoteControlCommand({ sessionName: 'web', keepAwake: false, platform: 'linux', extraArgs: '   ' }),
      "claude --remote-control 'web'"
    );
  });

  it('uses a custom claudePath and quotes it when it contains spaces', () => {
    assert.equal(
      buildRemoteControlCommand({
        claudePath: '/opt/homebrew/bin/claude',
        sessionName: 'web',
        keepAwake: false,
        platform: 'darwin',
      }),
      "/opt/homebrew/bin/claude --remote-control 'web'"
    );
    assert.equal(
      buildRemoteControlCommand({
        claudePath: '/Users/x/My Tools/claude',
        sessionName: 'web',
        keepAwake: false,
        platform: 'linux',
      }),
      "'/Users/x/My Tools/claude' --remote-control 'web'"
    );
    assert.equal(
      buildRemoteControlCommand({
        claudePath: 'C:\\Program Files\\claude\\claude.exe',
        sessionName: 'web',
        keepAwake: false,
        platform: 'win32',
      }),
      '"C:\\Program Files\\claude\\claude.exe" --remote-control "web"'
    );
  });

  it('falls back to "claude" when claudePath is empty', () => {
    assert.equal(
      buildRemoteControlCommand({ claudePath: '  ', sessionName: 'web', keepAwake: false, platform: 'linux' }),
      "claude --remote-control 'web'"
    );
  });
});

describe('validateSessionName', () => {
  it('accepts a normal name', () => {
    assert.equal(validateSessionName('My Project'), undefined);
    assert.equal(validateSessionName('api-v2 (staging)'), undefined);
  });

  it('rejects an empty or blank name', () => {
    assert.ok(validateSessionName(''));
    assert.ok(validateSessionName('   '));
  });

  it('rejects quotes', () => {
    assert.ok(validateSessionName("Bob's"));
    assert.ok(validateSessionName('say "hi"'));
    assert.ok(validateSessionName('a`b'));
  });

  it('rejects line breaks', () => {
    assert.ok(validateSessionName('a\nb'));
    assert.ok(validateSessionName('a\r\nb'));
  });
});

describe('folderBasename / defaultSessionName', () => {
  it('returns the last path segment', () => {
    assert.equal(folderBasename('/Users/x/My Project'), 'My Project');
    assert.equal(folderBasename('/Users/x/My Project/'), 'My Project');
    assert.equal(folderBasename('C:\\work\\api'), 'api');
    assert.equal(defaultSessionName('/Users/x/web'), 'web');
  });

  it('returns the root path when there is no segment', () => {
    assert.equal(folderBasename('/'), '/');
  });
});

describe('updateRecentFolders', () => {
  it('inserts a new folder at the front', () => {
    assert.deepEqual(updateRecentFolders(['/a', '/b'], '/c'), ['/c', '/a', '/b']);
  });

  it('moves an existing folder to the front without a duplicate', () => {
    assert.deepEqual(updateRecentFolders(['/a', '/b', '/c'], '/b'), ['/b', '/a', '/c']);
    assert.deepEqual(updateRecentFolders(['/a', '/b/'], '/b'), ['/b', '/a']);
  });

  it('keeps at most 8 folders', () => {
    const recent = Array.from({ length: 10 }, (_, i) => `/f${i}`);
    const result = updateRecentFolders(recent, '/new');
    assert.equal(result.length, MAX_RECENT_FOLDERS);
    assert.equal(result[0], '/new');
    assert.deepEqual(result.slice(1), recent.slice(0, 7));
  });

  it('handles an undefined list and removes duplicates already in storage', () => {
    assert.deepEqual(updateRecentFolders(undefined, '/a'), ['/a']);
    assert.deepEqual(updateRecentFolders(['/b', '/b', '/c'], '/a'), ['/a', '/b', '/c']);
  });
});

describe('buildFolderCandidates', () => {
  const existing = new Set(['/ws1', '/ws2', '/wd', '/r1', '/r2', '/r3']);
  const exists = (folder: string) => existing.has(folder);

  it('orders workspace folders, then the working directory, then recent folders', () => {
    const result = buildFolderCandidates({
      workspaceFolders: ['/ws1', '/ws2'],
      workingDirectory: '/wd',
      recentFolders: ['/r1', '/r2'],
      exists,
    });
    assert.deepEqual(result, [
      { path: '/ws1', source: 'workspace' },
      { path: '/ws2', source: 'workspace' },
      { path: '/wd', source: 'workingDirectory' },
      { path: '/r1', source: 'recent' },
      { path: '/r2', source: 'recent' },
    ]);
  });

  it('removes duplicates and keeps the first occurrence', () => {
    const result = buildFolderCandidates({
      workspaceFolders: ['/ws1'],
      workingDirectory: '/ws1/',
      recentFolders: ['/r1', '/ws1', '/r1', '/wd'],
      exists,
    });
    assert.deepEqual(result.map((c) => c.path), ['/ws1', '/r1', '/wd']);
    assert.equal(result[2].source, 'recent');
  });

  it('skips a working directory or recent folder that does not exist', () => {
    const result = buildFolderCandidates({
      workspaceFolders: [],
      workingDirectory: '/gone',
      recentFolders: ['/missing', '/r3'],
      exists,
    });
    assert.deepEqual(result, [{ path: '/r3', source: 'recent' }]);
  });

  it('skips an empty working directory', () => {
    const result = buildFolderCandidates({ workspaceFolders: ['/ws1'], workingDirectory: '', exists });
    assert.deepEqual(result, [{ path: '/ws1', source: 'workspace' }]);
  });

  it('includes at most 8 recent folders', () => {
    const recent = Array.from({ length: 12 }, (_, i) => `/r${i}`);
    const result = buildFolderCandidates({
      workspaceFolders: ['/ws1'],
      recentFolders: recent,
      exists: () => true,
    });
    assert.equal(result.filter((c) => c.source === 'recent').length, 8);
    assert.equal(result.length, 9);
  });
});
