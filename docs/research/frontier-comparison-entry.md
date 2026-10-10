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
- **The instrument's self-check in a template.** Its probe needs the same entry, and [has it now](#the-instruments-self-check-through-the-main-loop) in the editor's binary; as an exported `.app` it is not made yet.
- The official templates are taken not to set `disable_overrides`; the probe is what shows it for the macOS release template of 4.7.2. The other platforms were not looked at.

## Reproducing

```sh
node --test tests/frontier-comparison-run.test.mjs     # Node only: the arguments, the texts, the hashes, the Release refusal
npm run test:frontier-comparison-run                    # native, headless: the rehearsal through the entry, and arm A against the -s control
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --assume-refresh-hz 60 --out build/frontier-comparison-rehearsal
```

## The projects of the arms

Status: code (`scripts/frontier-comparison-arms.mjs`), its tests and a native check. It belongs to the criterion `execucao` of V05-10 and **closes nothing**: **no export was made, no campaign was run, and this section states no result.**
The check behind its counts is a Debug, headless, one-execution-per-arm check on one provisioned copy; no time of it is compared, and no number of it is a measurement of an arm.

### The decision

Arms **A** (no HUD, `main_bare.tscn`) and **B** (the HUD in GDScript, `main_native.tscn`) are built **without the Fabric extension**: no `addons/godot_fabric`, which is the addon, the `.gdextension`, the host and the Hermes and React Native frameworks. Only **C** (`main.tscn`) carries it. It was agreed with
the owner of the macOS export (V05-07), for two reasons:

- The protocol reads the price of each HUD in package size as **C − A** and **B − A**. If A and B carried the extension, the difference would not price the HUD: it would leave out the extension.
- The load of the extension would also enter the execution measures of A and B, and A is the arm that stands for the game with nothing else.

If a scene of A or B, or the `GameServices` in them, depended on the extension at parse time, that would be a defect of the arm, to fix in the arm, and not a reason to ship React Native. The check below is what shows they do not. How each arm was put together is part of the provenance of its report.

### What each arm carries

| | A | B | C |
| --- | --- | --- | --- |
| product's main scene (`run/main_scene` in `project.godot`) | `res://main_bare.tscn` | `res://main_native.tscn` | `res://main.tscn` |
| `addons/godot_fabric` | no | no | yes |
| `[editor_plugins]` and `[godot_fabric]` in `project.godot` | removed | removed | kept |
| the measurement project | the product plus `comparison/` and `override.cfg` | the same | the same |

The measurement project is the product's project plus the files that `prepareProject` writes (`MEASUREMENT_FILES`, [above](#what-the-runner-writes-into-the-copy)). Its `override.cfg` goes **inside the package** (`res://override.cfg`) and overrides the main scene and the main loop, so the
product's own main scene is not what a measured process runs. The package of the `package-size` axis is the product's, without the comparison files.

### The filters

`armProject(arm)` is a pure function that returns, for each arm, the main scene, whether it carries the extension, and the export filters of the product and of the measurement project. The filters are written the way `export_presets.cfg` writes `include_filter` and `exclude_filter`
(the preset of `scripts/macos-export.mjs` writes both as empty strings today, with `export_filter="all_resources"`): globs relative to `res://`, separated by commas.

| | `include_filter` | `exclude_filter` |
| --- | --- | --- |
| product, A and B | (empty) | `comparison/*, override.cfg, addons/godot_fabric/*` |
| product, C | (empty) | `comparison/*, override.cfg` |
| measurement, A and B | `comparison/*, override.cfg` | `addons/godot_fabric/*` |
| measurement, C | `comparison/*, override.cfg` | (empty) |

The patterns for the measurement files are read off `MEASUREMENT_FILES`, so a file added to it is in the filters. An unknown arm is refused with an error. The exclusion of the addon is a second guard in A and B: the directory that the function below prepares does not hold it.

### What is done to a copy

`shapeArmProject(directory, arm, { measurement })` applies that description to a provisioned copy:

