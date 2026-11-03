# CCGUI / CC GUI（Claude、Codex、OpenCode、Kimi...）

[English](./README.md)

**CCGUI**（也称 **CC GUI** / **ccgui**）是 100% 开源的 Claude Code CLI、Codex、OpenCode、Kimi、Grok 等图形界面（VS Code 插件）。

> **非官方。** CC GUI 是独立开源项目，与 Anthropic、OpenAI、Microsoft 及其他第三方工具厂商 **无隶属、背书或赞助关系**。

---

## 功能

### 远程控制（手机）

在命令面板中运行 **CC GUI: 启动远程控制（手机）**，或点击 CC GUI 视图标题栏中的手机图标。选择文件夹并输入会话名称后，插件会在该文件夹的新 VS Code 终端中运行 `claude --remote-control <名称>`。在手机上打开 Claude App，进入 **Code** 并选择该会话，即可与该文件夹对话。在 macOS 上，命令会通过 `caffeinate -i` 运行，防止 Mac 睡眠（设置项 `ccGui.remoteControl.keepAwake`）。会话由 Claude Code CLI 保存，因此也会显示在该工作区的 CC GUI 历史记录视图中。

---

## 许可证

[MIT](./LICENSE)

---

## 贡献者

感谢所有帮助 CC GUI 变得更好的贡献者。

<a href="https://github.com/zhukunpenglinyutong/vscode-cc-gui/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zhukunpenglinyutong/vscode-cc-gui" alt="Contributors" />
</a>

---

## 致谢与参考

1. 本项目最初源自 [jetbrains-cc-gui](https://github.com/zhukunpenglinyutong/jetbrains-cc-gui) 
2. 「设计 · 使用统计」模块主要参考 [TokenTracker](https://github.com/mm7894215/TokenTracker) 源码。

---

## 商标声明

- **Claude**、**Claude Code** 是 Anthropic, PBC 的商标。
- **Codex**、**ChatGPT**、**OpenAI** 是 OpenAI 的商标。
- **Visual Studio Code**、**VS Code** 是 Microsoft Corporation 的商标。

上述名称仅用于说明本扩展所兼容或集成的第三方产品与技术，**不表示**上述权利人对本项目有任何关联、认可或赞助。

Claude®、Claude Code、Codex、ChatGPT、OpenAI、Visual Studio Code 及相关标识均为其各自权利人的商标。此处仅用于描述互操作性。本项目与上述商标权利人无任何隶属或背书关系。
