extends RefCounted

# The HUD's six icons: the same 32x32 PNGs the React Native HUD draws (ui/icons/, drawn by scripts/civ-lite-icons.mjs), as the textures a
# TextureRect shows. `unit_icon` and `item_icon` are the two tables ui/hud/icons.ts holds, word for word.

const TEXTURES := {
  "settler": preload("res://ui/icons/settler.png"),
  "warrior": preload("res://ui/icons/warrior.png"),
  "city": preload("res://ui/icons/city.png"),
  "food": preload("res://ui/icons/food.png"),
  "production": preload("res://ui/icons/production.png"),
  "science": preload("res://ui/icons/science.png"),
}


static func texture(icon: String) -> Texture2D:
  return TEXTURES.get(icon)


# The icon of a unit's kind, or "" for a kind the HUD has no picture of.
static func unit_icon(kind: String) -> String:
  return kind if kind == "settler" or kind == "warrior" else ""


# The icon of a production item: the unit it trains, or what the building adds to the city.
static func item_icon(id: String) -> String:
  match id:
    "warrior":
      return "warrior"
    "granary":
      return "food"
    "workshop":
      return "production"
    "library":
      return "science"
    _:
      return "city"
