import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  RECENT_FOLDERS_KEY,
  WORKING_DIRECTORY_KEY,
  buildFolderCandidates,
  buildRemoteControlCommand,
  defaultSessionName,
  folderBasename,
  normalizeFolderPath,
  updateRecentFolders,
  validateSessionName,
  type FolderCandidate,
} from './remoteControlHelpers';

interface FolderPickItem extends vscode.QuickPickItem {
  folder?: string;
  browse?: boolean;
}

const SOURCE_DETAIL: Record<FolderCandidate['source'], string> = {
  workspace: 'Workspace folder',
  workingDirectory: 'CC GUI working directory',
  recent: 'Recent',
};

function isDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Starts Claude Code CLI sessions with Remote Control enabled in VS Code terminals,
 * so that the user can continue the session from the Claude phone app.
 */
export class RemoteControlService implements vscode.Disposable {
  /** Folder → open Remote Control terminals for that folder (most recent last). */
  private readonly terminals = new Map<string, vscode.Terminal[]>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((closed) => this.forgetTerminal(closed))
    );
  }

  async start(): Promise<void> {
    const folder = await this.pickFolder();
    if (!folder) return;
    const basename = folderBasename(folder);

    const running = this.openTerminalFor(folder);
    if (running) {
      running.show();
      const choice = await vscode.window.showInformationMessage(
        `Remote Control is already running in ${basename}.`,
        'Start another'
      );
      if (choice !== 'Start another') return;
    }

    const sessionName = await vscode.window.showInputBox({
      title: 'Remote Control session name',
      prompt: 'The Claude app on your phone shows this name.',
      value: defaultSessionName(folder),
      ignoreFocusOut: true,
      validateInput: (value) => validateSessionName(value) ?? null,
    });
    if (sessionName === undefined) return;
    const name = sessionName.trim();

    const config = vscode.workspace.getConfiguration('ccGui.remoteControl');
    const command = buildRemoteControlCommand({
      claudePath: config.get<string>('claudePath', 'claude'),
      sessionName: name,
      keepAwake: config.get<boolean>('keepAwake', true),
      platform: process.platform,
      extraArgs: config.get<string>('extraArgs', ''),
    });

    const terminal = vscode.window.createTerminal({
      name: `Remote Control: ${basename}`,
      cwd: folder,
      iconPath: new vscode.ThemeIcon('device-mobile'),
    });
    const list = this.terminals.get(folder) ?? [];
    list.push(terminal);
    this.terminals.set(folder, list);
    terminal.show();
    terminal.sendText(command, true);

    const recent = this.context.globalState.get<string[]>(RECENT_FOLDERS_KEY);
    await this.context.globalState.update(RECENT_FOLDERS_KEY, updateRecentFolders(recent, folder));

    const machine = process.platform === 'darwin' ? 'Mac' : 'computer';
    void vscode.window
      .showInformationMessage(
        `Remote Control session '${name}' started in ${basename}. ` +
          `Open the Claude app on your phone, go to Code, and select this session. Keep this ${machine} awake.`,
        'Open History'
      )
      .then((choice) => {
        if (choice === 'Open History') {
          void vscode.commands.executeCommand('ccGui.openPanel');
        }
      });
  }

  dispose(): void {
    // The terminals stay open: a running phone session must not stop when the extension reloads.
    this.terminals.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private openTerminalFor(folder: string): vscode.Terminal | undefined {
    const list = this.terminals.get(folder);
    if (!list) return undefined;
    const open = list.filter((terminal) => terminal.exitStatus === undefined);
    if (open.length === 0) {
      this.terminals.delete(folder);
      return undefined;
    }
    this.terminals.set(folder, open);
    return open[open.length - 1];
  }

  private forgetTerminal(closed: vscode.Terminal): void {
    for (const [folder, list] of this.terminals) {
      const rest = list.filter((terminal) => terminal !== closed);
      if (rest.length === 0) {
        this.terminals.delete(folder);
      } else if (rest.length !== list.length) {
        this.terminals.set(folder, rest);
      }
    }
  }

  private async pickFolder(): Promise<string | undefined> {
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? [])
      .filter((wf) => wf.uri.scheme === 'file')
      .map((wf) => wf.uri.fsPath);
    const candidates = buildFolderCandidates({
      workspaceFolders,
      workingDirectory: this.context.globalState.get<string>(WORKING_DIRECTORY_KEY),
      recentFolders: this.context.globalState.get<string[]>(RECENT_FOLDERS_KEY),
      exists: isDirectory,
    });

    const items: FolderPickItem[] = candidates.map((candidate) => ({
      label: folderBasename(candidate.path),
      description: candidate.path,
      detail: SOURCE_DETAIL[candidate.source],
      folder: candidate.path,
    }));
    items.push({ label: '$(folder-opened) Browse…', browse: true });

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Start Remote Control',
      placeHolder: 'Select the folder for the Remote Control session',
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!picked) return undefined;
    if (picked.folder) return picked.folder;

    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Start Remote Control Here',
      defaultUri: candidates[0] ? vscode.Uri.file(candidates[0].path) : undefined,
    });
    const uri = uris?.[0];
    return uri ? normalizeFolderPath(uri.fsPath) : undefined;
  }
}
