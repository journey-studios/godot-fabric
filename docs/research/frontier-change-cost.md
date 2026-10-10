# The cost of change: one new Settler action in arms B and C (V05-10, `mudanca`)

Status: **pre-registered before any implementation.** No line of either arm's implementation exists when this note is committed. The note fixes four things before the work starts:

- the request;
- what is shared and not counted;
- what is counted for each arm;
- how it is counted.

The comparison's protocol ([frontier-comparison-protocol.md](frontier-comparison-protocol.md)) names the axis: "Cost of change: one new action for the Settler", in files, lines, time and tests, for B and C. It is a single observation per arm, lower is better, with a margin of 10% of B's value. A category is given only when the four measures agree (`decisionRule.singleObservation`). This note does not change the protocol. It fills in what the protocol leaves to the implementation.

## The request

> **Irrigate.** A Settler can irrigate the Plain it stands on when the Plain is next to Water (one of the four neighbours) and is not irrigated yet. Irrigating spends all of the Settler's remaining moves, and the tile then yields one more food for the rest of the game.
>
> The HUD shows the new action and its result:
> - **The actions panel.** When a Settler is selected, the panel lists Irrigate in the game's order, enabled or disabled with the game's reason, and with the new irrigation icon on its button.
> - **The tile card.** For an irrigated tile, the card shows the irrigation icon and the word "Irrigated" on its units line. Its food yield is the one the game gives, already including the bonus.

The text is given verbatim to both arms' implementers, with the same paths to the shared base.

## What is shared and not counted (the base)

One branch made from `main` holds everything that is the same for both arms. It is implemented first and measured by no one.

- **The game.**
  - a new intent `irrigate(unit_id)` in the rules, with its checks and their codes and reasons;
  - the tile's `irrigated` flag and its food bonus in the game's state;
  - the action in the Settler context's `actions`;
  - `irrigated` in the tile cards of the snapshot and of `frontier.hover`;
  - the `GameServices` registration of the intent and the services schema;
  - the game's own tests.
- **The icon.** `irrigation.png`, drawn by `scripts/civ-lite-icons.mjs` like the six others.
- **The lane's expectation.** The HUD lane and its oracle are shared by both arms through the reader seam (`hud_probe.gd`). The base extends them so that a Settler on an irrigable Plain shows `hud-actions-irrigate-<id>` with its icon, and an irrigated tile shows `hud-tile-irrigated`. The extension makes the lane **fail on both arms**.

The base is the same starting point for both arms. Each arm's work is to make the same failing lane pass.

## What is counted for each arm

Each arm is implemented by **a new subagent** that has not seen the other arm's implementation. It starts from the base, on its own branch: `exp/change-cost-b` for the native HUD, `exp/change-cost-c` for the React Native HUD. It works until the HUD lane passes on its arm.

| Measure | How it is counted |
| --- | --- |
| Files | Files the arm's branch changes or adds against the base (`git diff --name-only base..arm`), excluding the evidence |
| Lines | Lines added plus lines removed in those files (`git diff --numstat base..arm`) |
| Time | Active time of the arm's subagent, by the rule of the protocol's amendment of 2026-10-09: the sum of the gaps under 30 minutes between consecutive timestamped events of its transcript, from its first event to its hand-back |
| Tests | Test checks the arm had to add or change for itself: probe checks, oracle rules or test files changed on the arm's branch. The shared lane extension of the base counts for neither arm. |

**Order and independence.**
- B's subagent runs first and C's second, and neither may read the other's branch.
- The order is fixed here and not drawn. With one observation per arm, order is not balanced, and the report says so.

**Not merged into `main`.**
- The base and both arms stay on experiment branches.
- Only their diffs (as patch files), the counts and this note enter `main`, under `docs/evidence/frontier-change-cost/`.
- **Why:** the execucao campaign measures the game as it is on `main`, with the 77-intent replay and its golden hash and the thresholds frozen by V05-06. A new action in every Settler snapshot would change what the arms render and what was frozen.

## What the record will hold

- the patches of the base and of each arm;
- the four measures per arm and their difference against the margin (10% of B's value);
- the category, given only when the four agree;
- the active times measured on the transcripts;
- the lane's verdict on each arm before (failing) and after (passing).

The report says it is one observation per arm and supports a description, not a statistical claim.
