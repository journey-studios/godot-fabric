extends Node

# The public virtualized-list example under real mouse wheel input. Each state
# is read from the native tree (the scroll offsets the host applied and the
# cells it has mounted, with the Controls' own rectangles) and from what React
# observed, and with --capture the renderer's frame is saved too.
const DEVICE := 1001
const ROW := 44.0
const WHEEL := 48.0
const FEED_STEPS := 30
const AGENDA_STEPS := 15
const SECTIONS := ["Fruit", "Vegetables", "Grains", "Dairy", "Herbs", "Nuts", "Seafood", "Spices"]
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 6000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.VirtualizedListExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func nodes() -> Array:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var all: Variant = value.get("nodes", []) if value is Dictionary else []
  return all if all is Array else []

func node_of(id: String) -> Dictionary:
  for entry: Dictionary in nodes():
    if entry.get("testID") == id:
      return entry
  return {}

func scroll_y(id: String) -> float:
  var value: Variant = node_of(id).get("scroll", {})
  return float(value.get("y", -1.0)) if value is Dictionary else -1.0

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func rect(id: String) -> Rect2:
  var found := control(id)
  return found.get_global_rect() if found != null else Rect2(-1000, -1000, 0, 0)

# The ids after a prefix of every committed cell whose testID begins with it.
func suffixes(prefix: String) -> Array:
  var out: Array = []
  for entry: Dictionary in nodes():
    var id := str(entry.get("testID", ""))
    if id.begins_with(prefix):
      out.append(id.substr(prefix.length()))
  return out

func mounted_rows() -> Array:
  var out: Array = []
  for suffix: String in suffixes("feed-row-"):
    out.append(int(suffix))
  out.sort()
  return out

# Whether at least half of a Control is inside the list's own rectangle: the
# rule the example's viewabilityConfig states, computed here from the Controls.
func half_visible(cell: Rect2, list: Rect2) -> bool:
  var overlap := list.intersection(cell)
  return cell.size.y > 0.0 and overlap.size.y * 2.0 >= cell.size.y

# How far a row's Control is from where getItemLayout and the scroll offset put it.
func inset_of(index: int) -> float:
  return rect("feed-row-%d" % index).position.y - rect("feed").position.y - (index * ROW - scroll_y("feed"))

# JSON numbers are floats; the Controls' indexes are ints.
func ints(values: Variant) -> Array:
  var out: Array = []
  if values is Array:
    for value: Variant in values:
      out.append(int(value))
  return out

func rows_in_view() -> Array:
  var list := rect("feed")
  var out: Array = []
  for index: int in mounted_rows():
    if half_visible(rect("feed-row-%d" % index), list):
      out.append(index)
  return out

func sections_in_view() -> Array:
  var list := rect("agenda")
  var seen := {}
  for entry: Dictionary in nodes():
    var id := str(entry.get("testID", ""))
    var key := ""
    if id.begins_with("agenda-head-"):
      key = id.substr("agenda-head-".length())
    elif id.begins_with("agenda-item-"):
      key = id.substr("agenda-item-".length()).rsplit("-", true, 1)[0]
    if key != "" and half_visible(rect(id), list):
      seen[key] = true
  var out: Array = []
  for key: String in SECTIONS:
    if seen.has(key):
      out.append(key)
  return out

# RN renders its window in batches after each scroll: wait until the committed cells and the
# scroll offsets have not changed for 250 ms.
func quiet() -> void:
  var last := ""
  var changed := Time.get_ticks_msec()
  var counted := 0
  var started := changed
  while Time.get_ticks_msec() - started < 8000:
    await frames()
    counted += 1
    var current := str(mounted_rows()) + str(suffixes("agenda-")) + str(scroll_y("feed")) + str(scroll_y("agenda"))
    if current != last:
      last = current
      changed = Time.get_ticks_msec()
      counted = 0
    elif counted >= 10 and Time.get_ticks_msec() - changed >= 250:
      return

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/virtualized-list-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var feed := region(control("feed"))
  var agenda := region(control("agenda"))
  var inside := feed.has_area() and agenda.has_area() and frame.encloses(feed) and frame.encloses(agenda)
  verify(inside, "Both lists lie inside the captured frame: " + stage)
  images[stage] = {"feed": digest(image, feed) if inside else "", "agenda": digest(image, agenda) if inside else ""}

func wheel_step(point: Vector2) -> void:
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = point
  event.button_index = MOUSE_BUTTON_WHEEL_DOWN
  event.pressed = true
  event.factor = 1
  Input.parse_input_event(event)

