extends "res://scripts/pointer_validation.gd"

func run_action(name: String, args := "") -> void:
  surface.evaluate("GodotApp.run('" + name + "'" + ("," + args if args else "") + ")")
  await frames(4)

func event_count(type: String) -> int:
  return react().events.filter(func(event): return event.type == type).size()

func offset() -> float:
  return node("inventory").scroll.y

func type_letter(code: Key, character: String) -> void:
  for pressed in [true, false]:
    var event := InputEventKey.new()
    event.keycode = code
    event.unicode = character.unicode_at(0)
    event.pressed = pressed
    get_viewport().push_input(event, true)
  await frames(4)

func editing_checks() -> void:
  await run_action("offset", "0")
  var editor: LineEdit = surface.find_child("rename", true, false)
  editor.grab_focus()
  editor.set_caret_column(editor.text.length())
  var row_id: int = node("item-0").id
  await type_letter(KEY_X, "x")
  verify(node("rename").nativeText == "Registro 00x" and node("selection").nativeText.ends_with("00x"), "Native keyboard editing updates the selected inventory name through controlled React state")
  verify(node("item-0").id == row_id and offset() == 0, "Editing updates the existing keyed row without disturbing scroll position")
  editor.release_focus()
  var filter_input: LineEdit = surface.find_child("filter", true, false)
  filter_input.grab_focus()
  await type_letter(KEY_X, "x")
  verify(node("item-1").is_empty() and not node("item-0").is_empty() and node("inventory").scroll.maxY == 0, "Native filter input rerenders matching rows and updates content bounds")
  filter_input.release_focus()
  await run_action("filter", "''")
  verify(not node("item-1").is_empty() and node("inventory").scroll.maxY > 0, "Clearing filter restores the scrollable inventory through React reconciliation")

func native_gui_checks() -> void:
  var scroll_control: ScrollContainer = surface.find_child("inventory", true, false)
  verify(scroll_control.mouse_filter == Control.MOUSE_FILTER_IGNORE, "Native scroll container cannot start a competing GUI pan recognizer")
  if DisplayServer.get_name() == "headless":
    return
  await run_action("nativeProbe", "true")
  await wait_native("native-inventory-action")
  await mouse("start", at("native-inventory-action"))
  await mouse("end", at("native-inventory-action"))
  verify(event_count("NativeAction") == 1, "A native Button inside the React scroll container still receives Godot GUI input")
  var native_button: Button = surface.find_child("native-inventory-action", true, false)
  var start := at("native-inventory-action")
  await mouse("start", start)
  verify(native_button.is_pressed(), "Native child begins its GUI press before scroll takeover")
  await mouse("move", start + Vector2(0, -40))
  verify(not native_button.is_pressed() and node("inventory").scroll.dragging, "Scroll takeover cancels the native child's pending GUI press")
  await mouse("end", start + Vector2(0, -40))
  verify(event_count("NativeAction") == 1, "Scroll release cannot activate the canceled native child")
  await run_action("offset", "0")
  await mouse("start", at("native-inventory-action"))
  await mouse("end", at("native-inventory-action"))
  verify(event_count("NativeAction") == 2, "Native child accepts a new click after canceled scroll takeover")
  await run_action("nativeProbe", "false")

func capture(name: String) -> void:
  if OS.get_cmdline_user_args().has("--capture"):
    await RenderingServer.frame_post_draw
    get_viewport().get_texture().get_image().save_png("res://build/scroll-" + name + ".png")

func mount_checks() -> void:
  var control: Control = surface.find_child("inventory", true, false)
  verify(control is ScrollContainer, "Fabric ScrollView mounts a real Godot ScrollContainer")
  verify(node("inventory").scroll.contentHeight == 48 * 48, "Yoga supplies all 48 inventory row frames without shrinking")
  verify(node("inventory").height == node("inventory").fabricHeight, "Native scroll viewport keeps the committed Yoga height")
  verify(node("inventory-content").height == node("inventory-content").fabricHeight, "Native content keeps the committed Yoga height")
  verify(react().content[0] == node("inventory-content").width and react().content[1] == 2304, "Content layout notification reports Yoga content size")
  await capture("initial")

