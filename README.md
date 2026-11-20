# Tune

Tune is a plugin for Claude Code. It gives Claude a team of eight role
agents, each running at a chosen model and effort, and a short set of
working rules that say when to use them. It works from the moment it is
installed, with nothing to set up. If you want to change how the team
runs, there is a panel for that.

It works in the Claude desktop app's Code tab and in Claude Code in a
terminal.

## What you get

- **Eight role agents.** Claude can hand work to a planner, an executor,
  a code reviewer, a test engineer, a writer, a debugger, a security
  reviewer and a designer. Each has its own instructions and its own
  level.
- **Working rules.** Claude decides first whether a job needs a team,
  gives each task to a fresh agent, reviews at each milestone, and puts
  correct behaviour ahead of speed and cost.
- **A row above the prompt** that shows the profile in use:
  `tune: build · exec sonnet/med · review opus/med`
- **A panel** to change any of it: press `panel` on that row, or type
  `/tune`.

You do not have to do anything for the first two to apply.

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

Tune sets the levels of the eight agents. It cannot set the level of the
main conversation: it shows the recommended one, and tells you when you
are running at another effort (`/effort high` sets it).

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
of it. Your copy stays as you left it when the plugin is updated.

The same things can be typed, after `/tune` or in the panel's command
field:

| Command | Does |
| -- | -- |
| `/tune` | Opens the panel |
| `/tune list` | Your profiles; `*` marks the one in use |
| `/tune show [name]` | One profile's settings |
| `/tune use <name>` | Switches to a profile |
| `/tune new <name> [from <name>]` | Copies a profile |
| `/tune set <setting> <value> [in <name>]` | Changes one setting, for example `/tune set executor effort high` |
| `/tune delete <name>` | Deletes one of your own profiles |
| `/tune reset <name>` | Returns a changed shipped profile to its shipped values |
| `/tune brief [name]` | Prints the working rules a profile gives Claude |
| `/tune why [name]` | Prints the reason for each level |

The settings are `main.model`, `main.effort`, `<agent> model`,
`<agent> effort`, `team` (`when-split`, `always`, `never`), `agents`
(`fresh-per-task`, `may-continue`), `review` (`each-milestone`,
`each-task`), `escalation` (`on`, `off`), `order` (for example
`correct, time, tokens`), `start_higher` (a list of areas), and three
that take free text: `summary`, `tests` and `notes`. Whatever you put in
`notes` is added to the rules Claude reads.

A change of levels applies to the next agent Claude starts. A change of
rules is given to a conversation that is already open with its next
prompt.

## What it does not do

- It sends nothing anywhere and keeps no record of what you do.
- It changes no file on your computer. Your own profiles are kept in the
  plugin's own storage inside Claude Code.
- It does not override your own instructions: where they disagree with
  Tune's rules, yours win.

## Install

In the Claude desktop app: click `+` next to the prompt box, then
**Plugins**, then **Add marketplace**, and enter
`ADanLazar/claude-orchestration-tuner`. Then add the plugin `tune`.

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
  and some plans or versions do not load it. The eight agents still work
  at the shipped levels; the rules and the panel are missing.
- **The row says `tune: not loaded`.** The plugin's own files could not
  be read. Reinstall it.
- **The panel says your own profiles could not be read.** Tune is using
  `build` and has left what is stored alone. Removing the storage file
  named under "Remove" starts afresh.
- **A conversation you reopened follows older rules.** A conversation
  keeps the rules it began with until the rules next change.

## For whoever maintains this

Tested on Claude Code 2.1.329.

```
claude plugin test plugin        # the mod's tests
claude plugin validate plugin    # what Claude Code will accept
node scripts/check.mjs           # the agent files against the shipped profile
```

- `plugin/agents/*.md` are the eight agents. Their `model` and `effort`
  lines must equal `plugin/profiles/build.json`; `check.mjs` fails if
  they do not. These files are what runs when the mod does not load.
- `plugin/hooks/` is the mod: `profile.ts` (the settings and their
  values), `brief.ts` (the rules as text), `store.ts` (shipped and own
  profiles), `apply.ts` (the levels put on the agents), `commands.ts`
  (`/tune` with words) and `register.tsx` (the hooks, the row, the
  panel).
- To release: raise `version` in `plugin/.claude-plugin/plugin.json`,
  commit and push. A profile saved by an older version is brought to the
  new shape when it is read: a setting or agent it lacks takes the
  shipped value and is marked `new` in the panel.

## Licence

MIT. See `LICENSE`.
