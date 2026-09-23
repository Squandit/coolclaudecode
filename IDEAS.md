# Theme ideas

desk ships with Catppuccin Mocha (the clean classic layout) and Riced (a tiling desktop). Everything below is a direction to branch off into. The simple ones only need a new token file in `public/themes/`. The bigger ones change the layout too, so they'd get their own branch.

## Riced desktop (started, it's the "Riced" theme)

The whole window is a tiling desktop, the kind you'd post to r/unixporn. Each session is its own terminal window, tiled like i3 or Hyprland: gaps between windows, a coloured border on the focused one, a title bar with the project name and branch. Open a new session and the layout splits to make room for it. Close one and the others fill the space.

A bar across the top works like waybar or polybar. It holds workspaces (one per project), a clock, and the plan usage as small modules: `5h 42%`, `wk 88%`, each with its own colour. When a session needs you, its window border flashes and a notification slides in from the corner, dunst style.

The fun part is that the config is the settings page. You'd edit a fake `~/.config/desk/config` in a text pane (gaps, border width, bar position, font, colours) and the desktop redraws live as you type. Ship a few presets (a Catppuccin one, a Gruvbox one, a Nord one), let people save their own, and share a rice as a single file.

The conversation itself renders in the terminal windows like a real TUI. Tool calls show as prompt lines, diffs are coloured the way `git diff` does it, and there's a blinking block cursor while Claude is working.

Still to do: dragging windows to swap them, resizing splits with the mouse, saving named rices and sharing them as a file, and a scratchpad workspace you can toggle in and out.

## Kitchen ticket rail

Sessions are order tickets clipped to a steel rail across the top. The active ticket fills the screen like the pass in a restaurant kitchen. Statuses use kitchen slang: "firing" while it works, "order up" when it's done, "86'd" on an error. A bell rings when a session needs you. The usage sits bottom left as gas burner dials, with flames that shrink as the 5-hour window runs down.

## Departures board

Sessions are flights on a split-flap board, and the letters clack over when a status changes (BOARDING, DELAYED, GATE CHANGE: NEEDS YOU). Opening a session shows it as a boarding pass. Weekly usage is a fuel gauge and the 5-hour reset is a countdown clock. Heavy sans type on black and yellow.

## Handheld console

A chunky pixel UI where your usage limits are HP and MP bars in the corner. Tool calls show up as battle text ("Claude used EDIT! style.css took +12 −3") and the cost counter is your gold. It's the most fun of the lot, but it might wear thin over a full working day.

## Swiss poster

No metaphor at all. Huge bold grotesk type, a strict grid and one loud colour per project. The session title is set at 120px and the usage bars are thick flat blocks with the percentage printed massive next to them. This is the one you'd keep open eight hours a day.

## Mission control, 1969

Beige-grey console panels, amber readouts and needle gauges for context and usage. Model, effort and permissions become physical toggle switches, and the conversation prints on a teleprinter roll.

## Thermal receipts

Every turn prints as a receipt that curls at the bottom: one line item per tool call, then a subtotal of tokens. Old turns go on a spike. It's funny and easy to read, but it's a one-joke theme.

## Pen and paper

This is the one that started it all: an Instagram post of a Claude Code UI where every session is a napkin. It has torn paper cards, handwriting and a fern in the background. It's already been done, so it's here for reference more than as a plan.

## Smaller things worth doing whatever the theme is

- The Catppuccin Latte, Frappé and Macchiato flavours. They're one token file each.
- A split view that shows two sessions side by side.
- "Rewind files": undo Claude's edits back to any turn.
- A per-project CLAUDE.md editor in the side panel.
- Sound effects you can switch off: a soft tick when a turn finishes, something louder when a session needs you.
