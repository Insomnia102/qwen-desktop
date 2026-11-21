<p align="center">
  <img src="resources/qwen.svg" width="80" alt="Qwen Desktop logo">
</p>

<h1 align="center">Qwen Desktop</h1>

<p align="center">A desktop workspace for coding with Qwen Code.</p>

<p align="center">
  <strong>English</strong> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/insomnia102/qwen-desktop/releases">Download</a> ·
  <a href="https://github.com/insomnia102/qwen-desktop/issues">Report an issue</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

## Why Qwen Desktop?

Qwen Desktop brings Qwen Code into a graphical workspace: open a project, describe a task, follow the agent's progress and manage its access to tools.

Keep separate conversations for different projects, return to saved chats and configure models, MCP servers and skills from the same interface. It is built for people who want a convenient desktop interface for their coding agent.

This is an independent community project, not an official Qwen application.

## Requirements

- **Node.js 22 or newer with npm** for the initial CLI setup. **Node.js 26.x is recommended.** Download it from [nodejs.org](https://nodejs.org/en/download).
- An internet connection to install the CLI and contact your model provider.
- API credentials for a supported provider, or an existing compatible Qwen configuration. Model access is configured separately.

**You do not need to install Qwen CLI globally.** The app can detect a compatible installation or install its own copy. If Node.js or npm is missing, the setup screen explains what to install. Requirements for any MCP servers or skills you add apply separately.

## Features

- **Projects and persistent chats.** Separate conversations per working folder, saved history, chat renaming and deletion. Close and reopen workspaces without losing their chats.
- **Readable answers and activity.** Markdown, code blocks, a collapsible work log and model reasoning when the model provides it.
- **Permission controls.** Plan, Ask Permissions, Auto-Edit, Auto and YOLO modes, plus approval for one operation or the current conversation.
- **Model profiles.** Configure OpenAI-compatible, Anthropic-compatible and Gemini API connections, check connectivity and switch models.
- **MCP servers.** Manage stdio, Streamable HTTP and SSE connections, inspect available tools and choose which ones are enabled.
- **Skill packages.** Create, import and edit skills with their instructions, scripts, rules, references and other resources directly in the app.
- **Skills Lab.** Test full conversations manually or with an AI user. Generate editable scenarios from a plain-language goal, evaluate natural-language requirements with cited evidence, and combine them with exact file/JSON checks. Includes fresh test workspaces, persistent run history with deletion, standalone HTML reports with evidence links, YOLO automation and explicit/automatic skill invocation.
- **Built-in Skill Creator.** Anthropic’s skill-creator resources, adapted for Qwen: describe a skill, review its generated package and scenarios, then install it. No Claude CLI is required for the Desktop workflow.
- **Large skill packages.** Paged file navigation, metadata previews for large files and `.skillignore` for downloaded repositories and caches.
- **System prompts and slash commands.** Customize the agent's instructions and invoke available commands and skills from chat.
- **Settings UI.** Change supported Qwen settings and toggle built-in tools through the UI.
- **Three interface languages and two themes.** English, Russian and Simplified Chinese; light and dark appearance.

## Installation

Download an installer from [Releases](https://github.com/insomnia102/qwen-desktop/releases):

| Platform | Architecture | Download format |
| --- | --- | --- |
| Windows | x64 | `.exe` |
| macOS Intel | x64 | `.dmg` or `.zip` |
| macOS Apple Silicon | arm64 | `.dmg` or `.zip` |
| Linux | x64 | `.AppImage` or `.tar.gz` |

1. Install the app. On macOS, move it to Applications. On Linux, make the AppImage executable or extract the archive.
2. Open Qwen Desktop and complete the CLI setup. If prompted, install Node.js with npm, restart the app and retry.
3. Choose your interface language and configure a model connection.
4. Verify the connection, open a project folder and send your first task.

Current Windows installers are unsigned; macOS builds use an ad-hoc signature without notarization. Your operating system may ask for confirmation before opening the app.

Chats are saved locally. Model requests go to the provider you configure. Tool permissions control the agent's actions; the working folder is not an operating-system sandbox. YOLO automatically approves enabled tools.

## Roadmap

- [ ] **Agents:** add a visual interface for creating, editing and configuring agents.
- [ ] **Workflows:** create, edit and reuse workflows inside the app.
- [ ] **Skill testing improvements:** richer comparisons, larger fixture imports and additional evaluation options.
- [ ] **A better skill editor:** continue improving navigation and validation for multi-file packages.

These are planned features, not promises of a specific release date. Suggestions and bug reports are welcome in [Issues](https://github.com/insomnia102/qwen-desktop/issues).

See [Skills Lab guide](docs/SKILLS_LAB.md) for dialogue scenarios, checks, permissions and HTML run reports.

## Run from source

For development, install Node.js 26.x and the pnpm version specified in the project, then run:

```bash
pnpm install
pnpm dev
```

Run the project checks with `node scripts/ci-check.mjs`.

## Author and license

Created by **Egor Svirin — [insomnia102](https://github.com/insomnia102)**.

Copyright © 2026 Egor Svirin.

The current project is distributed under the **GNU General Public License v3.0 only (`GPL-3.0-only`)**. See [LICENSE](LICENSE). GPL-covered derivative programs must provide corresponding source code under the GPL when distributed; commercial use is allowed.

Earlier revisions published under **Unlicense or MIT** retain their original permissions. Changing this repository's license does not revoke those permissions or place already public-domain code under exclusive copyright. Third-party components retain their respective licenses.
