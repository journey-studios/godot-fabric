// The retained sabotages of scripts/consumer-civ-lite-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const template = "consumers/civ-lite";
export const SABOTAGES = [
  {name: "hud-leak", file: `${template}/ui/store.ts`,
    find: "function disconnect() {\n  for (const connection of connections) {\n    connection.remove();\n  }\n  connections.clear();\n  view = NOT_CONNECTED;\n}\n",
    replace: "function disconnect() {\n  view = NOT_CONNECTED;\n}\n"},
  {name: "orphan", file: `${template}/services/game_services.gd`,
    find: "  remove_child(world)\n  world.queue_free()\n",
    replace: "  remove_child(world)\n"},
  {name: "epoch-reset", file: `${template}/services/game_services.gd`,
    find: "func reload_world() -> Dictionary:\n  _drop_world()\n  return new_game()\n",
    replace: "func reload_world() -> Dictionary:\n  _drop_world()\n  epoch = 0\n  return new_game()\n"},
  {name: "no-facade", file: `${template}/main.tscn`,
    find: "fabric_api=ExtResource(\"2\")\n",
    replace: ""},
  {name: "job-dies-with-menu", file: `${template}/services/game_services.gd`,
    find: "func _process(_delta: float) -> void:\n  advance_job()\n",
    replace: "func _process(_delta: float) -> void:\n  if world_scene != null and get_node_or_null(WORLD_NAME) == null:\n    _abandon_job()\n    return\n  advance_job()\n"},
];