func pointer_checks() -> void:
  await mouse("start", at("item-0"))
  verify(event_count("In:0") == 1 and node("item-0").opacity == 0.5, "Pressability begins and rerenders native pressed state inside scroll content")
  await mouse("end", at("item-0"))
  await get_tree().create_timer(0.15).timeout
  verify(event_count("Press:0") == 1 and react().selected == 0, "Normal click selects the inventory item through React state")
  await wait_native("rename")
  await run_action("clear")
  var start := at("item-0")
  await mouse("start", start)
  await mouse("move", start + Vector2(0, -4))
  verify(offset() == 0 and event_count("Begin") == 0, "Motion below the pan threshold preserves the child responder")
  await mouse("move", start + Vector2(0, -40))
  verify(offset() == 40 and node("inventory").scroll.dragging, "Parent takes responder and moves native content when vertical drag crosses threshold")
  await wait_js("GodotApp.stats().events.some(event => event.type === 'Out:0')", 2)
  await frames(3)
  verify(event_count("Out:0") == 1 and node("item-0").opacity == 1, "Upstream termination cancels Pressability and native pressed style")
  verify(data().pointer.responder == node("inventory").tag and data().pointer.blockNative, "Scroll responder blocks native gesture handling after transfer")
  await wheel(at("inventory"))
  verify(offset() == 40, "Wheel input cannot move content during a responder-owned drag")
  await capture("drag")
  await mouse("end", start + Vector2(0, -40))
  await get_tree().create_timer(0.45).timeout
  verify(event_count("Press:0") == 0 and event_count("Long:0") == 0, "Canceled child produces neither delayed press nor long press")
  verify(event_count("Begin") == 1 and event_count("End") == 1 and not node("inventory").scroll.dragging, "One native begin/end pair closes the accepted drag")
  verify(data().pointer.responder == 0 and data().pointer.activeTouches == 0, "Release clears both native capture and Fabric responder")
  verify(node("inventory").scroll.fabricY == offset(), "Fabric immutable ScrollView state matches native offset")
  var scroll_events: Array = react().events.filter(func(event): return event.type == "Scroll")
  verify(not scroll_events.is_empty() and scroll_events[-1].contentOffset.y == offset() and scroll_events[-1].contentSize.height == 2304 and scroll_events[-1].layoutMeasurement.height == node("inventory").height, "Original Fabric scroll event reports offset, content size and viewport size")

func ref_and_wheel_checks() -> void:
  await run_action("propOffset", "80")
  verify(offset() == 80 and node("inventory").scroll.fabricY == 80, "Changing contentOffset props synchronizes native and Fabric scroll state")
  await run_action("offset", "120")
  verify(offset() == 120 and node("inventory").scroll.fabricY == 120, "scrollTo ref command updates native and Fabric state")
  await run_action("measure")
  var row_control: Control = surface.find_child("item-0", true, false)
  verify(abs(react().measured.y - row_control.get_global_position().y) < 0.5, "Fabric measureInWindow includes the native scroll translation")
  await wheel(at("inventory"))
  verify(offset() == 168, "Viewport wheel moves the committed native scroll container")
  await run_action("end")
  verify(offset() == node("inventory").scroll.maxY, "scrollToEnd clamps to native content bounds")
  var bottom := offset()
  await wheel(at("inventory"))
  verify(offset() == bottom, "Wheel cannot overscroll the lower content boundary")
  await run_action("offset", "-100")
  verify(offset() == 0, "Negative ref offset clamps to the upper boundary")
  await run_action("propOffset", "0")
  await run_action("unsupported")
  verify(react().unsupported.contains("animated: false") and offset() == 0, "Animated ref requests fail explicitly without moving content")
  await run_action("horizontal", "180")
  verify(node("categories").scroll.x == 180 and node("categories").scroll.fabricX == 180 and node("categories").scroll.y == 0, "A second horizontal consumer updates Fabric state on its own axis")
  await wheel(at("categories"), MOUSE_BUTTON_WHEEL_RIGHT)
  verify(node("categories").scroll.x == 228, "Horizontal wheel respects the horizontal native content axis")

