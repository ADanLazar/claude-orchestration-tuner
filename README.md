# Tune

Tune is a plugin for Claude Code. It gives Claude a team of nine role
agents, each running at a chosen model and effort, and a short set of
working rules that say when to use them. It works from the moment it is
installed, with nothing to set up. When Claude works from a plan, Tune
can show how far the work has got. If you want to change how the team
runs, there is a panel for that.

It works in the Claude desktop app's Code tab and in Claude Code in a
terminal.

## What you get

- **Nine role agents.** Claude can hand work to a planner, an executor,
  a code reviewer, a test engineer, a writer, a debugger, a security
  reviewer, a designer and an investigator. Each has its own instructions
  and its own level. The investigator reads the code and the documents
  around a request and reports what it finds. It changes no file.
- **Working rules.** Claude decides first whether a job needs a team,
  gives each task to a fresh agent, reviews at each milestone, and puts
  correct behaviour ahead of speed and cost.
- **Questions before a large job.** Before a job of more than a few
  steps, Claude settles what is wanted. It asks only what would change
  what gets built, one question at a time. Where nothing is open, it
  says what it understood and starts. It uses its `tune:shape` skill for
  this, and sends the investigator to read an area too large to read in
  passing. How much it asks is the `questions` setting.
- **A plan as the record.** Claude keeps the plan file as the record of
  progress, and reports at each milestone.
- **A progress view** for the plan under way. You open it when you want
  to see it.
- **A row above the prompt** that shows the profile in use:
  `tune: build · exec sonnet/med · review opus/med`. While a plan is
  tracked, it also shows how many tasks are done:
  `tune: build · 3/7 tasks · exec sonnet/med · review opus/med`.
- **A panel** to change any of it, which you open when you want it and
  close when you are done: type `/tune`.

You do not have to do anything for the agents, the working rules or the
questions to apply.

## The shipped profile

A profile is a named set of levels and rules. Tune ships one, `build`:

| Who | Model | Effort |
| -- | -- | -- |
| You (the main conversation, recommended) | fable | high |
| planner | opus | high |
| executor | sonnet | medium |
| code-reviewer | opus | medium |
| test-engineer | sonnet | medium |
| writer | haiku | high |
| debugger | sonnet | high |
| security-reviewer | opus | medium |
| designer | sonnet | medium |
| investigator | sonnet | high |

Tune sets the levels of the nine agents. It cannot set the level of the
main conversation: it shows the recommended one, and tells you when you
are running at another effort (`/effort high` sets it).

## The panel

Type `/tune` to open it. Close it with its `close` button, the `✕` in its
corner, `/tune close`, or Esc while the panel has the keyboard. The row
above the prompt has a `panel` button that does both.

Where it appears depends on where you run Claude Code:

- **Desktop app:** beside the conversation.
- **Terminal, fullscreen layout:** at the side, in a window at least 110
  columns wide. Click in it to use it.
- **Terminal, classic layout** (the default): in a box above the prompt,
  which takes the keyboard until you close it. Typing `/tui fullscreen`
  switches the terminal to the layout that puts it at the side.

Inside the panel, click, or move with Tab and the arrow keys and press
Enter. No single key does anything by itself, so typing by mistake while
the panel is open changes nothing.

## Changing things

Open the panel. Everything in it applies to this computer at once.

- **Choose a level:** pick a model or an effort beside an agent's name.
- **Change a rule:** the pickers under "rules".
- **Make your own profile:** press `+ new`. It copies the profile in use
  and switches to the copy.
- **Switch profile:** press its name.
- **Delete one of your own:** press `delete`, then press it again.
- **Undo your changes to `build`:** press `reset to shipped`.
- **See the reasons:** `why these levels` shows what each model costs
  compared with Sonnet and what each effort level is for.

The first time you change `build`, Tune saves the result as your own copy
of it. Your copy stays as you left it when the plugin is updated. If an
update ever cannot read one of your profiles, the panel says so and keeps
it; nothing is deleted unless you delete it.

The same things can be typed, after `/tune` or in the panel's command
field:

