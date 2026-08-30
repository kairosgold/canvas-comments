# Obsidian Community Directory Release Checklist

This repository is prepared for the current Obsidian Community directory submission flow.

## Repository requirements

- [x] Public GitHub repository.
- [x] `README.md` explains purpose, use, privacy, and limitations.
- [x] `LICENSE` is present.
- [x] `manifest.json` uses a unique plugin ID that does not contain `obsidian`.
- [x] `versions.json` maps each plugin version to its minimum Obsidian version.
- [x] Reviewable TypeScript source and lockfile are committed.
- [x] No telemetry, advertising, runtime dependency installation, or remote assets.
- [x] No default hotkeys.
- [x] Description is under 250 characters and ends with a period.
- [x] Desktop-only status matches the tested platform boundary.

## Build verification

Run from the repository root:

```bash
npm ci
npm run typecheck
npm run build
node --check main.js
```

Then test the installed build in a clean Obsidian desktop vault.

## GitHub Release

The tag must exactly match `manifest.json`. For version `1.0.0`:

```bash
git tag -a 1.0.0 -m "Canvas Comments 1.0.0"
git push origin 1.0.0
```

The included GitHub Actions workflow builds the plugin and creates a draft Release. Review and publish it, then confirm these files are separate Release assets:

- `main.js`
- `manifest.json`
- `styles.css`

Do not use a `v1.0.0` tag and do not provide only a ZIP archive.

## Community directory submission

1. Sign in at <https://community.obsidian.md>.
2. Link the GitHub account that owns this repository.
3. Open <https://community.obsidian.md/account/plugins/new>.
4. Paste the public repository URL.
5. Select the repository owner.
6. Read and accept the developer policy and maintenance commitment.
7. Submit the plugin.

The directory reads `manifest.json` from the default branch and verifies the GitHub Release whose tag matches its version. Only the initial plugin version is submitted through this form. Later updates are distributed through matching GitHub Releases.

## Review responses

If automated or manual review requires changes:

1. Apply the fix in the repository.
2. Increment `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
3. Build and test again.
4. Publish a new matching GitHub Release.
5. Return to the directory review page and confirm the updated result.