# One wheel step per frame, as a turning wheel sends them.
func wheel(point: Vector2, count: int) -> void:
  for index in range(count):
    wheel_step(point)
    await frames()

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("feed") != null and control("feed-row-0") != null
    and control("agenda") != null and control("agenda-head-Fruit") != null))
  verify(mounted, "The public example mounts both lists with their first cells")
  await quiet()
  var top_rows := mounted_rows()
  var top := example()
  stages.top = {"rows": top_rows, "sections": sections_in_view(), "example": top, "feed": node_of("feed").get("scroll"), "agenda": node_of("agenda").get("scroll")}
  verify((node_of("feed").get("kind") == "scroll" and node_of("agenda").get("kind") == "scroll"
    and scroll_y("feed") == 0.0 and scroll_y("agenda") == 0.0),
    "Each list is a native scroll view resting at offset 0")
  verify((top_rows.size() > 8 and top_rows.size() < 200 and top_rows[0] == 0 and not top_rows.has(100)
    and int(top.get("mountedRows", -1)) == top_rows.size()),
    "The FlatList mounts a window of its 200 rows, not all of them, and React's own count matches the Controls")
  var rows_top := rows_in_view()
  var last_top: int = rows_top.back() if not rows_top.is_empty() else -1
  verify((rows_top.size() >= 7 and rows_top[0] == 0 and ints(top.get("feed", {}).get("viewable")) == rows_top
    and node_of("feed-status").get("nativeText") == "offset 0 · rows 0–%d in view" % last_top),
    "onViewableItemsChanged reports the rows at least half visible, as the Controls' own rectangles show them")
  var sections_top := sections_in_view()
  verify((control("agenda-head-Fruit") != null and sections_top.size() >= 1 and sections_top[0] == "Fruit"
    and top.get("agenda", {}).get("sections", []) == sections_top
    and rect("agenda-head-Fruit").position.y <= rect("agenda").position.y + 1.0 and rect("agenda-head-Fruit").size.y == 30.0),
    "The SectionList renders its section headers: Fruit sits at the top of the list and the viewable sections match the Controls")
  await capture("top")

  # The mouse wheel scrolls the FlatList 48 px a step; RN's window follows the offset.
  await wheel(rect("feed").get_center(), FEED_STEPS)
  await quiet()
  var feed_rows := mounted_rows()
  var feed_state := example()
  var first_visible := int(floor(scroll_y("feed") / ROW))
  stages.scrolled = {"rows": feed_rows, "example": feed_state, "feed": node_of("feed").get("scroll")}
  verify((scroll_y("feed") == FEED_STEPS * WHEEL and float(feed_state.get("feed", {}).get("offset", -1.0)) == FEED_STEPS * WHEEL
    and scroll_y("agenda") == 0.0),
    "Thirty wheel steps scroll the FlatList 1,440 px, onScroll reports it and the SectionList does not move")
  verify((feed_rows.has(first_visible) and feed_rows.has(first_visible + 7) and not feed_rows.has(100) and not feed_rows.has(150)
    and feed_rows.size() < 80 and int(feed_state.get("mountedRows", -1)) == feed_rows.size()),
    "The window moved with the offset: the cells in view are mounted and the rows far from it are not")
  verify((feed_rows.has(0) and feed_rows.has(9) and not feed_rows.has(12) and top_rows.has(12)),
    "Rows that left the window unmounted (12 was mounted at the top) while the ten initial cells stay")
  var inset := inset_of(feed_rows[0])
  var stacked := feed_rows.all(func(index: int) -> bool: return absf(inset_of(index) - inset) < 0.01)
  verify(stacked and inset >= 0.0 and inset < 4.0,
    "Every mounted row sits at its getItemLayout offset minus the scroll offset, inside the list's border")
  var rows_later := rows_in_view()
  verify((rows_later.size() >= 7 and rows_later[0] > 30 and ints(feed_state.get("feed", {}).get("viewable")) == rows_later
    and node_of("feed-status").get("nativeText") == "offset 1440 · rows %d–%d in view" % [rows_later[0], rows_later[-1]]),
    "onViewableItemsChanged follows: later rows are in view and match the Controls and the native status text")

  # And the SectionList: later sections and their headers.
  await wheel(rect("agenda").get_center(), AGENDA_STEPS)
  await quiet()
  var agenda_state := example()
  var sections_later := sections_in_view()
  stages.sectioned = {"example": agenda_state, "sections": sections_later, "agenda": node_of("agenda").get("scroll"), "heads": suffixes("agenda-head-")}
  verify((scroll_y("agenda") == AGENDA_STEPS * WHEEL and float(agenda_state.get("agenda", {}).get("offset", -1.0)) == AGENDA_STEPS * WHEEL
    and scroll_y("feed") == FEED_STEPS * WHEEL),
    "Fifteen wheel steps scroll the SectionList 720 px, and the FlatList keeps its offset")
  verify((sections_later.size() >= 2 and sections_later[0] != "Fruit" and agenda_state.get("agenda", {}).get("sections", []) == sections_later
    and not suffixes("agenda-head-").has("Spices")),
    "A later section header is in view, onViewableItemsChanged agrees with the Controls and the last section is not mounted yet")
  verify((node_of("agenda-status").get("nativeText") == "offset 720 · %s in view" % ", ".join(sections_later)
    and native_state().get("errors", []).is_empty()),
    "The native status text shows the same state and the run raised no host error")
  await capture("scrolled")
  if capturing:
    var first_pixels: Dictionary = images.top
    var second_pixels: Dictionary = images.scrolled
    verify(first_pixels.feed != second_pixels.feed and first_pixels.agenda != second_pixels.agenda,
      "The renderer drew both lists differently after the wheel scrolled them")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root and every cell without a host error")
  var report := {"scenario": "virtualized-list", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the virtualized-list report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: virtualized-list" if failed else "FABRIC_VALIDATION_PASSED: virtualized-list " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
