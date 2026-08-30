# Changelog

All notable changes to Canvas Comments are documented here.

## 1.0.0 — 2026-08-29

First public Community directory release.

### Added

- Threaded comments for Canvas elements.
- Comments on selected text inside editable Canvas text cards.
- Comments on selected text in Markdown notes.
- Yellow editor highlights and best-effort Reading-view highlights.
- Multiple anonymous replies per thread.
- Rich hover previews with relative timestamps.
- Zoom-aware Canvas marker clustering.
- Resolved-thread hiding, management, and restoration.
- Automatic Canvas and note path migration after rename.
- Migration from the 0.1.x single-comment data format.

### Changed

- Removed comment author identity from storage and interface.
- Externalized Obsidian and CodeMirror runtime packages to preserve Canvas text editing.
- Standardized all plugin interface text in English.

### Privacy

- No network access, accounts, telemetry, ads, remote assets, or runtime downloads.
- Comment data remains in the vault plugin data file.
