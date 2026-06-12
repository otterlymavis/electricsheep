# Electric Sheep

A local-first desktop prototype for tracking AI terminal sessions and saving useful AI conversation snippets.

## What it does

- Saves clipboard text as a bookmark
- Saves clipboard images as attachments
- Adds notes and comma-separated tags
- Captures a screenshot and attaches it to a bookmark
- Imports text files and image files
- Searches saved text, notes, and tags
- Reads saved snippets in a focused reader view with adjustable font, width, spacing, and theme
- Tracks interactive terminal sessions and creates a local wrap-up
- Records structured session timelines with redacted secrets and git context
- Exports a portable archive with Markdown, HTML, JSON, session files, and attachments
- Stores data locally in `~/.electricsheep`

## Run it

```sh
npm install
npm start
```

Run the smoke test:

```sh
npm test
```

Check local runtime dependencies:

```sh
npm run sheep -- doctor
```

## Common commands

| Command | Purpose |
| --- | --- |
| `npm start` | Run the desktop app in development |
| `npm run open:app` | Open the packaged macOS app |
| `npm test` | Run the local smoke test |
| `npm run sheep -- doctor` | Check local runtime dependencies |
| `npm run sheep -- track <command>` | Track a terminal session |
| `npm run sheep -- search "query"` | Search bookmarks, OCR, wrap-ups, and transcripts |
| `npm run sheep -- export` | Export Markdown and JSON |
| `npm run sheep -- import <json>` | Import a JSON archive |
| `npm run sheep -- repair-legacy` | Generate structured timelines for older tracked sessions |

Package the macOS app:

```sh
npm run pack
```

Open the packaged app after packing:

```sh
npm run open:app
```

Build a distributable DMG:

```sh
npm run dist
```

The macOS distributable is written to `release/Electric Sheep-<version>-arm64.dmg`.

Build a Windows x64 app folder:

```sh
npm run pack:win
```

Build a Windows x64 ZIP:

```sh
npm run dist:win
```

The Windows distributable is written to `release/Electric Sheep-<version>-win.zip`.

Build Electric Lamb, the lightweight browser edition:

```sh
npm run dist:lamb
```

The static Lamb distributable is written to `release/electric-lamb.zip`. It opens directly in a browser and stores bookmarks in that browser's local storage.

Run Electric Lamb with the lightweight native companion:

```sh
npm run lamb
```

Track a terminal session for Lamb to display:

```sh
npm run lamb:track -- zsh
```

Build Electric Lamb as a single lightweight macOS app shell:

```sh
npm run dist:lamb:app
```

The app bundle is written to `release/Electric Lamb.app`, with a ZIP at `release/Electric Lamb-mac.zip`. This shell uses macOS WebKit instead of bundling Chromium, so it is much smaller than the Electron app. The thin package expects Node.js to be available on the target machine.

Build the self-contained Electric Lamb app:

```sh
npm run dist:lamb:app:standalone
```

The standalone ZIP is written to `release/Electric Lamb-standalone-mac.zip`. It bundles the official macOS arm64 Node runtime, verifies the Node archive checksum during packaging, and stays substantially smaller than the Electron DMG.

Build all Lamb distributables:

```sh
npm run dist:lamb:all
```

This also writes `release/electric-lamb-release.json` and `release/electric-lamb-release.md` with byte sizes and SHA-256 checksums for the Lamb ZIP files.

Verify the generated release manifest:

```sh
npm run verify:lamb:release
```

Check Lamb artifact size budgets:

```sh
npm run check:lamb:size
```

The size gate keeps the static ZIP under 1 MB, the thin app ZIP under 5 MB, and the standalone app ZIP under 60 MB. When an Electron DMG exists in `release/`, it also checks that standalone Lamb remains smaller than the Electron DMG.

Build and verify the Lamb release:

```sh
npm run release:lamb
```

This builds all Lamb artifacts, writes the release manifest, then runs the Lamb backend and packaged-app smoke tests. Local macOS app bundles are unsigned by default; public distribution requires Developer ID signing and notarization.

Run the trusted-tester release preflight:

```sh
npm run preflight:lamb
```

The default preflight checks local packaging tools, built Lamb artifacts, and bundled Node portability.

Run the public-release preflight:

```sh
npm run preflight:lamb:public
```

The public preflight additionally checks Developer ID identity availability and notarytool profile configuration.

Notarize the standalone Lamb app for public macOS distribution:

```sh
ELECTRIC_LAMB_DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)" \
ELECTRIC_LAMB_NOTARY_PROFILE="your-notarytool-profile" \
npm run notarize:lamb
```

Create the notarytool profile once with:

```sh
xcrun notarytool store-credentials your-notarytool-profile
```

The notarization command signs `release/standalone/Electric Lamb.app` with the hardened runtime, submits `release/Electric Lamb-standalone-notarized-mac.zip`, staples the accepted ticket to the app, validates it, and rewrites the notarized ZIP.

Smoke-test the packaged standalone app lifecycle:

```sh
npm run smoke:lamb:app
```

The smoke test launches `release/standalone/Electric Lamb.app`, checks that the internal backend starts, quits the app, and verifies the backend exits.

Smoke-test the Lamb backend API:

```sh
npm run smoke:lamb:server
```

The backend smoke test starts Lamb against an isolated temp store, checks the served UI, saves and searches a bookmark, verifies browser capture, and records a short tracked terminal session.

