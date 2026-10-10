import assert from "node:assert/strict";
import test from "node:test";
import {campaignErrors} from "../scripts/frontier-comparison-format.mjs";
import {REJECTING_RULES, assessValidity} from "../scripts/frontier-comparison-validity.mjs";
import {ENDINGS, executionsOf, harness, noReportSlot, overLoaded, readProtocol, redoSlot, sha256, slotRecord as slotOf, withResamples} from "./frontier-comparison-synthetic.mjs";

// Which executions of a campaign count (V05-10): the invalidation rules of docs/research/frontier-comparison-protocol.json that can be computed from the raw data, the redo of a rejected
// execution in its slot, the limit of attempts per slot, the campaign that stops, the order and balance of the executions, and the refusal of data that are not in the format. The campaigns are
// SYNTHETIC (tests/frontier-comparison-synthetic.mjs): nothing here was measured. These tests do not depend on the bootstrap, so they run on the committed protocol with 200 resamples instead
// of 10,000 (tests/frontier-comparison-analysis.test.mjs runs the real ones).
const {protocol, protocolSha256} = withResamples(readProtocol().protocol, 200);
const {build, analyze} = harness(protocol, protocolSha256);
const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;

test("a load above the limit is rejected with its reading and redone in the same slot, and the rejected attempt does not count", () => {
  const clean = analyze(build());
  const campaign = redoSlot(build(), "presented", 4, [overLoaded]);
  const report = analyze(campaign);
  const slot = slotOf(report, "presented", 4);
  assert.deepEqual([slot.arm, slot.state, slot.accepted, slot.rejected], ["C", "accepted", 2, 1]);
  assert.deepEqual(slot.attempts.map(attempt => [attempt.attempt, attempt.status]), [[1, "rejected"], [2, "accepted"]]);
  assert.deepEqual(slot.attempts[0].reasons, [{rule: "load", clause: "before", value: 5.3, limit: 2}]);
  assert.equal(slot.attempts[0].load.before, 5.3, "the rejected attempt stays with its load readings");
  assert.deepEqual([report.sections.validity.totals.presented.C.planned, report.sections.validity.totals.presented.C.accepted, report.sections.validity.totals.presented.C.rejected], [12, 12, 1]);
  assert.deepEqual(report.sections.primary, clean.sections.primary, "the accepted attempt is the same measurement: nothing of the rejected one reached the statistics");
  assert.equal(report.status, "complete");
  // After the execution counts as well, and the limit itself is allowed ("above the limit").
  const after = redoSlot(build(), "presented", 5, [execution => {
    execution.load.after = 2.5;
  }, execution => {
    execution.load.before = 2;
    execution.load.after = 2;
    execution.errors.exitCode = 1;
  }]);
  const redone = slotOf(analyze(after), "presented", 5);
  assert.deepEqual(redone.attempts[0].reasons, [{rule: "load", clause: "after", value: 2.5, limit: 2}]);
  assert.deepEqual(redone.attempts[1].reasons, [{rule: "errors", clause: "exitCode", value: 1}], "a load of exactly 2.0 is not over the limit");
});

test("an execution that did not draw or was not paced in the presented lane is rejected with the reason, and the same data in the unlimited lane is not", () => {
  const unpaced = execution => {
    execution.idle.intervalsUsec = execution.idle.intervalsUsec.map(() => 1000);
  };
  const notDrawn = execution => {
    execution.drew.afterEveryMeasuredIntent = false;
    execution.drew.idleDrawnFrames = 539;
  };
  const report = analyze(redoSlot(build(), "presented", 2, [unpaced, notDrawn]));
  const slot = slotOf(report, "presented", 2);
  assert.deepEqual(slot.attempts[0].reasons.map(reason => [reason.rule, reason.clause]), [["not-presented", "not-paced"]]);
  assert.equal(slot.attempts[0].reasons[0].reference, 1000);
  assert.ok(close(slot.attempts[0].reasons[0].halfPeriod, 1e6 / 120 / 2), "half of the refresh period read back");
  assert.deepEqual(slot.attempts[1].reasons.map(reason => reason.clause), ["intent-not-drawn", "idle-not-drawn"]);
  assert.deepEqual(slot.attempts[1].reasons[1], {rule: "not-presented", clause: "idle-not-drawn", drawn: 539, of: 600});
  assert.deepEqual([slot.state, slot.accepted, slot.rejected], ["accepted", 3, 2]);
  // 540 of 600 frames drawn is nine in ten: not rejected; one frame less is.
  const boundary = build();
  executionsOf(boundary, "B")[0].drew.idleDrawnFrames = 540;
  assert.equal(slotOf(analyze(boundary), "presented", 2).state, "accepted");
  executionsOf(boundary, "B")[0].drew.idleDrawnFrames = 539;
  assert.deepEqual(slotOf(analyze(boundary), "presented", 2).attempts[0].reasons, [{rule: "not-presented", clause: "idle-not-drawn", drawn: 539, of: 600}]);
  // The rule is of the presented lane: the same data in the unlimited lane are accepted.
  const unlimited = build();
  unpaced(executionsOf(unlimited, "B", "unlimited")[0]);
  notDrawn(executionsOf(unlimited, "B", "unlimited")[1]);
  assert.deepEqual(analyze(unlimited).sections.validity.totals.unlimited.B, {planned: 12, accepted: 12, rejected: 0, open: 0, missing: 0, exhausted: 0});
});

