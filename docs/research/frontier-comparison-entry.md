# The entry of the comparative scenario: the main loop of the measurement project

Status: documentation, a change in the runner (`scripts/frontier-comparison-run.mjs`), in the header and the first lines of the scenario (`tests/frontier-comparison-scenario.gd`) and in their tests. It belongs to the criterion `execucao` of
V05-10 and **closes nothing**: no comparative execution has happened, and **this note states no result**. The rehearsal behind its counts is a Debug, headless, one-execution-per-arm rehearsal, recorded in the
[evidence record](../evidence/frontier-comparison-entry/README.md); it moves no checkpoint, grade, weight or denominator of the 1.0. The rest of the execution is in [the execution note](frontier-comparison-execution.md).

## The question

Until this slice the scenario ran as `godot --path <copy> --headless|--windowed -s res://comparison/frontier-comparison-scenario.gd -- --arm=… --lane=… --out=…`. The campaign has to run **the same script** in the Release export of the
game, and an export template does not take `-s`. The scenario therefore has to be what a project can name for itself: its **main loop**. Debug and Release then enter the same way, and the arms still read the same things.

## Why `-s` does not work in an export template

Read from the source of Godot 4.7.2-stable (commit `ed1daf0bf`, the one of `dependencies.json`); the line numbers are those of that tag.

- The official export templates are built with `disable_path_overrides`, whose default is on (`SConstruct` 272-278). `OVERRIDE_PATH_ENABLED` is defined only for the editor or when that option is off (1101-1102).
- Without it, `main/main.cpp` aborts on `--path` (1768-1786), `--main-pack` (1864-1896) and `--scene` (4076-4112), and it takes `-s`/`--script` and `--main-loop` and **throws them away without a message** (4322-4333): the project's
  main scene runs instead.
- What a template does take: `--headless`, `--windowed`, `--rendering-driver`, `--fixed-fps`, `--disable-vsync`, `--print-fps` and the user arguments after `--` (`OS.get_cmdline_user_args()`). The scenario reads only the last.

## What works in a template

- **`application/run/main_loop_type`** with the name of a global class: the engine loads the class' script, instantiates its base type and sets the script on it (4364-4365, 4394-4411). The registry of global classes always enters an export
  (`editor/export/editor_export_platform.cpp` 1249).
- The project needs a **`run/main_scene`** too, or the boot aborts (`main.cpp` 2342-2351, 4335-4347). That scene is instantiated and added to the tree before the main loop starts (4760-4768), so it is the `current_scene` when the
  scenario's `_initialize` runs.

## What the runner writes into the copy

`prepareProject` writes three files into the provisioned copy of civ-lite, after the copy of the scenario's files; their text is a constant of the runner (`MEASUREMENT_FILES`).

| File in the copy | What it is | SHA-256 of its text |
| --- | --- | --- |
| `comparison/frontier-comparison-entry.gd` | Two lines: `class_name FrontierComparisonEntry` and `extends "frontier-comparison-scenario.gd"` (the scenario, by its relative name). It is the main loop's class. It lives in the copy and not in `tests/`, so that no global class is registered in the repository's own project. | `db3a43b4899cfb7aff3151dabadf20a1b022ba84684449c9972a549b4b2abc06` |
| `comparison/frontier-comparison-empty.tscn` | The main scene: one empty `Node`. | `89caa232be3c3deebc55224b526538cad3d692f9828ba1ad47573400f354e204` |
| `override.cfg` | `config_version=5` and, in `[application]`, `run/main_scene` (the empty scene) and `run/main_loop_type="FrontierComparisonEntry"`. The product's `project.godot` is not touched. | `53405dd2d4a2fef3bebf622ae3d39316b74fd384bafaa5552f304e30734ba560` |

The class is new to the project, and the cold editor run that the runner does before the copy had not seen it, so after the copy the runner runs the editor's `--import` once. It refreshes `.godot/global_script_class_cache.cfg`,
which is where the engine finds a main loop by its class name. `config_version=5` keeps the engine from running the conversion of the oldest format over every setting when it reads the file (`_convert_to_last_version`, 626-649).

## Where `override.cfg` is read

`ProjectSettings::_setup` (`core/config/project_settings.cpp`) reads it, every time under `OVERRIDE_ENABLED`. That is on unless the build says `disable_overrides` (`SConstruct` 271 and 1098-1099, default off), and it is **not** the
`OVERRIDE_PATH_ENABLED` of the section above: the template that loses `--path` and `-s` keeps `override.cfg`.

