import city from "../icons/city.png";
import food from "../icons/food.png";
import irrigation from "../icons/irrigation.png";
import production from "../icons/production.png";
import science from "../icons/science.png";
import settler from "../icons/settler.png";
import warrior from "../icons/warrior.png";

// The HUD's seven icons, 32x32 PNGs the template draws itself (scripts/civ-lite-icons.mjs). Each import becomes a registered asset the
// builder copies beside the bundle, and an Image draws it: the resources of the bar, the units of the actions and the tile card, the
// city, and the production items of the city screen, which is inside a Modal's window.

export const ICONS = { settler, warrior, city, food, production, science, irrigation };

export type IconName = keyof typeof ICONS;

/** The icon of a unit's kind, or none for a kind the HUD has no picture of. */
export function unitIcon(kind: string): IconName | null {
  return kind === "settler" || kind === "warrior" ? kind : null;
}

/** The icon of a production item: the unit it trains, or what the building adds to the city (the yield the game's table gives it). */
export function itemIcon(id: string): IconName {
  switch (id) {
    case "warrior":
      return "warrior";
    case "granary":
      return "food";
    case "workshop":
      return "production";
    case "library":
      return "science";
    default:
      return "city";
  }
}
