# Changelog

## 0.7.0

- **Auto route.** Before each message, Haiku reads it and picks a level: easy (Sonnet medium), normal (Sonnet high), think (Opus medium, for "what should I do" questions) or hard (Opus high). Each pick takes about two seconds and costs about $0.002. The transcript shows what it picked and why, under your message. Short replies like "ok" or "go" skip the router. Once a conversation passes 40k tokens of context, it only steps up, because a switch re-reads the whole conversation without the cache. On by default for new sessions; the model pill in the header turns it off for a session, and so does picking a model yourself. Change which model each level uses in Edit the routes (from that pill, Settings or the Riced launcher).
- **Bench has an `auto` variant**, so next to solo you can see what the router picks and what it costs.
- Fixed: after a session's process restarted (a model switch, or the 20-minute idle stop), the next turn's cost counted everything from before the restart again.

## 0.6.0

- **Lean sessions.** A "lean" pill in the header (and a default in Settings) gives Claude only the file and shell tools. Every tool's definition is re-sent on every step, so this shrinks each step's prompt a lot: measured 28.6k → 10.4k tokens for a session and 19.7k → 6.2k for a crew helper. You lose web search, MCP tools and other extras for that session.
- **Crew helpers are lean by default** (switch in Edit the crew).
- **Benchmark script.** `npm run bench -- "prompt"` runs the same task as solo, solo-lean, crew and crew-lean, each in its own folder, then prints a comparison of time, cost, tokens, re-reading, helpers, test results and how much of your week it used. `--from <folder>` copies an existing project into each run. Reports are saved in bench-results/.

## 0.5.4

- Crew helpers show live progress on their row (current step, tokens so far, time).
- Helpers that Claude Code moves to the background part-way through now finish properly: the row completes with its stats, and the run is logged for the crew stats. Before, those runs were missing from the stats.

## 0.5.3

- The planner decides again when a job is small enough for one helper, as in 0.5.0. A real run showed one S3 doing a small app in one pass beats splitting it. Untick "Let the planner send small jobs straight to one helper" in Edit the crew if you want a plan every time.

## 0.5.2

- **Font picker.** Settings → Fonts sets the interface font and, separately, the font for code, diffs and terminals, so the UI can be a sans serif while code stays lined up. Interface: JetBrains Mono, Geist Mono, IBM Plex Mono, Fira Code, Space Mono, Inter, Geist, Space Grotesk, Manrope, Plus Jakarta Sans, DM Sans, IBM Plex Sans, Outfit, Archivo. Riced gets a `code_font` line in desk.conf.

## 0.5.1

- The planner only skips the plan for a genuinely single change (one or two files, nothing to test separately). Anything with separate parts gets planned and split across levels. A new switch in Edit the crew turns the shortcut off entirely.

## 0.5.0

- **Crew mode.** A planner (Opus 5.5, medium) splits your request into tasks and hands each one to the cheapest helper that can do it: a Haiku scout for reading, Sonnet 5 at medium, high and xhigh, and Opus 5.5 at low, medium, high and xhigh. If a helper fails, the task moves up a level. You see the plan first and press Go. Helper runs show with their level, tokens and time, and the Crew card shows the plan, escalations like S3 → O1, and cost per model. Turn it on per session from the header pill, the Crew button on the start page, or "crew session" in the Riced launcher.
- **Crew editor.** Change any level's model, effort or job, how many times a task can escalate, and whether you approve the plan first. It also shows per-level stats (runs, how often each level got escalated, average tokens) so the ladder can be tuned from real data.

## 0.4.1

- **Easier to read in Riced.** Your prompts are tinted blocks in your accent colour with a rule above each turn, tool calls sit together in their own darker box, and Claude's replies get an orange bullet.
- **Shortcuts you can change.** Pick the modifier (Alt, Ctrl Alt, Alt Shift or Ctrl Shift) so desk stops fighting GlazeWM, i3 or Hyprland, and rebind any shortcut by pressing the new keys. Settings → Shortcuts, or "keyboard shortcuts" in the Riced launcher. AltGr typing never triggers a shortcut.

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
