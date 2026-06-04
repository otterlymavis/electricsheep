# Electric Sheep

A local-first desktop prototype for tracking AI terminal sessions and saving useful AI conversation snippets.

## What it does

- Saves clipboard text as a bookmark
- Saves clipboard images as attachments
- Adds notes and comma-separated tags
- Captures a screenshot and attaches it to a bookmark
- Imports text files and image files
- Searches saved text, notes, and tags
- Tracks interactive terminal sessions and creates a local wrap-up
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

Build a Windows x64 app folder:

```sh
npm run pack:win
```

Build a Windows x64 ZIP:

```sh
npm run dist:win
```

On Apple Silicon Macs, the Windows build skips executable resource editing/signing so it can cross-build without Wine.

The packaged app uses `build/icon.icns` as its macOS icon.

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

Export bookmarks and tracked sessions to Markdown plus JSON:

```sh
npm run sheep -- export
```

You can also pick an export folder from the desktop app with the Library export button.

Import an exported JSON archive:

```sh
npm run sheep -- import /path/to/electric-sheep-data.json
```

Imports merge by item ID and skip duplicates. The desktop app also has a Library import button.

## Search

Search bookmarks, OCR text, session wrap-ups, and tracked transcripts:

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