test("an incomplete window or idle window, a wrong hash, a wrong seed or a Debug build, an error and a parity mismatch are each rejected with their rule", () => {
  const reasonsOf = (lane, slotNumber, change) => slotOf(analyze(redoSlot(build(), lane, slotNumber, [change])), lane, slotNumber).attempts[0].reasons;
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.windows["ai-phase"].occurrences.pop();
  }), [{rule: "incomplete", clause: "ai-phase", measured: 97, required: 98}]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.windows.stress.occurrences.splice(5, 4);
  }), [{rule: "incomplete", clause: "stress", measured: 26, required: 30}]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.idle.cpuUsec.pop();
  }), [{rule: "incomplete", clause: "idle-cpuUsec", measured: 599, required: 600}]);
  const wrong = sha256("another");
  const campaign = build();
  const registered = campaign.registered.arms.C;
  const registeredProtocol = protocolSha256;
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.hashes.binary = wrong;
  }), [{rule: "not-the-registered-build", clause: "binary", value: wrong, registered: registered.binarySha256}]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.build = "debug";
    execution.hashes.package = wrong;
    execution.hashes.script = wrong;
    execution.hashes.protocol = wrong;
    execution.seed = 1;
  }).map(reason => reason.clause), ["build", "package", "script", "protocol", "seed"]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.hashes.protocol = wrong;
  }), [{rule: "not-the-registered-build", clause: "protocol", value: wrong, registered: registeredProtocol}], "an execution made under another text of the protocol is not mixed with this one");
  assert.deepEqual(reasonsOf("unlimited", 3, execution => {
    execution.game.replayGoldenHash = "another game";
    execution.game.soakFinalHash = "another game";
  }).map(reason => [reason.rule, reason.clause]), [["other-game", "replay"], ["other-game", "soak"]]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.errors = {unhandledJs: 2, scriptErrors: 0, godotLogErrors: 1, crashed: true, exitCode: 139};
  }).map(reason => reason.clause), ["unhandledJs", "godotLogErrors", "crashed", "exitCode"]);
  assert.deepEqual(reasonsOf("presented", 3, execution => {
    execution.parityMatches = false;
  }), [{rule: "parity", clause: "testIDs"}]);
  // Every rule of the protocol that rejects an attempt has a check, in the protocol's order; the two that do not are `vsync-reading`, which the protocol says is not an invalid execution
  // (the FPS band is N/A for it), and `instrument`, which is a property of the campaign (an instrument that did not pass counts nothing).
  assert.deepEqual(REJECTING_RULES, protocol.invalidation.map(rule => rule.id).filter(id => !["vsync-reading", "instrument"].includes(id)));
  assert.equal(protocol.invalidation.find(rule => rule.id === "vsync-reading").action.slice(0, 11), "not invalid");
});

