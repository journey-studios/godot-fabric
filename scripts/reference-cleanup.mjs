export async function cleanupReference(actions, primaryError, log = console.error) {
  const failures = [];
  for (const action of actions) {
    try { await action(); }
    catch (error) { failures.push(error); log("Native reference cleanup failed:", error); }
  }
  if (primaryError) throw primaryError;
  if (failures.length) throw new AggregateError(failures, "Native reference cleanup failed");
}
