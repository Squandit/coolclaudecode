# desk

A local web UI for Claude Code. Several sessions run side by side, and permission prompts show up as allow/deny cards. Your plan's 5-hour and weekly usage sits in the bottom-left corner. The side panel shows the to-do list, the files touched, the session's stats and a context bar.

It drives the `claude` CLI you already have installed, so it uses your existing login. That works with a Pro or Max subscription, and you don't need an API key. Every session is a normal Claude Code session, which means you can pick any of them up in the terminal with `claude --resume`. It also works the other way: sessions you started in the terminal show up in desk, ready to resume.

**Auto route** picks the model for you. Before each message, Haiku reads it and sends it to the cheapest level that fits: Sonnet for simple and ordinary coding, Opus when you're asking what to do or the problem is hard. That costs about two seconds and a fifth of a cent per message. Which model each level uses is up to you (Edit the routes, from the model pill).

**Crew mode** is for bigger jobs. An Opus planner splits your request into tasks and hands each one to the cheapest helper level that can do it well: a Haiku scout for reading, then Sonnet at medium, high and xhigh effort, then Opus at low, medium, high and xhigh. Failed tasks move up a level. You approve the plan first, and the side panel shows every task's level, any escalations, and cost per model. Helpers are loaded as a Claude Code plugin for that session only, so nothing is added to your normal Claude Code setup.

**Lean sessions** give Claude only the file and shell tools, which makes every step's prompt much smaller and so uses less of your limit. Toggle it with the pill in the header.

**Benchmarks.** `npm run bench -- "your prompt"` runs the same task solo, auto, solo-lean and crew-lean side by side (crew is there too) and prints the time, cost, tokens and test results for each. Add `--from ~/code/project` to run it on a copy of a real project. It uses your plan like any other session.

Other things it does: a real terminal in the page (Ctrl \`), a git Changes card with diffs, "open" on any file to start your editor on it in a terminal, and a theme switcher (Alt T). [CHANGELOG.md](CHANGELOG.md) has the full list.

There are two layouts. The **classic** layout has a sidebar, one session and an info panel. It comes in Catppuccin Mocha and Latte, Tokyo Night, Gruvbox, Nord, Rosé Pine and Everforest. **Riced** turns the page into a tiling desktop: every open session is its own window, with a waybar-style bar on top and a `desk.conf` you edit live. Switch between them in settings. [IDEAS.md](IDEAS.md) has where it could go next.

### Riced

Workspaces are projects. Windows tile Hyprland-style (dwindle, master or monocle), and the bar shows your usage limits as block meters. Press Alt C to open `desk.conf`, which controls colours (tokyonight, catppuccin, gruvbox, nord, rosepine, everforest), gaps, border gradients, rounding, font, bar position and wallpaper. Every change shows up as you type.

| keys (defaults) | does |
|---|---|
| Alt Enter | launcher: switch, resume, or start a session (type a folder path or a prompt) |
| Alt H J K L / arrows | move focus between windows |
| Alt 1 to 9 | switch workspace |
| Alt F | fullscreen the focused window |
| Alt Q | put the focused window away (history is kept) |
| Alt C | desk.conf |
| Alt I | info panel: to-dos, git changes, files touched, session stats, context |
| Ctrl ` | new terminal window |
| Alt T | themes (works in both layouts) |

Alt is the default modifier because the browser never sees the Super key. If your window manager already uses Alt (GlazeWM on Windows does), open Settings → Shortcuts, or "keyboard shortcuts" in the launcher, and switch to Ctrl Alt, Alt Shift or Ctrl Shift. You can also rebind any single shortcut there.

## Run it

You need Node 18 or newer and Claude Code installed and logged in (run `claude` once in a terminal to check).

```sh
git clone https://github.com/Squandit/coolclaudecode.git
cd coolclaudecode
npm install        # only needed for the built-in terminal
npm start          # opens http://localhost:4317
```

`npm install` fetches two small things: xterm.js (the terminal display) and node-pty with prebuilt binaries for Linux, macOS and Windows, so nothing gets compiled. Skip it and everything except the terminal still works.

Want to see it first without spending any usage? `npm run demo` starts it with made-up sessions and a fake Claude that goes through a scripted turn, permission prompts included. Demo mode never reads your real Claude Code history.

It runs the same way on Linux, macOS and Windows. You can pick a different port with `PORT=5000 npm start`, or `set PORT=5000` first on Windows cmd.

## How it works

`server.js` starts one `claude -p --input-format stream-json --output-format stream-json` process per session and talks to it over stdin/stdout. That's the same protocol the Agent SDK uses. Permission requests come back as `can_use_tool` control messages and the page answers them. The CLI reports your plan limits after each message in a `rate_limit_event`, and that's what feeds the usage bars.

desk keeps its own small bits of state (session list, settings, the last usage reading) in `~/.desk`. Set `DESK_HOME` to put them somewhere else. Claude Code's own transcripts stay where they always are, in `~/.claude/projects`.

The server only listens on `127.0.0.1`. It rejects requests that don't come from its own page: it checks the Host header, and every API call needs a random token baked into the page at startup. That matters because it can run code on your machine.

## Files

| | |
|---|---|
| `server.js` | HTTP server, session runner, history import |
| `demo.js` | Fake `claude` process and seeded sessions for `npm run demo` |
| `public/js/core.js` | Helpers, markdown, icons, the theme list |
| `public/js/pane.js` | One session's view (transcript, permission cards, composer) |
| `public/js/term.js` | Terminals, the git Changes card, theme picker, changelog |
| `lib/terminals.js` | Shells over node-pty |
| `lib/git.js` | git status and diffs |
| `lib/crew.js` | Crew levels, the helper plugin and the planner's instructions |
| `lib/router.js` | Auto route: the Haiku call that picks a model for each message |
| `bench.js` | Runs one prompt several ways and compares them |
| `public/js/classic.js` | The classic layout |
| `public/js/tiling.js` | The riced layout, desk.conf parsing and palettes |
| `public/js/app.js` | Boot, live updates, switching layouts |
| `public/app.css` | Shared components, colours come from the theme |
| `public/themes/riced.css` | The tiling desktop's styling |

## Adding a theme

Add a palette to `PALETTES` and an entry to `THEMES` at the top of `public/js/core.js`. It then shows up in the switcher and in settings. Riced gets its palette from `desk.conf`, so a new palette works there too (`colors = yourname`).

## Notes

The cost shown per turn and per session is what the CLI reports at API prices. On a subscription you aren't billed that; it's there as a rough measure of how heavy a session was.