test("the fourth attempt, or three rejected ones, stop the campaign and no statistic is produced", () => {
  const four = redoSlot(build(), "presented", 4, [overLoaded, overLoaded, overLoaded]);
  const stopped = analyze(four);
  assert.equal(stopped.status, "stopped");
  assert.deepEqual(stopped.why, [{rule: "attempts", lane: "presented", slot: 4, arm: "C", attempts: 4, limit: 3}]);
  const slot = slotOf(stopped, "presented", 4);
  assert.deepEqual([slot.state, slot.accepted, slot.rejected], ["exhausted", null, 4]);
  assert.deepEqual(slot.attempts[3].reasons, [{rule: "attempts", clause: "beyond-the-limit", limit: 3}], "a fourth attempt is over the limit even if its data are fine");
  for (const id of ["primary", "axes", "cost-of-change", "budgets"]) {
    assert.deepEqual(stopped.sections[id], {available: false, reason: "stopped"}, id);
  }
  assert.equal(stopped.sections.validity.stopped.length, 1, "the validity section still says what happened");
  // Three rejected attempts and no fourth: the attempts are used up and the campaign stops all the same.
  const used = redoSlot(build(), "presented", 5, [overLoaded, overLoaded, overLoaded]);
  used.executions.splice(used.executions.findIndex(execution => execution.lane === "presented" && execution.slot === 5 && execution.attempt === 4), 1);
  const exhausted = analyze(used);
  assert.deepEqual([exhausted.status, exhausted.why.map(reason => reason.rule), slotOf(exhausted, "presented", 5).state], ["stopped", ["attempts"], "exhausted"]);
  // Two rejections followed by an accepted third attempt is within the limit.
  const second = analyze(redoSlot(build(), "presented", 4, [overLoaded, overLoaded]));
  assert.deepEqual([second.status, slotOf(second, "presented", 4).state, slotOf(second, "presented", 4).accepted], ["complete", "accepted", 3]);
});

test("a repeat of the other game in one arm stops the campaign, in either lane, and an instrument that did not pass counts nothing", () => {
  const otherGame = execution => {
    execution.game.replayGoldenHash = "another game";
  };
  const once = analyze(redoSlot(build(), "presented", 1, [otherGame]));
  assert.deepEqual([once.status, once.why], ["complete", []]);
  const bothArms = redoSlot(redoSlot(build(), "presented", 1, [otherGame]), "presented", 2, [otherGame]);
  assert.equal(analyze(bothArms).status, "complete", "one in A and one in B is not a repeat in one arm");
  const twice = analyze(redoSlot(redoSlot(build(), "presented", 1, [otherGame]), "presented", 5, [otherGame]));
  assert.deepEqual([twice.status, twice.why], ["stopped", [{rule: "other-game", arm: "A", rejected: 2}]]);
  const lanes = analyze(redoSlot(redoSlot(build(), "presented", 1, [otherGame]), "unlimited", 5, [otherGame]));
  assert.deepEqual(lanes.why, [{rule: "other-game", arm: "A", rejected: 2}]);
  const failed = build();
  failed.instrument.selfCheckPassed = false;
  assert.deepEqual(analyze(failed).why, [{rule: "instrument", selfCheckPassed: false, unchangedAfterSelfCheck: true}]);
  const changed = build();
  changed.instrument.sha256 = sha256("the reading changed after the self-check");
  const report = analyze(changed);
  assert.deepEqual([report.status, report.why[0].unchangedAfterSelfCheck, report.sections.provenance.instrument.passed], ["stopped", false, false]);
});

