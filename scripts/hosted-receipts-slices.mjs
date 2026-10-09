// The slices of the 0.5 Frontier milestone that already reached main, with the facts of each squash that
// the hosted receipts are written from (scripts/hosted-receipts.mjs) and checked against
// (scripts/hosted-receipts-check.mjs). Data only.

export const REPOSITORY = "journey-studios/godot-fabric";
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;

// One row per slice: the folder of its evidence page, the pull request and its squash commit on main,
// the Contracts and Pages runs of the push, the npm steps of the native job that exercise the slice
// (judged by the TAP summary or by a marker line), the artifacts those steps upload, the Node test
// files of the `contracts` job that belong to the slice and the activity entry of the dashboard data.
export const SLICES = [
  {
    folder: "frontier-game",
    pr: 70,
    squash: "e1c7a39",
    contractsRun: 37815810524,
    pagesRun: 37815810532,
    nativeSteps: [{ script: "test:civ-lite-game", expect: "tap" }],
    artifacts: [{ key: "game", name: "native-civ-lite-game" }],
    contractTests: [],
    activity: "milestone-0-5-v05-03-replay-c2e4501",
  },
  {
    folder: "world-input",
    pr: 71,
    squash: "7ef63ed",
    contractsRun: 37853001783,
    pagesRun: 37853001775,
    nativeSteps: [{ script: "test:world-input", expect: "tap" }],
    artifacts: [{ key: "worldInput", name: "native-world-input" }],
    contractTests: [],
    activity: "milestone-0-5-v05-02-pointer-03f039a",
  },
  {
    folder: "frontier-services",
    pr: 73,
    squash: "75a85ad",
    contractsRun: 37840069134,
    pagesRun: 37840069193,
    nativeSteps: [{ script: "test:frontier-services", expect: "tap" }],
    artifacts: [{ key: "services", name: "native-frontier-services" }],
    contractTests: [],
    activity: "milestone-0-5-v05-03-servicos-f199dd0",
  },
  {
    folder: "frontier-consumer",
    pr: 76,
    squash: "c8de44b",
    contractsRun: 37864357395,
    pagesRun: 37864357291,
    nativeSteps: [{ script: "test:consumer:civ-lite", expect: "marker", marker: "CONSUMER_CHECK_PASSED: civ-lite" }],
    artifacts: [{ key: "consumer", name: "independent-civ-lite-consumer" }],
    contractTests: [],
    activity: "milestone-0-5-v05-03-consumidor-b9a40cb",
  },
  {
    folder: "frontier-baseline",
    pr: 77,
    squash: "3bb51d6",
    contractsRun: 37884924042,
    pagesRun: 37884924120,
    nativeSteps: [{ script: "test:frontier-baseline", expect: "tap" }],
    artifacts: [{ key: "baseline", name: "native-frontier-baseline" }],
    contractTests: ["tests/frontier-baseline-graphics.test.mjs", "tests/frontier-baseline-heap.test.mjs"],
    activity: "milestone-0-5-v05-06-baseline-headless-ebfe8a0",
  },
  {
    folder: "world-input-a2",
    pr: 78,
    squash: "2a3f4b0",
    contractsRun: 37874901247,
    pagesRun: 37874901241,
    nativeSteps: [{ script: "test:world-input", expect: "tap" }],
    artifacts: [{ key: "worldInput", name: "native-world-input" }],
    contractTests: [],
    activity: "milestone-0-5-v05-02-pointer-a2-af941dd",
  },
  {
    folder: "frontier-authority",
    pr: 79,
    squash: "5e1f6a1",
    contractsRun: 37880395525,
    pagesRun: 37880395524,
    nativeSteps: [
      { script: "test:frontier-services", expect: "tap" },
      { script: "test:consumer:civ-lite", expect: "marker", marker: "CONSUMER_CHECK_PASSED: civ-lite" },
    ],
    artifacts: [
      { key: "services", name: "native-frontier-services" },
      { key: "consumer", name: "independent-civ-lite-consumer" },
    ],
    contractTests: [],
    activity: "milestone-0-5-v05-03-autoridade-5ee0127",
  },
  {
    folder: "frontier-soak",
    pr: 83,
    squash: "a49f851",
    contractsRun: 37904776515,
    pagesRun: 37904776614,
    nativeSteps: [{ script: "test:frontier-soak", expect: "tap" }],
    artifacts: [{ key: "soak", name: "native-frontier-soak" }],
    contractTests: [],
    activity: "milestone-0-5-v05-06-soak-b77178a",
  },
];
