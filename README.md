# Brewin Habits

An Obsidian plugin that tracks habits and vices as notes, and pays you in points for keeping them.

## What it does

- **Habits and vices.** A habit has a target to reach; a vice has an allowance not to exceed, so a
  clean day is one at or under it. Both can be yes/no or a count with a unit and a step per tap.
- **Cadence by RRULE** — `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO,WE,FR` — so "due today" is a real
  question with a real answer, and a missed day is only missed if it was due.
- **Streaks and a heatmap.** For a vice the streak counts consecutive *clean* days, which is the
  number worth having. Past cells in the heatmap are clickable: tapping one back-fills that day.
- **Pausing.** A habit you've set aside can be paused from its card's ⋯ menu: it stops being due,
  can't be missed, and drops out of the backlog, but keeps its history and stays listed under
  *Paused* to resume.
- **A points economy.** Completing a due habit earns points, a perfect day (every due habit done,
  every vice within its allowance) earns a bonus, and undoing either takes back exactly what it gave
  — so the balance can dip below zero if you unmark habits whose points you've spent. A vice never
  costs points directly. Points are spent attempting to cash in a reward you define, and the attempt
  is **chance-based**: every vice over its allowance today lowers the odds, and the points are spent
  whether the attempt wins or loses. The odds and the stake are always stated before the
  confirmation.
- **Cross-plugin backlog.** Falling behind also lowers the odds: each build habit that missed a due
  day in the last week (counted once, and never for today, which is still open), plus overdue tasks
  from Brewin Planner and missed sessions from Brewin Fitness, read from sibling notes in a shared
  folder. Past a threshold a cash-in is refused outright. All of it can be switched off.
- **Weekly review.** A command writes a frozen summary of the week's habits into the review note.
- **The day note and the reviews.** A read-only `api.day("YYYY-MM-DD")` returns the habits due that
  day — what was logged, hit / missed / pending, a vice's slip, and the streak as it stood that day.
  `api.range(from, to)` gives each habit's due, hit, missed and slip counts over any stretch of days,
  with the streak as it stood at the end, for the weekly and monthly review notes. Both are called from
  dataviewjs.

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

The plugin writes `Habits Backlog.md` in the accountability folder: `habits_behind` (the backlog
figure above, which Brewin Planner's digest reports), plus `due_unmet_count` and `backlog_days` for
information.

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

The habit model, RRULE handling, analytics, backlog and reward arithmetic are pure modules with no
Obsidian imports; the stores, views and modals are not unit-tested.

Every write is a read-modify-write of the note's own frontmatter inside one `processFrontMatter`
call, and the stores serve what they just wrote until Obsidian's metadata cache catches up. Reading
back through the cache straight after a write sees the old value, which is how 1.3.0 never awarded
points and dropped quick repeat taps.

## Caveats

Written for one vault, so the default folders match its layout; they are settings. The reward odds
are deliberately punitive — that was the point. No support is promised.

MIT licensed.
