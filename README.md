# Canvas Comments

[![GitHub release](https://img.shields.io/github/v/release/kairosgold/canvas-comments?style=flat-square)](https://github.com/kairosgold/canvas-comments/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

Add anonymous, threaded comments to Obsidian Canvas elements, Canvas text selections, and selected text in Markdown notes.

Canvas Comments is local-first. It does not require an account, connect to a server, collect telemetry, or add comment markup to your Canvas and Markdown files. Comment data stays inside your vault's plugin data file.

## Features

- Add a comment thread to any Canvas element from its context menu.
- Select text while editing a Canvas text card and choose **Add comment**.
- Select text in a Markdown note and choose **Add comment**.
- Keep multiple replies in the same thread.
- Highlight active commented text without changing the underlying document.
- Hover over a Canvas marker or highlighted text to preview the latest comment.
- Merge nearby Canvas markers into a total count when zoomed out, then separate them again when zoomed in.
- Mark threads as resolved to hide them without deleting their history.
- Restore resolved threads from the built-in comment manager.
- Keep every comment anonymous: no author name, avatar, account ID, or device identity is stored.
- Automatically migrate data created by Canvas Comments 0.1.x.

## Requirements

- Obsidian 1.5.0 or later.
- Desktop Obsidian. Version 1.0.0 is intentionally marked desktop-only because its Canvas editor integration has been verified on desktop and is not yet certified on mobile.

## Installation

### From the Obsidian Community directory

After the plugin is accepted into the Community directory:

1. Open **Settings → Community plugins**.
2. Select **Browse** and search for **Canvas Comments**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub release](https://github.com/kairosgold/canvas-comments/releases/latest).
2. Create this folder inside your vault:

   ```text
   <Vault>/.obsidian/plugins/canvas-comments/
   ```

3. Copy the three downloaded files into that folder.
4. Reload Obsidian.
5. Enable **Canvas Comments** under **Settings → Community plugins**.

## Usage

### Comment on a Canvas element

1. Right-click a Canvas card, file, image, or other element.
2. Select **Add comment**.
3. Enter a comment and select the send button, or press `Cmd/Ctrl + Enter`.
4. Select the purple marker to open the thread and add more replies.

A marker displays the number of comments when a thread contains multiple replies. At low zoom levels, nearby markers merge into one dark count marker. Select that marker to see the commented elements in the cluster.

### Comment on text in a Canvas card

1. Double-click a Canvas text card to enter edit mode.
2. Select a line, paragraph, or text range.
3. Right-click the selection and choose **Add comment**.
4. Enter a comment and send it.

The selected text receives a yellow highlight. Right-click the same selected range and choose **Open comment**, or select the highlight, to reopen its thread.

### Comment on selected text in a Markdown note

1. Open a Markdown note in edit mode.
2. Select a line, paragraph, or text range.
3. Right-click the selection and choose **Add comment**.
4. Enter a comment and send it.

Canvas Comments uses CodeMirror decorations for editor highlights and best-effort text matching in Reading view. It does not insert `<mark>` tags or any other comment syntax into the Markdown source.

### Reply to a thread

Open an existing marker or highlight, type a reply, and select send. A thread can contain any number of replies. All replies remain anonymous and display only a relative timestamp.

### Resolve and restore a thread

- Select the checkmark in the thread header to mark the thread as resolved.
- Resolved threads remain in plugin storage, but their Canvas markers and text highlights are hidden.
- Open **Manage resolved comments** from the ribbon, Command Palette, or plugin settings to restore a thread.
- Use **Delete thread** only when you want to permanently remove a thread.

## Commands

Open the Command Palette with `Cmd/Ctrl + P` and search for:

- **Add comment to selected note text**
- **Add or open comment on selected Canvas element**
- **Mark selected Canvas comment as resolved**
- **Manage resolved comments**
- **Toggle Canvas comment markers**

The plugin does not assign default hotkeys. You can add your own under **Settings → Hotkeys**.

## Settings

- **Show comment markers** — Show or hide unresolved Canvas markers.
- **Rich hover previews** — Show the timestamp and latest comment on hover.
- **Cluster below zoom** — Choose the zoom level below which nearby markers merge.
- **Manage resolved comments** — Open the restore manager.

## Data and privacy

Comment data is stored locally in:

```text
<Vault>/.obsidian/plugins/canvas-comments/data.json
```

Canvas Comments:

- does not use the network;
- does not require an account;
- does not collect telemetry or analytics;
- does not load ads or remote assets;
- does not install or update dependencies at runtime;
- does not store comment author names, avatars, account IDs, or device identifiers;
- does not modify `.canvas` files or Markdown source files to store comments.

If you synchronize plugin configuration between devices, your synchronization tool may also synchronize `data.json`. Review that tool's settings and privacy policy separately.

## Anchor behavior and limitations

- Canvas element threads are associated with a Canvas path and node ID.
- Canvas text-card threads use a local synthetic key containing the Canvas path and node ID.
- Markdown text threads store the selected quote and its character range. If surrounding text changes, the plugin attempts to find the closest matching quote.
- Reading-view highlighting is best-effort for rendered Markdown. Complex selections that cross multiple rendered structures may appear only in edit mode.
- Obsidian does not currently expose every Canvas node API through its public TypeScript definitions. Canvas-specific access is isolated in a compatibility layer, but a future Obsidian Canvas implementation change may require a plugin update.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

The production build keeps the Obsidian API and CodeMirror packages external so the plugin reuses Obsidian's editor runtime. Bundling a second CodeMirror instance can break editing inside Canvas cards.

## Releases

The GitHub Actions workflow creates a draft GitHub release whenever a version tag is pushed. The tag must exactly match the version in `manifest.json`, without a `v` prefix. Each release includes:

- `main.js`
- `manifest.json`
- `styles.css`

See [COMMUNITY_RELEASE.md](COMMUNITY_RELEASE.md) for the Community directory checklist.

## Contributing

Issues and pull requests are welcome. Please include your Obsidian version, operating system, reproduction steps, and whether the problem occurs with other community plugins disabled.

## License

[MIT](LICENSE) © 2026 Coenrad Liu