test("the order of the executions: slots follow the protocol's sequence, the planned and accepted counts balance by position, and an arm with too few executions is incomplete", () => {
  const report = analyze(build());
  const {balance, totals} = report.sections.validity;
  for (const lane of ["presented", "unlimited"]) {
    assert.deepEqual(balance[lane].planned, [{A: 4, B: 4, C: 4}, {A: 4, B: 4, C: 4}, {A: 4, B: 4, C: 4}], "each arm 4 times in each position of a block");
    assert.equal(balance[lane].balanced, true);
    assert.deepEqual(totals[lane].A, {planned: 12, accepted: 12, rejected: 0, open: 0, missing: 0, exhausted: 0});
  }
  assert.deepEqual(report.sections.validity.slots.filter(slot => slot.lane === "presented").map(slot => slot.arm).join(""), protocol.runs.sequence.join(""));
  // Two slots of an arm never run: 10 accepted is the minimum, the statistics are produced, and the balance says the order was not completed.
  const missing = build();
  missing.executions = missing.executions.filter(execution => !(execution.lane === "presented" && execution.arm === "C" && [3, 4].includes(execution.slot)));
  const ten = analyze(missing);
  assert.deepEqual([ten.status, ten.sections.validity.totals.presented.C.accepted, ten.sections.validity.totals.presented.C.missing, ten.sections.validity.balance.presented.balanced], ["complete", 10, 2, false]);
  assert.equal(ten.sections.primary.windows[0].arms.C.executions, 10);
  assert.equal(slotOf(ten, "presented", 3).state, "missing");
  // A third missing one leaves 9: below the minimum, so no statistic.
  const nine = build();
  nine.executions = nine.executions.filter(execution => !(execution.lane === "presented" && execution.arm === "C" && [3, 4, 8].includes(execution.slot)));
  const incomplete = analyze(nine);
  assert.deepEqual([incomplete.status, incomplete.why, incomplete.sections.primary], ["incomplete", [{rule: "minimum-per-arm", arm: "C", accepted: 9, required: 10}], {available: false, reason: "incomplete"}]);
  // A rejected attempt that has not been redone yet is an open slot, not an accepted one.
  const open = build();
  const index = open.executions.findIndex(execution => execution.lane === "presented" && execution.slot === 3);
  overLoaded(open.executions[index]);
  assert.deepEqual([slotOf(analyze(open), "presented", 3).state, analyze(open).sections.validity.totals.presented.C.open], ["open", 1]);
});

test("attempts that contradict one another, or data that are not in the format, are refused and not analysed", () => {
  const gap = redoSlot(build(), "presented", 4, [overLoaded]);
  gap.executions.find(execution => execution.slot === 4 && execution.attempt === 1).attempt = 2;
  gap.executions.find(execution => execution.slot === 4 && execution.attempt === 2 && execution.load.before !== 5.3).attempt = 3;
  assert.throws(() => analyze(gap), /not numbered 1, 2, \.\.\. without gaps/);
  const afterAccepted = build();
  const copy = structuredClone(afterAccepted.executions[0]);
  copy.attempt = 2;
  afterAccepted.executions.splice(1, 0, copy);
  assert.throws(() => analyze(afterAccepted), /attempt 2 comes after the accepted attempt 1/);

  const campaign = build({lanes: ["presented"]});
  const errors = mutate => {
    const copy = structuredClone(campaign);
    mutate(copy);
    return campaignErrors(copy, protocol);
  };
  assert.deepEqual(campaignErrors(campaign, protocol), []);
  assert.deepEqual(errors(copy => {
    delete copy.provenance.commit;
  }), ["$.provenance.commit: missing"]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].extra = 1;
  }), ["$.executions[0].extra: not part of the format"]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].hashes.binary = "abc";
  }), ["$.executions[0].hashes.binary: expected sha256, got string \"abc\""]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].windows["ai-phase"].occurrences[5].frameUsec[0] = 1.5;
  }), ["$.executions[0].windows.ai-phase.occurrences[5].frameUsec[0]: expected count, got number 1.5"]);
  assert.deepEqual(errors(copy => {
    copy.executions[1].arm = "C";
  }).slice(0, 1), ["executions[1]: slot 2 is arm B in the order of the executions, not C"]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].readings.hermes = {heapBytes: 1, nativeViews: 1};
  }), ["executions[0].readings.hermes: the outcome hermes-heap is not read in arm A"]);
  assert.deepEqual(errors(copy => {
    copy.executions[2].windows.stress.fps = 100;
  }), ["executions[2].windows.stress.fps: only the unlimited lane with the vsync read back as DISABLED reads the FPS"]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].windows["ai-phase"].occurrences[1].warmup = false;
    copy.executions[0].windows["ai-phase"].occurrences[3].warmup = true;
  }), ["executions[0].windows.ai-phase: the warm-up occurrences are not the first ones"]);
  assert.deepEqual(errors(copy => {
    copy.executions.push(structuredClone(copy.executions[0]));
  }), ["executions[36]: lane presented, slot 1 and attempt 1 appear twice"]);
  assert.deepEqual(errors(copy => {
    copy.executions[0].parityMatches = true;
  }), ["executions[0].parityMatches: arm without a HUD has no context matrix"]);
  assert.deepEqual(errors(copy => {
    copy.armB = {ready: false};
  }).filter(error => /declared not ready/.test(error)).length, 12 + 1, "an arm declared not ready has no execution and no cost of change");
  assert.throws(() => analyze(Object.assign(structuredClone(campaign), {format: "godot-fabric.frontier-comparison-campaign/v0"})), /format: godot-fabric.frontier-comparison-campaign\/v0 is not/);
});