| How the project starts | Where `override.cfg` comes from | Lines |
| --- | --- | --- |
| `godot --path <dir>` with the editor's binary (the Debug launcher, the rehearsals) | the project folder, `<dir>/override.cfg`, right after its `project.godot` | 831-835 |
| an exported project, with its pack found | `res://override.cfg` **inside the pack**, then `override.cfg` in **the folder of the executable** | 755-756 |
| a macOS `.app` | the pack is looked for in `Contents/Resources` (730), so the folder of the executable is **`Contents/MacOS/`** | 755-756 |
| a project loose in the bundle's `Resources`, with no pack | `Contents/Resources/override.cfg` | 805 |
| `--main-pack` (the editor's binary; a template aborts on it) | the folder of the pack | 700 |

It is skipped when the project sets `application/config/disable_project_settings_override` (its default is false, line 1705; civ-lite does not set it). The product's `project.godot` stays as it ships, which is why the settings are here and
not there.

## The hashes

`override.cfg` is out of the **package's** hash (`PACKAGE_EXCLUDED` is now `.godot`, `comparison/` and `override.cfg`), so the package stays the provisioned copy as the product ships it. The entry, the empty scene and `override.cfg`
are in the **scenario's** hash, by path and by the SHA-256 of their text (`scripts` of `prepareProject`, built by `scriptsOf`), together with the scenario's files and the support files. A change to any of the three texts
changes the scenario's hash; a change to the settings does not change the package's. The package's own hash still depends on the commit and on whether the working tree is dirty
(`scripts/pack-addon.mjs` writes both into the copy's `manifest.json`: [the short rehearsal](frontier-comparison-execution.md#the-short-rehearsal)), so a value of it belongs to the run that read it.

## What changes in the boot: the empty scene is freed

Through `-s` there was no main scene. Through the main loop the empty scene is in the tree, and `scene-nodes` is the tree's `get_node_count()`. So the scenario's `_initialize` first removes `current_scene` from the root and frees it when
its `scene_file_path` is the empty scene (`drop_empty_scene`), before the instrument starts and before the arm is instantiated. With `-s` the function finds no scene and does nothing. The rest of the scenario is as it was, but for
its header and one field of the report, `provenance.mainLoop`: `FrontierComparisonEntry` through the entry and `""` through `-s`. The analysis does not read it.

**The negative control.** The scenario in the copy, without the call, in arm A: `scene-nodes` reads **5** instead of 4. The empty scene is in the tree when `_initialize` runs, and the call is what takes it out.

## The same counts through the entry and through `-s`

The three arms, headless, presented lane, on one provisioned copy: through the entry, and through `-s` with `override.cfg` removed (the scenario's own file, the old way). `comparison.json` in the evidence record holds both.

| | A | B | C |
| --- | --- | --- | --- |
| `scene-nodes`, main loop / `-s` | 4 / 4 | 31 / 31 | 30 / 30 |
| replay golden hash | `cb7ab974…` | `cb7ab974…` | `cb7ab974…` |
| soak final hash (100 turns, 429 decisions, no refusal) | `0b21c332…` | `0b21c332…` | `0b21c332…` |
| occurrences of `ai-phase`, `event-burst`, `context-switches`, `stress` | 100, 100, 74, 32 | 100, 100, 74, 32 | 100, 100, 74, 32 |
| parity checks (all matching) | none, no HUD | 93 | 93 |
| notifications emitted / consumed | 2256 / none | 2306 / 2306 | 2307 / 2307 |

The counts of the trace by kind, the measured occurrences and frames of each window, the idle frames, the switches, the stress rounds and the clicks of the latency pass are the same too, and the windows, the hashes and the parity are those of the last
rehearsal through `-s` ([its record](../evidence/frontier-comparison-execution/README.md); it did not record `scene-nodes`, so that one is the control's). **No time is compared.** `tests/frontier-comparison-run-native.test.mjs` keeps the
control for arm A.

## The probe in an official release template

A scratch probe, run once and **not kept**: the binary and the `.app` were deleted afterwards for lack of disk, and only the method and what it printed are recorded here. A probe project (a main scene that prints, and a `ProbeLoop`
class that prints in `_initialize`) was exported as a pack (SHA-256 of the pack `51418ac8…`). Around the pack went an unsigned `Probe.app` made of the `godot_macos_release.universal` of the `macos.zip` in the pinned export templates (SHA-256
`6135ad13…`), with the pack in `Contents/Resources/Probe.pck`, run from another working directory:

- with no `override.cfg`: the main scene ran;
- with `-s res://probe_loop.gd`: the main scene ran, and the engine's command line still held `-s` (it is discarded, not refused);
- with `Contents/MacOS/override.cfg` naming `run/main_loop_type="ProbeLoop"`: the class of the pack ran as the main loop, with the main scene already the `current_scene` in its `_initialize`, and the user arguments after `--` arrived.

That is the Release path of the entry, seen in a template. It is **not** the export of civ-lite, and the app was not signed.

## What is not shown

- **The export of civ-lite as a Release `.app` in the three arms.** The entry is defined and tried in a template with a probe; the Release launcher still refuses until the game is exported ([What is missing](frontier-comparison-execution.md#what-is-missing-for-the-campaign)).
- **Where the export puts `override.cfg`.** In the pack, it depends on what the export includes (not tried); beside the executable, it sits in `Contents/MacOS/` (the probe's case), and what that does to the bundle's signature was
  not tried. The export slice decides it.
- **The instrument's self-check in a template.** Its probe is run with `-s` in the editor's binary today and needs the same entry there.
- The official templates are taken not to set `disable_overrides`; the probe is what shows it for the macOS release template of 4.7.2. The other platforms were not looked at.

## Reproducing

```sh
node --test tests/frontier-comparison-run.test.mjs     # Node only: the arguments, the texts, the hashes, the Release refusal
npm run test:frontier-comparison-run                    # native, headless: the rehearsal through the entry, and arm A against the -s control
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --assume-refresh-hz 60 --out build/frontier-comparison-rehearsal
```
