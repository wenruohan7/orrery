# Orrery

A notes app in the spirit of Obsidian, where your notes **orbit each other**.

- Markdown notes with folders, `[[wiki links]]`, backlinks, unlinked mentions, tags, an outline and frontmatter properties
- Live preview editing (formatting renders as you type), a `/` menu for headings, tasks, tables, images and templates, link and tag autocomplete, plus a reading view with callouts, tasks you can tick, highlights and embeds
- Attachments: paste, drop or attach images, audio, video and PDFs
- Daily notes, templates (`{{date}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`), stars, quick switcher and command palette
- **Solar system**: a 3D view where each top-level folder is a galaxy with a gravitationally lensed black hole at its centre (the folder note, or the most linked note). Notes linked to it are stars, their links are planets, links from those are moons, unlinked notes form an asteroid belt, and other links are light beams.
- **Designs**: change any body's colour, surface (rocky, desert, ocean, ice, lava, gas giant, toxic), rings, size, glow, or a black hole's disk colour, brightness and spin. Designs are saved as `orrery-*` properties in the note. Galaxy themes (Realistic, Neon, Pastel, Monochrome) and tag or folder rules are saved in `orrery.json` in the vault, so they sync too.
- 2D graph view
- Self-hosted sync that keeps your vault as plain `.md` files on your Linux machine
- Trash: deleted notes can be restored for 30 days on every device
- Version history: the server snapshots the vault with git, and any note can be rolled back from its History button
- Import an Obsidian vault folder; export and restore JSON backups

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | The app (React, TypeScript, Vite, three.js). Installable as a PWA. |
| `apps/web/src-tauri` | Tauri v2 shell for a native Linux desktop app |
| `server` | Sync server (Bun, no dependencies). Also serves the built app. |

## Run it

Needs [Bun](https://bun.sh).

```bash
bun install
bun run start
```

This builds the app and starts the server on port 8787. It prints the vault folder, a **token** and your LAN address, like `http://192.168.1.5:8787`.

- **On Linux:** open `http://localhost:8787`, then open Settings → Sync and paste the token.
- **On iPhone** (on the same Wi-Fi): open the LAN address in Safari, tap Share → **Add to Home Screen**, open Orrery from the home screen, then paste the token in Settings → Sync.

Your notes are stored in `vault/` (change it with `ORRERY_VAULT=/path/to/folder`). You can edit those files with any editor. Orrery picks up the changes on the next sync. The token is kept in `vault/.orrery/token`, or you can set it with `ORRERY_TOKEN`.

### Offline use on iPhone needs HTTPS

Over plain `http://` on your LAN, iOS won't let the app cache itself for offline use. Notes you've already loaded are still saved on the phone. For full offline support and access away from home, put the server behind HTTPS. The easiest way is [Tailscale](https://tailscale.com): install it on the Linux machine and the iPhone, then run `tailscale serve --bg 8787` and use the `https://…ts.net` address it gives you.

### Development

```bash
bun run server
```

```bash
bun run dev
```

The dev app runs at `http://localhost:5173` and forwards `/api` to the server.

## Linux desktop app (Tauri)

The desktop app needs Rust and the WebKitGTK headers:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
bun run desktop
```

`bun run desktop:build` produces a `.deb` and an AppImage in `apps/web/src-tauri/target/release/bundle/`.
In the desktop app, enter the server address (`http://localhost:8787`) and token in Settings → Sync.

### Version history

The server turns the vault folder into a git repository and saves a snapshot about 20 seconds after changes arrive. It needs `git` installed (it is on most Linux systems). The sync token in `vault/.orrery/` is never committed. Set `ORRERY_HISTORY=off` to turn history off.

## How sync works

Each device keeps a full copy of the vault in IndexedDB, so it works offline. The server gives every file a revision number. Devices upload their changes with the revision they started from and download anything newer. If the same note changed on two devices, nothing is lost: the server's version stays, and the other one is saved next to it as `Note (conflict 2026-11-20 1530).md`.