- in A and B it removes `addons/godot_fabric` and the sections `[editor_plugins]` and `[godot_fabric]` of `project.godot` (a section that was last takes with it the blank line that separated it), and the two artifacts that the extension and C's HUD leave in a copy that was built with them:
  `.godot/extension_list.cfg` (the list of extensions the editor keeps, which the import regenerates) and `.godot_fabric/` (the HUD's build output: `app.js`, its assets and a report);
- in every arm it writes the product's `run/main_scene`;
- with `measurement` it writes the `MEASUREMENT_FILES`;
- it returns what changed: the main scene (from and to), the sections removed, whether the folder was there, which of the two artifacts were there, and the files written.

`project.godot` is Godot's INI text, and it is edited by lines, keeping each line's ending: only the two sections and the value of `run/main_scene` change. On the real `consumers/civ-lite/project.godot` the rest comes out byte for byte (`tests/frontier-comparison-arms.test.mjs`). Of the `.godot` folder it touches only
the list of extensions (the rest of the engine's cache stays), and it never removes the measurement files.

### The check: A and B run the whole script without the extension

`npm run test:frontier-comparison-arms` (`tests/frontier-comparison-arms-native.test.mjs`) provisions **one** copy with the runner's `prepareProject` and runs, in it and in this order: A and B with the extension; the shape of A without it, with the measurement; the editor's `--import`; A; the shape of B; B.
Each run is a Godot process that enters the script as the main loop of the measurement project, as above. As a control, C runs in the same copy at the end.

| count of the scenario | A with / without | B with / without |
| --- | --- | --- |
| exit code, script errors, errors of the log | 0, 0, 0 / 0, 0, 0 | 0, 0, 0 / 0, 0, 0 |
| `scene-nodes` | 4 / 4 | 31 / 31 |
| replay golden hash | `cb7ab974…` / `cb7ab974…` | `cb7ab974…` / `cb7ab974…` |
| soak final hash (100 turns, 429 decisions, no refusal) | `0b21c332…` / `0b21c332…` | `0b21c332…` / `0b21c332…` |
| occurrences of `ai-phase`, `event-burst`, `context-switches`, `stress` | 100, 100, 74, 32 / the same | 100, 100, 74, 32 / the same |
| frames of the four windows | 500, 500, 222, 736 / the same | 500, 500, 222, 736 / the same |
| notifications emitted / consumed | 2256 / none (-1) both | 2306 / 2306 both |
| parity checks | none, no HUD, both | 93, all matching, both |

Everything the scenario counts is the same with and without the extension, in both arms (the test compares the whole of it: the hash of every turn of the soak, the trace by kind, the idle frames, the switches and the stress rounds too, and the summary keeps the few lines above). The logs of A and B without the extension
have three lines: the engine's banner, an empty one and the line that ends the scenario. No line of them says `godot_fabric`, `GDExtension` or Fabric. After the import, `addons/godot_fabric` does not exist in the copy, no `.gdextension` is in it, no path of it names `godot_fabric` (`.godot_fabric/` included), and `.godot/extension_list.cfg`, which the engine reads at start, is absent.

**What the import says.** Nothing about the extension. Its log names neither `godot_fabric` nor a class of it, and the only line that says `GDExtension` is the editor's own label for the step that checks the extensions of any project. The copy had loaded the extension before it was shaped, and the first
version of this check, which did not remove the list of extensions that the editor keeps, saw the import report, exit 0, that it could not load `res://addons/godot_fabric/fabric.gdextension` (three `ERROR` lines and their places). The shape now removes that list, which is a trace of shaping a copy **in place**,
and the import regenerates it (to nothing, with no extension in the project). The test requires zero lines of the import that name the extension, apart from that label.

**The control.** C, whose scene needs the extension, in the same copy: exit 1, 202 script errors and 14 errors of the log, 12 lines of which say Fabric (`res://main.tscn:16` and `:20` and `res://ui/application.tres:6` refer to scripts of the removed addon, and the log ends with `Cannot get class 'FabricSurface'`).
It shows that the checks above can fail, and that A and B, which come out clean, do not depend on the extension at parse time: the game, its services and the HUD of B load without it.

### Observed, and left to the export

- **`all_resources` and the other arms' files.** With `export_filter="all_resources"` (the preset of #75), A and B would still be handed `main.tscn` and `ui/application.tres`, whose references to the removed addon the control shows failing to load, and each arm would carry the other HUD's resources (`ui/`, `native_hud/`). That an export of A or B
  stays clean, and that C − A and B − A price only the HUD, depends on what the export selects; it was not tried here, and these filters do not exclude them.
- **The export itself.** The function of the owner of V05-07 in `scripts/macos-export.mjs` takes a prepared project directory; its signature is not published, so nothing here calls it. Still to do: that function over the three directories, the manifest `frontier-comparison-export.json`, and the Release launcher
  ([What is missing](frontier-comparison-execution.md#what-is-missing-for-the-campaign)).

### Reproducing

```sh
node --test tests/frontier-comparison-arms.test.mjs     # Node only: the description, the filters, the edit of the real project.godot
npm run test:frontier-comparison-arms                    # native, headless: both arms with and without the extension on one copy, and the control
```

## The instrument's self-check through the main loop

Status: code (`scripts/frontier-comparison-probe-project.mjs`, the entries of `runSelfCheck` in `scripts/frontier-comparison-campaign-instrument.mjs`, the probe's manifest in `scripts/frontier-comparison-release.mjs` and the Release launcher), their tests and a native check. It belongs to the
criterion `execucao` of V05-10 and **closes nothing**: **the probe project was not exported, no campaign was run, and this section states no result.** The native check is a Debug, headless one on the editor's binary; no time of it is compared.

### The question

The instrument's self-check is the gate of every campaign (`frozenValue.gate` of `cpu-time-instrument`): the probe (`tests/cpu-time-instrument-probe.gd`) and the oracle run again on the campaign's machine, with the campaign's engine and renderer. In a Release campaign
the engine is the export template, which discards `-s`/`--script` and aborts on `--path` ([above](#why--s-does-not-work-in-an-export-template)). The probe is `extends SceneTree` and takes its flags from `OS.get_cmdline_user_args()`, so it can be what the scenario already is: **the main loop of a project.**
Until now the Release launcher declared `selfCheck: "unsupported"` and the campaign refused after reading the exports.

### The probe project

`prepareProbeProject(directory)` makes a new directory (it refuses one that is not empty) with six files and runs the editor's `--import` on it. `tests/cpu-time-instrument.gd` is not edited: it is copied, and its SHA-256 is checked to be the repository's.

| File in the project | What it is | SHA-256 |
| --- | --- | --- |
| `project.godot` | `config_version=5`, the name "Frontier instrument probe" and `renderer/rendering_method="gl_compatibility"`, the renderer of civ-lite and of the repository's own project. No main scene. | `f4254b28…` |
| `tests/cpu-time-instrument-probe.gd` | The probe, at its own path: it preloads `res://tests/cpu-time-instrument.gd`, the only `preload` or `load` in it or in the instrument. | `c75adee5…` |
| `tests/cpu-time-instrument.gd` | The instrument the probe vouches for, at its own path. **The repository's file**, byte for byte. | `4bdcda83…` |
| `tests/cpu-time-instrument-probe-entry.gd` | `class_name CpuTimeInstrumentProbeEntry` and `extends "cpu-time-instrument-probe.gd"` (the probe, by its relative name, so it sits beside it). | `08ed6856…` |
| `tests/cpu-time-instrument-probe-empty.tscn` | The main scene: one empty `Node`. | `a0da9963…` |
| `override.cfg` | `run/main_scene` (the empty scene) and `run/main_loop_type="CpuTimeInstrumentProbeEntry"`, as the measurement project's ([above](#what-the-runner-writes-into-the-copy)). | `19be22c9…` |

The texts are constants of the script (`PROBE_PROJECT_FILES`), so a change to one changes the hash of the set (`scripts`, `scriptsOf`: `5909a074…`). The entry class is new to the project, which is why the import runs: it fills `.godot/global_script_class_cache.cfg`.
The project is 84 KB with its cache. The probe's hash is the one of the file as of this slice: it changes with the probe.

### The entries of the self-check

`runSelfCheck` takes `entry`, and the three go through the same judgement (the probe's process, its own checks, the log with no hidden error, the oracle, `presented` in a window, and the instrument's SHA-256):

| `entry` | Runs | Report |
| --- | --- | --- |
| `script` (the default, as before) | `engine --path <repository> --headless\|--windowed --script res://tests/cpu-time-instrument-probe.gd -- --report=<name>` | `build/<name>` in the checkout, then copied to the check's directory |
| `main-loop` (`{engine, probeProject}`) | `engine --path <probe project> --headless\|--windowed -- --report=<absolute>`, no `--script` | the absolute file, in the check's directory |
| `release` (`{executable}`) | the executable of an exported `.app`, `--headless\|--windowed -- --report=<absolute>`, with the check's directory as its working directory (outside the `.app`) | the same |

The arguments are a pure function (`selfCheckArguments`). The result gains `entry`; the process' `timeout` is injectable. For `main-loop` the check also refuses a probe project whose instrument is not the repository's; the hash it records is the repository's.
`runTimed` of the scenario's runner was not used: the self-check's process is injected as `spawnSync` is, for the guards' tests, and it reads no load.

### The report at an absolute path

The probe's only change: `--report=<name>` still writes `res://build/<name>`, and `--report=<an absolute path>` (`String.is_absolute_path()`) writes there, since an exported project's `res://` is read-only. `npm run test:cpu-time-instrument` (headless, the existing native test) passes as before.

### What the native check shows

`npm run test:frontier-comparison-probe` (`tests/frontier-comparison-probe-native.test.mjs`) prepares a probe project in a temporary directory and runs, headless, the check through `main-loop` on the editor's binary and through `script` on this checkout. The process of `main-loop` has
no `--script` and its report is at the absolute path. Both pass, with **the same ten checks, by name** (the schedule, the instrument's frames and terms, the busy loop, the four accuracy checks, the idle CPU and the process term), the oracle judges both and finds no violation. Their times are not compared.
The summary is in the [evidence record](../evidence/frontier-comparison-probe-entry/README.md).

**The negative controls**, with a limit of 15 s for the process:

- the probe project without `override.cfg`: the engine prints `Error: Can't run project: no main scene defined in the project.` and **idles** (it does not run an empty scene, as there is none), so the check kills it and fails with "the probe ended with signal SIGTERM" and "the probe wrote no report";
- with an `override.cfg` that names the empty scene and no `run/main_loop_type`: the empty scene runs, the probe is not entered, and the check fails the same way.

### The probe's manifest and the Release launcher

An exports directory may have `probe/frontier-comparison-export.json`, in the format of the arms' manifest ([the launcher](frontier-comparison-execution.md#the-launcher)) with `arm: "probe"`: the `.app` of the probe project, exported with the same template. `readProbeExport` reads it
(none when the file is not there; a wrong one is refused naming every problem). With it, `prepare()` also checks the hashes of the probe's executable and package, that its files carry the repository's instrument, and that its `templateSha256` is the one of **each** of the three arms, which is what the gate
asks for ("the campaign's engine"). Then `selfCheck` is `{entry: "release", executable}` and the campaign hands it to `runSelfCheck` (one line of `scripts/frontier-comparison-campaign.mjs`: `...launcher.selfCheck` in the call of `runCheck`). Without the probe's export it stays `"unsupported"` and the campaign refuses as before. The tests
(Node, a fake `.app` of the probe and an oracle the test injects): with the probe the campaign runs the check through the `release` entry and goes on to the first execution; without it, it refuses; with another template, it refuses and starts nothing.

### What is not shown

- **The probe project as a Release `.app`.** It is not exported: the export of the arms' sets comes next, with `frameworks: false` (the probe has no host, and the React Native frameworks would only make the `.app` heavier), `exportFiles` and its manifest. Whether `Contents/MacOS/override.cfg` or the pack carries `override.cfg`, and
  whether a template accepts `--report=<absolute>` and `--headless` the way the editor's binary does, are for that slice; the `release` entry was run against a fake `.app` only.
- **The windowed self-check**, for real: nothing here opened a window.

### Reproducing

```sh
node --test tests/frontier-comparison-probe-project.test.mjs tests/frontier-comparison-release.test.mjs   # Node only: the project, the three entries, the probe's manifest
npm run test:frontier-comparison-probe                                                                       # native, headless: main-loop and script judge the same checks; the controls
npm run test:cpu-time-instrument                                                                             # native, headless: the probe as before
```
