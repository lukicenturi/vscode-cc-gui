# CCGUI / CC GUI (Claude, Codex, OpenCode, Kimi...)

[中文](./README.zh-CN.md)

**CCGUI** (also known as **CC GUI** / **ccgui**) is a 100% open-source GUI for Claude Code CLI, Codex, OpenCode, Kimi, Grok, and more — shipped as a VS Code extension.

> **Unofficial.** CC GUI is an independent open-source project and is **not affiliated with, endorsed by, or sponsored by** Anthropic, OpenAI, Microsoft, or other third-party tool vendors.

---

## Features

### Remote Control (phone)

Run **CC GUI: Start Remote Control (Phone)** from the Command Palette, or click the phone icon in the CC GUI view title bar. Select a folder, then enter a session name. The extension starts `claude remote-control --name <name>` in a new VS Code terminal in that folder. Open the Claude app on your phone, go to **Code**, and select the session to chat with that folder. On macOS, the command runs inside `caffeinate -i` so that the Mac does not sleep (setting `ccGui.remoteControl.keepAwake`). The session is stored by the Claude Code CLI, so it also shows in the CC GUI History view of that workspace.

### Drag files from the Explorer into a browser or into the chat

Two VS Code rules limit drag-and-drop from the Explorer, and no extension can change them:

- A drag from the Explorer puts only text and URIs on the drag data, not a real file. A browser page that you drop on cannot read the file.
- VS Code blocks pointer events on every webview while a drag runs inside the window. A drop reaches the chat input only when you **hold Shift**.

`scripts/patch-vscode.sh` patches the installed VS Code for both:

```bash
scripts/patch-vscode.sh apply     # back up, patch, and fix the checksums
scripts/patch-vscode.sh restore   # put the original files back
scripts/patch-vscode.sh status    # show the state of each patch
```

After the patch:

- **Native file drag:** hold **Option (Alt)** when you start a drag in the Explorer. The file goes on the OS drag pasteboard as a real file, so you can drop it into a browser as an upload, into Finder, or into any app. Only the first selected file is dragged. Without Option, the Explorer drag works as before.
- **Webview drop:** a drop from the Explorer reaches the chat input without Shift. Shift gives the old VS Code behaviour.

Restart VS Code after the patch. Run `apply` again after each VS Code update, because an update replaces the files. Set `VSCODE_APP` to patch a different install, and `CCGUI_PATCHES` to apply only one patch (`native-drag` or `webview-drop`).

---

## Keep the fork up to date with upstream

```bash
scripts/sync-upstream.sh
```

The script fetches `upstream/main`, merges it, sets the fork version to one major above upstream (so the Marketplace release never replaces the fork), rebuilds, packages the VSIX and installs it. Add `--no-install` to only package.

## Build and Package the VSIX

From the project root:

```bash
npm install
cd webview && npm install && cd ..
cd ai-bridge && npm install && cd ..
npm run build
npm exec --yes --package=@vscode/vsce -- vsce package
```

The generated file is named `vscode-cc-gui-<version>.vsix` in the project root. Install it in VS Code with:

```bash
code --install-extension ./vscode-cc-gui-0.1.1.vsix
```

### Repair a broken global `vsce` command

If a global `vsce` install is broken, reinstall it:

```bash
npm uninstall -g @vscode/vsce
npm install -g @vscode/vsce
vsce package
```

---

## License

[MIT](./LICENSE)

---

## Contributors

Thanks to everyone who has helped make CC GUI better.

<a href="https://github.com/zhukunpenglinyutong/vscode-cc-gui/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zhukunpenglinyutong/vscode-cc-gui" alt="Contributors" />
</a>

---

## Acknowledgements

1. This project was originally adapted from [jetbrains-cc-gui](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui)
2. The Design · Usage Statistics module is largely based on the [TokenTracker](https://github.com/mm7894215/TokenTracker) source code.

---

## Trademarks

- **Claude** and **Claude Code** are trademarks of Anthropic, PBC.
- **Codex**, **ChatGPT**, and **OpenAI** are trademarks of OpenAI.
- **Visual Studio Code** and **VS Code** are trademarks of Microsoft Corporation.

These names are used solely to describe third-party products and technologies that this extension is compatible with or integrates. They do **not** imply any affiliation, endorsement, or sponsorship by the respective rights holders.

Claude®, Claude Code, Codex, ChatGPT, OpenAI, Visual Studio Code, and related marks are trademarks of their respective owners. They are used here only to describe interoperability. This project is not affiliated with or endorsed by those trademark owners.

---

## Star History

[![Star History](https://star-history.dera.page/svg?repos=zhukunpenglinyutong/vscode-cc-gui&type=date&legend=top-left)](https://star-history.dera.page/#zhukunpenglinyutong/vscode-cc-gui&type=date&legend=top-left)
