# Changelog

## 0.4.0

- **Terminal.** A real shell in the page, in the session's folder. Ctrl ` opens it as a dock under the session in the classic layout, or as a tiled window in Riced. Tabs, drag to resize, and it survives a page reload. Runs on Linux, macOS and Windows (PowerShell).
- **Open in terminal.** Any file in Changes, Files touched or a diff has an open button. It starts your editor on that file in a new terminal: `$EDITOR`, or whatever you set in settings.
- **Changes.** A card with the folder's git status: branch, ahead and behind, each changed file with +/− counts. Click a file for its diff.
- **Theme switcher.** Alt T opens a picker that previews themes as you move through them. The classic layout now comes in Catppuccin Mocha and Latte, Tokyo Night, Gruvbox, Nord, Rosé Pine and Everforest.
- **What's new.** This list, in settings and in the Riced launcher.

## 0.3.0

- **Riced.** A tiling desktop theme. Every open session is a window, and workspaces are projects. Also: a waybar-style bar with usage block meters, a rofi-style launcher (Alt Enter), dunst-style notifications and a neofetch screen when the desktop is empty.
- **desk.conf** (Alt C). Palette, gaps, gradient borders, rounding, font, bar position and wallpaper, all applied as you type.

## 0.2.0

- Monospace everywhere (JetBrains Mono).
- Smaller corner radius, now set per theme.

## 0.1.0

- First version: a local web UI that drives the `claude` CLI you're already logged into.
- Permission prompts as cards, plan usage bars, to-dos, files touched, session stats and a context bar.
- Resume any session you started in the terminal.
- Demo mode with made-up sessions.