// ---- the attempts that wrote no report (`unreported`) ----

test("an attempt that wrote no report is in the format: a valid entry is accepted and each wrong field is refused", () => {
  const campaign = noReportSlot(build({lanes: ["presented"]}), "presented", 4);
  assert.deepEqual(campaignErrors(campaign, protocol), []);
  assert.deepEqual(campaign.unreported, [{arm: "C", lane: "presented", slot: 4, attempt: 1, load: campaign.unreported[0].load, errors: ENDINGS.crash, logSha256: sha256("log/presented/4/1")}]);
  const errors = mutate => {
    const copy = structuredClone(campaign);
    mutate(copy.unreported[0], copy);
    return campaignErrors(copy, protocol);
  };
  // The types of each field.
  assert.deepEqual(errors(entry => {
    entry.arm = 3;
  }), ["$.unreported[0].arm: expected string, got number 3"]);
  assert.deepEqual(errors(entry => {
    entry.slot = 0;
  }), ["$.unreported[0].slot: expected positive, got number 0"]);
  assert.deepEqual(errors(entry => {
    entry.attempt = "1";
  }), ["$.unreported[0].attempt: expected positive, got string \"1\""]);
  assert.deepEqual(errors(entry => {
    entry.load.after = -1;
  }), ["$.unreported[0].load.after: expected measure, got number -1"]);
  assert.deepEqual(errors(entry => {
    entry.errors.crashed = "yes";
  }), ["$.unreported[0].errors.crashed: expected boolean, got string \"yes\""]);
  assert.deepEqual(errors(entry => {
    delete entry.errors.timedOut;
  }), ["$.unreported[0].errors.timedOut: missing"]);
  assert.deepEqual(errors(entry => {
    entry.errors.exitCode = 1.5;
  }), ["$.unreported[0].errors.exitCode: expected integer, got number 1.5"]);
  assert.deepEqual(errors(entry => {
    entry.errors.signal = 11;
  }), ["$.unreported[0].errors.signal: expected string, got number 11"]);
  assert.deepEqual(errors(entry => {
    entry.logSha256 = "abc";
  }), ["$.unreported[0].logSha256: expected sha256, got string \"abc\""]);
  assert.deepEqual(errors(entry => {
    entry.extra = 1;
  }), ["$.unreported[0].extra: not part of the format"]);
  assert.deepEqual(errors((entry, copy) => {
    copy.unreported = entry;
  }), ["$.unreported: expected an array, got an object"]);
  // The place in the order of the executions: the arm of the slot, a lane of the protocol, a slot of the order.
  assert.deepEqual(errors(entry => {
    entry.arm = "B";
  }), ["unreported[0]: slot 4 is arm C in the order of the executions, not B"]);
  assert.deepEqual(errors(entry => {
    entry.arm = "Z";
  }), ["unreported[0].arm: Z is not an arm of the protocol"]);
  assert.deepEqual(errors(entry => {
    entry.lane = "windowed";
  }), ["unreported[0].lane: windowed is not a lane of the protocol"]);
  assert.deepEqual(errors(entry => {
    entry.slot = 37;
  }), ["unreported[0].slot: 37 is not a slot of the order of the executions"]);
  // The entry says how the process ended: it crashed, it timed out or it has an exit code (which may be 0: it ended cleanly and left no report). One that says none of them is refused.
  const noReason = ["unreported[0].errors: no reason for the missing report: the process did not crash, did not time out and has no exit code"];
  assert.deepEqual(errors(entry => {
    entry.errors = {crashed: false, timedOut: false};
  }), noReason);
  assert.deepEqual(errors(entry => {
    entry.errors = {crashed: false, timedOut: false, signal: "SIGSEGV"};
  }), noReason, "a signal that is neither a crash nor a time-out says nothing");
  for (const errorsOfProcess of [ENDINGS.silent, ENDINGS.timeout, {crashed: false, timedOut: true}, {crashed: false, timedOut: false, exitCode: 3}]) {
    assert.deepEqual(errors(entry => {
      entry.errors = errorsOfProcess;
    }), [], JSON.stringify(errorsOfProcess));
  }
  // A process that exited has an exit code and one that was killed has a signal, never both; neither is fine when it crashed or timed out.
  assert.deepEqual(errors(entry => {
    entry.errors.exitCode = -1;
  }), ["unreported[0].errors: exitCode and signal are both present: a process that exited has an exit code and one that was killed has a signal"]);
  assert.deepEqual(errors(entry => {
    entry.errors = {crashed: true, timedOut: false};
  }), []);
  // An attempt is in one of the two lists, once.
  assert.deepEqual(errors((entry, copy) => {
    copy.unreported.push(structuredClone(entry));
  }), ["unreported[1]: lane presented, slot 4 and attempt 1 appear twice"]);
  assert.deepEqual(errors(entry => {
    entry.attempt = 2;
  }), ["unreported[0]: lane presented, slot 4 and attempt 2 appear twice"], "attempt 2 is the execution that redid it");
  // Arm B declared not ready has no attempt, reported or not.
  const unready = build({lanes: ["presented"], armBReady: false});
  unready.unreported = [{arm: "B", lane: "presented", slot: 2, attempt: 1, load: {before: 1, after: 1}, errors: ENDINGS.crash, logSha256: sha256("log")}];
  assert.deepEqual(campaignErrors(unready, protocol), ["unreported[0]: arm B is declared not ready and has an attempt"]);
});