Smoke-test the Lamb browser UI workflow:

```sh
npm run smoke:lamb:ui
```

The UI smoke test opens the served Electric Lamb app in local Chrome, verifies the bridge, saves a bookmark, searches it, loads it in Reader, and records a short tracked terminal session.

On Apple Silicon Macs, the Windows build skips executable resource editing/signing so it can cross-build without Wine.

Local development builds are unsigned. For public macOS distribution, sign and notarize with an Apple Developer ID before sharing outside trusted testers.

The packaged app uses `build/icon.icns` as its macOS icon.

## Electric Lamb

Electric Lamb is the lightweight edition in `lite/`. It has four modes:

- Static mode: open the app directly from `release/electric-lamb.zip`; data stays in that browser's local storage.
- Companion mode: run `npm run lamb`; the browser UI reads and writes the normal Electric Sheep store in `~/.electricsheep`.
- App mode: run `npm run dist:lamb:app`; Electric Lamb opens as one macOS app window and starts the local backend internally.
- Standalone app mode: run `npm run dist:lamb:app:standalone`; Electric Lamb opens as one macOS app window with its backend runtime bundled.

Electric Lamb keeps the small, portable parts:

- save text, notes, and tags
- save clipboard images and screenshots in app/companion mode on macOS
- search saved items
- focused reader controls
- import text/Markdown/log files as saves
- import Electric Sheep JSON exports
- export JSON, Markdown, and HTML
- archive-wide search in companion mode
- view tracked terminal sessions in companion/app mode
- start tracked terminal commands from the Sessions panel in app/companion mode
- preview session wrap-ups, transcripts, and structured event logs
- save session wrap-ups back to bookmarks
- run archive health checks, legacy-log repair, and full Electric Sheep exports
- receive browser extension captures through the same local capture port as Electric Sheep
- use global shortcuts in app mode on macOS

The browser-only static mode intentionally omits native desktop features:

- screenshot and clipboard image capture
- local file attachment copying
- system-wide shortcuts

Terminal tracking is still available without Electron through `npm run lamb:track -- <command>`. The Lamb app UI can also start tracked commands from the Sessions panel.

Use Electric Lamb when size and portability matter more than native capture features.

If Electron reports that it failed to install correctly, run:

```sh
node node_modules/electron/install.js
```

Some npm setups require approving package install scripts before Electron can download its desktop runtime. If terminal tracking reports `posix_spawnp failed` on macOS, approve package scripts with npm or make the PTY helper executable:

```sh
chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper
```

## Track a terminal session

```sh
npm run sheep -- track codex
npm run sheep -- track claude
npm run sheep -- track zsh
```

The tracker saves each session under `~/.electricsheep/sessions/` with:

- `transcript.txt`
- `transcript.jsonl`
- `wrap-up.md`
- `session.json`

List recent sessions:

```sh
npm run sheep -- sessions
```

List recent bookmarks:

```sh
npm run sheep -- bookmarks
```

The tracker uses a pseudoterminal, so interactive tools and shells behave like normal terminal sessions while Electric Sheep records the displayed transcript.

New tracked sessions also save a structured `transcript.jsonl` timeline with terminal output chunks, input markers, end metadata, redaction counts, and git working-tree context when the command runs inside a Git repository.

Repair older tracked sessions:

```sh
npm run sheep -- repair-legacy
```

This creates structured timelines for legacy sessions that only have `transcript.txt`.

Delete stored items:

```sh
npm run sheep -- delete bookmark <id>
npm run sheep -- delete session <id>
```

Deleting a session removes its session folder when it is inside the Electric Sheep store.

## Quick Save sources

The desktop app can save:

- clipboard text
- clipboard image
- screen screenshot
- text files: `.txt`, `.md`, `.json`, `.log`, `.csv`
- image files: `.png`, `.jpg`, `.jpeg`, `.webp`

Image attachments are saved locally with an `extractedText` field ready for OCR later.

On macOS, new screenshots, clipboard images, and imported image files are processed with local Apple Vision OCR. Extracted text is saved in the attachment metadata and becomes searchable immediately. Windows builds can save and preview images, but OCR is currently macOS-only.

Backfill older saved images:

```sh
npm run sheep -- ocr-backfill
```

## Export

Export bookmarks, tracked sessions, attachments, and copied session files to Markdown, HTML, and JSON:

```sh
npm run sheep -- export
```

You can also pick an export folder from the desktop app with the Library export button.

Import an exported JSON archive:

```sh
npm run sheep -- import /path/to/electric-sheep-data.json
```

Imports merge by item ID and skip duplicates. The desktop app also has a Library import button.

Each export includes an `export-report.md` summary with copied files and any skipped missing/unreadable files.

## Search

Search bookmarks, rich captured HTML, OCR text, session wrap-ups, structured timelines, and tracked transcripts:

```sh
npm run sheep -- search "docker bug"
```

The desktop app has a Search tab for the same archive-wide search.

## Shortcuts

- `Cmd+Shift+B`: open the app and load the current clipboard text
- `Cmd+Shift+S`: capture a screenshot, open the app, and load clipboard text

On macOS, screenshot capture may require Screen Recording permission for the app/terminal launching Electron.

## Next good features

- SQLite storage
- Browser extension capture for web AI conversations
- Semantic/vector search over saved snippets
- Optional cloud sync