| Command | Does |
| -- | -- |
| `/tune` | Opens the panel |
| `/tune close` | Closes it |
| `/tune list` | Your profiles; `*` marks the one in use |
| `/tune show [name]` | One profile's settings |
| `/tune use <name>` | Switches to a profile |
| `/tune new <name> [from <name>]` | Copies a profile |
| `/tune set <setting> <value> [in <name>]` | Changes one setting, for example `/tune set executor effort high` |
| `/tune set questions <value>` | How much Claude asks before a large job: `when-unclear`, `always` or `never` |
| `/tune set reports <value>` | When Claude reports: `each-milestone`, `each-task` or `on-request` |
| `/tune delete <name>` | Deletes one of your own profiles; it asks you to repeat the command with `yes` |
| `/tune reset <name>` | Returns a changed shipped profile to its shipped values |
| `/tune brief [name]` | Prints the working rules a profile gives Claude |
| `/tune why [name]` | Prints the reason for each level |
| `/tune status` | Prints the progress of the tracked plan as text, for you alone (see Progress) |
| `/tune track <path>` | Shows progress for a plan file, wherever it is |
| `/tune track off` | Stops showing progress |
| `/tune progress` | Opens the progress view |

The settings are `main.model`, `main.effort`, `<agent> model`,
`<agent> effort`, `team` (`when-split`, `always`, `never`), `agents`
(`fresh-per-task`, `may-continue`), `review` (`each-milestone`,
`each-task`), `questions` (`when-unclear`, `always`, `never`), `reports`
(`each-milestone`, `each-task`, `on-request`), `escalation` (`on`, `off`),
`order` (for example `correct, time, tokens`), `start_higher` (a list of
areas), and three that take free text: `summary`, `tests` and `notes`.
Whatever you put in `notes` is added to the rules Claude reads.

`questions` sets how much Claude asks before a job of more than a few
steps. `when-unclear` is the shipped value. `reports` sets when Claude
reports on progress. `each-milestone` is the shipped value.

A change of levels applies to the next agent Claude starts. A change of
rules is given to a conversation that is already open with its next
prompt.

## Progress

Tune can show how far a plan has got while Claude works on it.

A plan file is a Markdown file. Each task is a heading, and each step
under it is a checkbox:

```
### Task 1: Read the file
- [x] Open the file
- [ ] Parse the header
```

The agents that make changes tick each box as soon as its step is done:
the executor, the test engineer, the writer, the debugger and the
designer.

Claude tells Tune which plan to show. Tune accepts only a Markdown file
(`.md`) inside the project's folder. It reads the plan without asking
your permission each time, so it will not let Claude point it at files
outside the project. For a plan kept anywhere else, type
`/tune track <path>` yourself. `/tune track off` stops showing progress.

For a plan of three tasks, with the second under way, the view reads:

```
PROJ-12 · In Progress · Export to CSV · 1 of 3 · read just now
plan: docs/plans/export.md
All tasks   ███████░░░░░░░   1 of 3 done · 3 of 6 steps

✓ 1 Read the file              2/2   1m00s
▶ 2 Write the rows   ██░░░░░   1/3   0m40s   ~50s left
     executor sonnet / medium
· 3 Tests                      0/1
```

The first line is the tracker item, if Claude named one. Where the
project has a tracker that Claude can read, Claude names the work by its
item there, in the tracker's own words. Tune never contacts a tracker.
Its working rules tell Claude to change nothing in a tracker unless the
project's instructions or you say so.

- **The count** in the row is the number of tasks with every box ticked.
- **The bars** count finished steps. Each bar is the share of its
  task's steps that are ticked.
- **The marks** show where each task stands:

  | Mark | Meaning |
  | -- | -- |
  | `·` | waiting |
  | `▶` | running: an agent is working on it |
  | `✓` | done: every box is ticked |
  | `!` | to check: the agent said it finished, and boxes are still open |
  | `✗` | stopped: the agent failed or was stopped |

- **The times** count only while the task's agent is running.
- **The estimates** are only for a task an agent is working on. An
  estimate is that agent's pace so far, times the steps left. It is
  written with `~` and counts down. When the time runs out, the view
  reads `longer than estimated`. `no estimate yet` means there is no
  pace to go on yet: the agent has ticked no step, and no task of the
  plan has been finished by an agent.
- **An agent in its own worktree** has no estimate, and its bar does not
  move. Its row shows the time taken only. Claude ticks that task's
  boxes from the agent's report.

The view opens only when you ask. Type `/tune progress`, press the
`progress` button in the row, or press `progress` in the panel. The row's
`progress` button appears while a plan is tracked or an agent is running.
The view appears where the panel does (see The panel).

The progress view does not take the keyboard: you can keep typing while
it is open. Esc does not close it. Close it with `/tune close`, its
`close` button, or the row's `progress` button.

`/tune status` prints the same counts as text, for you alone: the text
stays out of Claude's later requests. It answers between turns. A
command typed while Claude is in the middle of a turn waits until the
turn ends. The progress view is what updates while Claude works.

Progress is kept for the session only. It is forgotten when the session
ends, including on `/clear`. The plan file's ticked boxes are the lasting
record. In a later session, Claude tells Tune the plan again, the bars
come from the file, and the times start again.