test("an attempt that wrote no report is rejected by the errors rule with its clause and values, counts as an attempt of its slot, and has its load readings and no vsync", () => {
  const clean = analyze(build());
  const crashed = analyze(noReportSlot(build(), "presented", 4));
  const slot = slotOf(crashed, "presented", 4);
  assert.deepEqual([slot.arm, slot.state, slot.accepted, slot.rejected], ["C", "accepted", 2, 1]);
  assert.deepEqual(slot.attempts.map(attempt => [attempt.attempt, attempt.reported, attempt.status]), [[1, false, "rejected"], [2, true, "accepted"]]);
  assert.deepEqual(slot.attempts[0].reasons, [{rule: "errors", clause: "no-report", crashed: true, timedOut: false, signal: "SIGSEGV"}]);
  assert.deepEqual(Object.keys(slot.attempts[0]), ["attempt", "reported", "load", "status", "reasons"], "the record of the attempt has its load readings and no vsync");
  assert.deepEqual(Object.keys(slot.attempts[1]), ["attempt", "reported", "load", "vsync", "status", "reasons"]);
  assert.deepEqual(slotOf(clean, "presented", 4).attempts.map(attempt => attempt.reported), [true], "an execution is reported: true");
  const totals = crashed.sections.validity.totals.presented.C;
  assert.deepEqual([totals.planned, totals.accepted, totals.rejected, totals.open, totals.exhausted], [12, 12, 1, 0, 0]);
  assert.equal(crashed.status, "complete");
  assert.deepEqual(crashed.sections.primary, clean.sections.primary, "the accepted attempt is the same measurement: nothing of the attempt without a report reached the statistics");
  // The other ways in which a process ends without a report are the same rule, each with its values.
  const reasonsOf = ending => slotOf(analyze(noReportSlot(build(), "presented", 4, [ending])), "presented", 4).attempts[0].reasons;
  assert.deepEqual(reasonsOf(ENDINGS.timeout), [{rule: "errors", clause: "no-report", crashed: true, timedOut: true, signal: "SIGTERM"}]);
  assert.deepEqual(reasonsOf({crashed: false, timedOut: false, exitCode: 3}), [{rule: "errors", clause: "no-report", crashed: false, timedOut: false, exitCode: 3}]);
  assert.deepEqual(reasonsOf(ENDINGS.silent), [{rule: "errors", clause: "no-report", crashed: false, timedOut: false, exitCode: 0}], "a process that exits 0 and leaves no report did not complete the scenario");
  // The provenance reads the load of every attempt and the vsync of the executions: the attempt without a report has the first and not the second.
  const loaded = noReportSlot(build(), "presented", 4);
  loaded.unreported[0].load.before = 7.5;
  const provenance = analyze(loaded).sections.provenance;
  assert.ok(clean.sections.provenance.load.highestBefore < 7.5);
  assert.equal(provenance.load.highestBefore, 7.5);
  assert.deepEqual(provenance.vsync, clean.sections.provenance.vsync);
});

