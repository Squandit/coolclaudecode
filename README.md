# desk

A local web UI for Claude Code. Several sessions run side by side, and permission prompts show up as allow/deny cards. Your plan's 5-hour and weekly usage sits in the bottom-left corner. The side panel shows the to-do list, the files touched, the session's stats and a context bar.

It drives the `claude` CLI you already have installed, so it uses your existing login. That works with a Pro or Max subscription, and you don't need an API key. Every session is a normal Claude Code session, which means you can pick any of them up in the terminal with `claude --resume`. It also works the other way: sessions you started in the terminal show up in desk, ready to resume.

There are two themes so far. **Catppuccin Mocha** is the classic layout: sidebar, one session, info panel. **Riced** turns the page into a tiling desktop: every open session is its own window, with a waybar-style bar on top and a `desk.conf` you edit live. Switch between them in settings. [IDEAS.md](IDEAS.md) has where it could go next.

### Riced

Workspaces are projects. Windows tile Hyprland-style (dwindle, master or monocle), and the bar shows your usage limits as block meters. Press Alt C to open `desk.conf`, which controls colours (tokyonight, catppuccin, gruvbox, nord, rosepine, everforest), gaps, border gradients, rounding, font, bar position and wallpaper. Every change shows up as you type.

| keys | does |
|---|---|
| Alt Enter | launcher: switch, resume, or start a session (type a folder path or a prompt) |
| Alt H J K L / arrows | move focus between windows |
| Alt 1 to 9 | switch workspace |
| Alt F | fullscreen the focused window |
| Alt Q | put the focused window away (history is kept) |
| Alt C | desk.conf |
| Alt I | info panel: to-dos, files touched, session stats, context |

Alt is the modifier because the browser never gets the Super key.

## Run it

You need Node 18 or newer and Claude Code installed and logged in (run `claude` once in a terminal to check). There are no dependencies to install.

```sh
git clone https://github.com/Squandit/coolclaudecode.git
cd coolclaudecode
npm start          # opens http://localhost:4317
```

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
| `public/js/classic.js` | The classic layout |
| `public/js/tiling.js` | The riced layout, desk.conf parsing and palettes |
| `public/js/app.js` | Boot, live updates, switching layouts |
| `public/app.css` | Shared components, colours come from the theme |
| `public/themes/mocha.css` | Catppuccin Mocha tokens |
| `public/themes/riced.css` | The tiling desktop's styling |

## Adding a theme

Copy `public/themes/mocha.css`, change the values, and add an entry to `THEMES` at the top of `public/js/core.js`. It then shows up in settings. A theme with `layout: 'tiling'` gets the riced desktop, and its CSS can restyle all of it.

## Notes

The cost shown per turn and per session is what the CLI reports at API prices. On a subscription you aren't billed that; it's there as a rough measure of how heavy a session was.
