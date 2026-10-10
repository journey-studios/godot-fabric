import React from "react";
import { View } from "react-native";
import { sendAction } from "../store";
import type { Action, UnitCard } from "../frontier-types";
import type { IconName } from "./icons";
import { unitIcon } from "./icons";
import { Choice, Heading, Panel, Reason } from "./kit";

// The actions of the selection, exactly the `actions` of the snapshot in the order the game gave them, each with its `enabled` and,
// for a disabled one, the game's `reason_text`. End turn is one of them in the snapshot and lives on the bar, so it is not here. An action
// that is about a unit shows the unit's icon, founding a city the city's, and irrigating the irrigation's: the unit is the one the action's argument names, among the
// units of the selected tile.

/** The testID of an action's button: its id and its arguments, which tell two `select_unit` of a stack apart. */
const actionKey = (action: Action) => [action.id, ...action.args].join("-");

function iconOf(action: Action, units: readonly UnitCard[]): IconName | undefined {
  if (action.id === "found_city") {
    return "city";
  }
  if (action.id === "irrigate") {
    return "irrigation";
  }
  const unit = action.id === "select_unit" || action.id === "fortify" ? units.find(entry => entry.id === action.args[0]) : undefined;
  return unit === undefined ? undefined : (unitIcon(unit.kind) ?? undefined);
}

export function Actions({ actions, units }: { actions: readonly Action[]; units: readonly UnitCard[] }) {
  return <Panel id="hud-actions" style={{ position: "absolute", left: 616, top: 24, width: 440 }}>
    <Heading id="hud-actions-title">Actions</Heading>
    {actions.filter(action => action.id !== "end_turn").map(action => {
      const key = actionKey(action);
      return <View key={key} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Choice id={`hud-actions-${key}`} label={action.label} enabled={action.enabled === 1} icon={iconOf(action, units)}
          onPress={() => { void sendAction(action); }} />
        {action.enabled === 1 ? null : <Reason id={`hud-actions-${key}-reason`}>{action.reason_text}</Reason>}
      </View>;
    })}
  </Panel>;
}