test("the attempts of a slot are numbered 1, 2, ... without gaps over the executions and the unreported together; a gap, a repeat or an attempt after the accepted one is a problem", () => {
  const problemsOf = campaign => assessValidity(campaign, protocol, protocolSha256).problems;
  const where = "lane presented, slot 4";
  assert.deepEqual(problemsOf(noReportSlot(build(), "presented", 4)), []);
  assert.deepEqual(problemsOf(noReportSlot(build(), "presented", 4, [ENDINGS.crash, ENDINGS.timeout])), []);
  // A gap: the redo is attempt 3 and there is no attempt 2.
  const gap = noReportSlot(build(), "presented", 4);
  gap.executions.find(execution => execution.slot === 4).attempt = 3;
  assert.deepEqual(problemsOf(gap), [`${where}: the attempts are not numbered 1, 2, ... without gaps`]);
  assert.throws(() => analyze(gap), /not numbered 1, 2, \.\.\. without gaps/);
  // The same attempt in the two lists, and twice in one of them.
  const between = noReportSlot(build(), "presented", 4);
  between.unreported[0].attempt = 2;
  assert.ok(problemsOf(between).includes(`${where}: attempt 2 appears twice`));
  const twice = noReportSlot(build(), "presented", 4, [ENDINGS.crash, ENDINGS.timeout]);
  twice.unreported[1].attempt = 1;
  assert.ok(problemsOf(twice).includes(`${where}: attempt 1 appears twice`));
  assert.throws(() => analyze(twice), /attempt 1 appear twice/);
  // An attempt that wrote no report after the accepted one.
  const late = noReportSlot(build(), "presented", 4);
  late.executions.find(execution => execution.slot === 4).attempt = 1;
  late.unreported[0].attempt = 2;
  assert.deepEqual(problemsOf(late), [`${where}: attempt 2 comes after the accepted attempt 1`]);
  assert.throws(() => analyze(late), /attempt 2 comes after the accepted attempt 1/);
});

test("three attempts that wrote no report use up the slot and stop the campaign by the attempts rule of the analysis, and a fourth is over the limit", () => {
  const stop = {rule: "attempts", lane: "presented", slot: 4, arm: "C", attempts: 3, limit: 3};
  const exhausted = noReportSlot(build(), "presented", 4, [ENDINGS.crash, ENDINGS.timeout, ENDINGS.silent], {redone: false});
  assert.deepEqual(campaignErrors(exhausted, protocol), []);
  const stopped = analyze(exhausted);
  assert.deepEqual([stopped.status, stopped.why], ["stopped", [stop]]);
  const slot = slotOf(stopped, "presented", 4);
  assert.deepEqual([slot.state, slot.accepted, slot.rejected, slot.attempts.length], ["exhausted", null, 3, 3]);
  assert.equal(stopped.sections.validity.totals.presented.C.exhausted, 1);
  assert.deepEqual(stopped.sections.primary, {available: false, reason: "stopped"});
  // Two are not enough to stop it: the slot waits for its redo.
  const two = analyze(noReportSlot(build(), "presented", 4, [ENDINGS.crash, ENDINGS.timeout], {redone: false}));
  assert.deepEqual([two.status, slotOf(two, "presented", 4).state, two.sections.validity.totals.presented.C.open], ["complete", "open", 1]);
  // Rejected executions and an attempt that wrote no report count together.
  const mixed = redoSlot(build(), "presented", 5, [overLoaded, overLoaded]);
  const [redo] = mixed.executions.splice(mixed.executions.findIndex(execution => execution.lane === "presented" && execution.slot === 5 && execution.attempt === 3), 1);
  mixed.unreported = [{arm: redo.arm, lane: "presented", slot: 5, attempt: 3, load: redo.load, errors: ENDINGS.crash, logSha256: sha256("log")}];
  assert.deepEqual(analyze(mixed).why, [{...stop, slot: 5, arm: "A"}]);
  // A fourth attempt is over the limit even if its data are fine.
  const fourth = analyze(noReportSlot(build(), "presented", 4, [ENDINGS.crash, ENDINGS.crash, ENDINGS.crash]));
  assert.deepEqual(slotOf(fourth, "presented", 4).attempts[3].reasons, [{rule: "attempts", clause: "beyond-the-limit", limit: 3}]);
  assert.deepEqual(fourth.why, [{...stop, attempts: 4}]);
});