The desktop app has not been tried with the progress view.

## What it does not do

- It sends nothing anywhere and keeps no record of what you do.
- Apart from ticking the boxes in a plan file, it changes no file of
  yours. Your own profiles are kept in one file in Claude Code's own
  storage for plugins (see "Remove").
- Progress is held for the session only (see Progress). The plan's path
  and the tracker item are shown in the view. They are not written into
  the plan or into the tracker.
- It does not override your own instructions: where they disagree with
  Tune's rules, yours win.

## Install

In the Claude desktop app: click `+` next to the prompt box, then
**Plugins**, then **Add marketplace**, and enter
`ADanLazar/claude-orchestration-tuner`. Then add the plugin `tune`.
(These steps are from Claude Code's documentation and have not yet been
tried with this plugin.)

In a terminal:

```
claude plugin marketplace add ADanLazar/claude-orchestration-tuner
claude plugin install tune@claude-orchestration-tuner
```

Start a new session afterwards.

## Update

```
claude plugin marketplace update claude-orchestration-tuner
claude plugin update tune@claude-orchestration-tuner
```

Then start a new session. A machine does not take a new version by
itself. The desktop app's Plugins screen should offer the same update;
that has not been checked. Your own profiles and your choice of profile
are kept through an update.

## Remove

```
claude plugin uninstall tune@claude-orchestration-tuner
```

Nothing of Tune then runs. Your own profiles stay in one file, so that a
reinstall finds them: the file whose name starts with
`tune_claude-orchestration-tuner` in `~/.claude/plugins/store/`. Delete
it to remove them too.

## If something looks wrong

- **There is no row above the prompt and `/tune` is not known.** The
  panel is built on a part of Claude Code that is still in early access,
  and some plans or versions do not load it. The nine agents, the
  `tune:shape` skill and the ticking of boxes still work at the shipped
  levels. The working rules, the progress view and the panel are missing.
- **The row says `tune: not loaded`.** The plugin's own files could not
  be read. Reinstall it.
- **The panel says your own profiles could not be read.** Tune is using
  `build` and has left what is stored alone. Removing the storage file
  named under "Remove" starts afresh.
- **The progress view says `No plan is tracked`.** Claude has not told
  Tune which plan to show. Ask Claude for the plan's path, or type
  `/tune track <path>` yourself.
- **The progress view says `The plan file could not be read`.** The
  counts shown are the last ones Tune read. Check that the file is still
  where Claude said it was.
- **A conversation you reopened follows older rules.** A conversation
  keeps the rules it began with until the rules next change.

## For whoever maintains this

Tested on Claude Code 2.1.332. In a real run, each of the five agents
that tick their boxes ticked every box, in order.

```
claude plugin test plugin        # the mod's tests
claude plugin validate plugin    # what Claude Code will accept
node scripts/check.mjs           # the agent files, the skill and the shipped profile
```

- `plugin/agents/*.md` are the nine agents. Their `model` and `effort`
  lines must equal `plugin/profiles/build.json`; `check.mjs` fails if
  they do not. These files are what runs when the mod does not load.
- `plugin/skills/shape/SKILL.md` is the `tune:shape` skill. It is
  checked for its name and description, and for its length.
- `plugin/hooks/` is the mod: `profile.ts` (the settings and their
  values), `brief.ts` (the rules as text), `store.ts` (shipped and own
  profiles), `apply.ts` (the levels put on the agents), `commands.ts`
  (`/tune` with words), `plan.ts` (reads a plan's tasks and steps, and
  works out which task a prompt names), `progress.ts` (what is known
  about a plan's progress, as plain data) and `register.tsx` (the hooks,
  the row, the panel and the progress view).
- `check.mjs` checks each agent file against the shipped profile: its
  name, model, effort and description. It checks that the agents that
  only read carry `disallowedTools: Write, Edit`, that only the agents
  that tick boxes carry the ticking line, and that the planner carries
  the plan format line. It checks the length of each prompt and of the
  skill. It checks that the ticking agents in `plan.ts` are the ones in
  `check.mjs`, that the shipped profile matches the one the tests use,
  and that its rules fit the length limit. It checks that the mod can
  read each agent file, that the version is `x.y.z`, and that no shipped
  file holds a word that must not ship.
- To release: raise `version` in `plugin/.claude-plugin/plugin.json`,
  commit and push. A profile saved by an older version is brought to the
  new shape when it is read: a setting or agent it lacks takes the
  shipped value and is marked `new` in the panel.

## Licence

MIT. See `LICENSE`.