func refusal_and_disable_checks() -> void:
  await run_action("lock", "true")
  await run_action("clear")
  var start := at("item-0")
  await mouse("start", start)
  await mouse("move", start + Vector2(0, -20))
  verify(event_count("Reject") == 1 and offset() == 0 and data().pointer.responder == node("item-0").tag, "Noncancelable Pressability rejects parent scroll takeover")
  await mouse("end", start + Vector2(0, -20))
  await run_action("lock", "false")
  await run_action("enable", "false")
  await run_action("clear")
  await touch("start", at("item-0"))
  await touch("move", at("item-0") + Vector2(0, -35))
  await touch("end", at("item-0") + Vector2(0, -35))
  await wheel(at("inventory"))
  verify(offset() == 0 and event_count("Begin") == 0, "Disabled scroll refuses touch pan and wheel input")
  await run_action("enable", "true")

  await run_action("clear")
  start = at("item-0")
  await touch("start", start)
  await touch("move", start + Vector2(0, -70))
  await touch("cancel", start + Vector2(0, -70))
  verify(offset() == 70 and event_count("Press:0") == 0 and event_count("Begin") == 1 and event_count("End") == 1, "Real viewport touch drag and cancel close the native scroll gesture without a child press")
  verify(data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Touch cancellation clears capture and responder")
  await run_action("offset", "0")
  start = at("item-0")
  await touch("start", start)
  await touch("move", start + Vector2(0, -70))
  await run_action("enable", "false")
  verify(not node("inventory").scroll.dragging and event_count("End") == 2, "Disabling scroll during a live drag emits one terminal native event")
  await touch("move", start + Vector2(0, -110))
  verify(offset() == 70, "A disabled held gesture cannot continue moving native content")
  await touch("end", start + Vector2(0, -110))
  await run_action("enable", "true")

func unsupported_prop_checks() -> void:
  var scroll_id: int = node("inventory").id
  var before := offset()
  await run_action("unsupportedProp", "true")
  await wait_native("unsupported-scroll-error")
  verify(react().unsupportedProp.contains("disableScrollViewPanResponder is not implemented") and node("unsupported-scroll").is_empty(), "Unsupported pan control throws through a real React ErrorBoundary before native allocation")
  await run_action("unsupportedProp", "false")
  verify(node("unsupported-scroll-error").is_empty() and node("inventory").id == scroll_id and offset() == before, "Removing the rejected ScrollView preserves the working inventory and its offset")

func resize_checks() -> void:
  var scroll_id: int = node("inventory").id
  await run_action("end")
  get_window().size = Vector2i(620, 900)
  await frames(8)
  verify(node("inventory").width == 572 and node("inventory-content").width == 572 and node("inventory-content").fabricWidth == 572, "Native resize relayouts scroll viewport and content through Yoga")
  verify(node("inventory").scroll.y == node("inventory").scroll.maxY and node("inventory").scroll.fabricY == offset(), "Growing viewport clamps the native offset and updates Fabric state")
  verify(node("inventory").id == scroll_id, "Responsive relayout preserves the native scroll instance")
  await capture("narrow")
  get_window().size = Vector2i(900, 680)
  await frames(8)
  await run_action("offset", "0")

func lifecycle_checks() -> void:
  var scroll_id: int = node("inventory").id
  var row_id: int = node("item-0").id
  await run_action("reverse")
  verify(node("inventory").id == scroll_id and node("item-0").id == row_id and offset() == 70, "Keyed content reorder preserves native identities and scroll position")
  await run_action("shrink")
  verify(offset() == 0 and node("inventory").scroll.maxY == 0 and node("inventory").scroll.fabricY == 0, "Content shrink clamps offset and publishes the new Fabric state")
  await run_action("filter", "'missing'")
  await wait_native("empty")
  verify(node("item-47").is_empty(), "React filtering unmounts rows and renders the empty state")
  await run_action("filter", "''")
  await mouse("start", at("item-47"))
  await run_action("remove")
  verify(node("inventory").is_empty() and data().pointer.activeTouches == 0 and data().pointer.responder == 0, "Unmount during a held child gesture releases capture and removes native scroll content")
  await mouse("end", Vector2(100, 200))
  await get_tree().create_timer(0.45).timeout
  verify(event_count("Press:47") == 0 and event_count("Long:47") == 0, "Removed inventory cannot emit delayed child actions")
  await run_action("restore")
  await wait_native("inventory")
  verify(node("inventory").id != scroll_id and offset() == 0, "Remount starts a new native scroll instance without retained offset")
  await run_action("populate", "48")
  await run_action("propOffset", "96")
  await run_action("remove")
  await run_action("restore")
  await wait_native("inventory")
  verify(offset() == 96 and node("inventory").scroll.fabricY == 96, "Initial contentOffset survives a fresh native mount after ranges are known")
  await run_action("propOffset", "0")
  await run_action("populate", "48")
  var start := at("item-0")
  await mouse("start", start)
  await mouse("move", start + Vector2(0, -30))
  verify(node("inventory").scroll.dragging, "Remounted inventory accepts a fresh native drag")
  await run_action("remove")
  verify(node("inventory").is_empty() and data().pointer.responder == 0 and data().pointer.activeTouches == 0, "Unmount during a live scroll drag releases native and Fabric gesture authority")
  await mouse("end", start)
  await run_action("restore")
  await wait_native("inventory")

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface = FabricSurface.new()
  surface.set_meta("scenario", "scroll")
  if OS.get_cmdline_user_args().has("--validate"):
    surface.set_meta("validation_input_device", 1001)
  add_child(surface)
  await wait_native("inventory")
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  await frames(4)
  await mount_checks()
  await pointer_checks()
  await editing_checks()
  await native_gui_checks()
  await ref_and_wheel_checks()
  await unsupported_prop_checks()
  await resize_checks()
  await refusal_and_disable_checks()
  await lifecycle_checks()
  var before_stop := data()
  surface.stop()
  await frames(3)
  var stopped := data()
  verify(stopped.nodes.is_empty() and stopped.nativeTags == 0 and stopped.pendingTimers == 0 and stopped.pointer.activeTouches == 0 and stopped.pointer.responder == 0, "Surface shutdown releases every native instance, timer and contact")
  verify(react().cleanups == 1 and stopped.errors.is_empty(), "React effect cleanup completes without runtime errors")
  save_report("scroll", before_stop, stopped, react())
