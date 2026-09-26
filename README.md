# Brewin Habits

An Obsidian plugin that tracks habits and vices as notes, and pays you in points for keeping them.

## What it does

- **Habits and vices.** A habit has a target to reach; a vice has an allowance not to exceed, so a
  clean day is one at or under it. Both can be yes/no or a count with a unit and a step per tap.
- **Cadence by RRULE** — `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO,WE,FR` — so "due today" is a real
  question with a real answer, and a missed day is only missed if it was due.
- **Streaks and a heatmap.** For a vice the streak counts consecutive *clean* days, which is the
  number worth having. Past cells in the heatmap are clickable: tapping one back-fills that day.
- **A points economy.** Completing a due habit earns points, a perfect day earns a bonus, and both
  are clawed back if you undo the completion. Points are spent attempting to cash in a reward you
  define — and the attempt is **chance-based**: every vice slipped today lowers the odds, and the
  points are spent whether the attempt wins or loses. The odds and the stake are always stated
  before the confirmation.
- **Cross-plugin backlog.** Falling behind elsewhere also lowers the odds: unmet habits, plus
  overdue tasks from Brewin Planner and missed sessions from Brewin Fitness, read from sibling notes
  in a shared folder. Past a threshold a cash-in is refused outright. All of it can be switched off.
- **Weekly review.** A command writes a frozen summary of the week's habits into the review note.

## The notes it reads

A habit is a note tagged `habit` in the habits folder:

```yaml
---
tags: [habit]
cadence: "FREQ=WEEKLY;BYDAY=MO,WE,FR"
kind: count          # binary | count
polarity: build      # build (a habit) | avoid (a vice)
target: 3000         # the minimum to reach, or for a vice the most you'll allow
unit: ml
step: 250
log:                 # date → value, written by the plugin
  2026-09-24: 3000
active: true
---
```

The reward catalogue, the points balance and the redemption history live in one `Rewards.md` note in
the same folder, so both are readable and editable without the plugin.

## Views, commands, settings

Two views — the habits pane and the analytics heatmap — on the `flame` ribbon icon. Commands: *Open
habits*, *New habit*, *Open analytics heatmap*, *Insert this week's habit summary*.

Settings cover the habits folder, the first day of the week, the heatmap length, the points economy
(per completion, perfect-day bonus, base chance, penalty per vice, minimum chance) and the
cross-plugin backlog (folder, window, penalty per item, hard-block threshold, and an off switch).

## Installing

Not in the community directory. Install from this repository with
[BRAT](https://github.com/TfTHacker/obsidian42-brat), or copy `main.js`, `manifest.json` and
`styles.css` into `<vault>/.obsidian/plugins/brewin-habits/` and enable it.

## Building

```bash
npm install
npm run dev      # watch
npm run build    # type-check, then bundle
npm test
```

The habit model, RRULE handling, analytics and reward arithmetic are pure modules with no Obsidian
imports; the stores, views and modals are not unit-tested.

## Caveats

Written for one vault, so the default folders match its layout; they are settings. The reward odds
are deliberately punitive — that was the point. No support is promised.

MIT licensed.
