extends RefCounted

# What the panels share: building the Controls they list, and touching a Control only when what it shows has changed. A Control is
# named by its testID, as the React Native host names the ones it mounts, and the probes' reader finds them by that name.

const Icons := preload("icons.gd")


static func line(id: String, text: String, variation: StringName = &"") -> Label:
  var label := Label.new()
  label.name = id
  label.text = text
  label.mouse_filter = Control.MOUSE_FILTER_IGNORE
  label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
  if variation != &"":
    label.theme_type_variation = variation
  return label


static func icon(id: String, name: String, size: int = 18) -> TextureRect:
  var picture := TextureRect.new()
  picture.name = id
  picture.texture = Icons.texture(name)
  picture.custom_minimum_size = Vector2(size, size)
  picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
  picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
  picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
  return picture


# A Button grey and inert while the game says the action is not enabled, with the icon first when it has one.
static func choice(id: String, text: String, enabled: bool, icon_name: String = "", variation: StringName = &"") -> Button:
  var button := Button.new()
  button.name = id
  button.text = text
  button.disabled = not enabled
  button.focus_mode = Control.FOCUS_NONE
  button.alignment = HORIZONTAL_ALIGNMENT_LEFT
  if icon_name != "":
    button.icon = Icons.texture(icon_name)
  if variation != &"":
    button.theme_type_variation = variation
  return button


# Keeps a list of choices in step with the description of it (`rows`: key, label, enabled, reason, icon). A row whose key is still listed is
# updated where it differs, a key that is new makes a row, a key that is gone loses its row, and the rows keep the order of the description:
# nothing is built again for what only changed (a turn in progress disables every choice and gives each its reason, and ends by undoing it).
# `on_press` is called with the key of the row that was pressed.
static func sync_choices(list: Container, prefix: String, rows: Array, on_press: Callable) -> void:
  var stale := {}
  for box in list.get_children():
    stale[box.name] = box
  for index in range(rows.size()):
    var row: Dictionary = rows[index]
    var id: String = prefix + row.key
    var box: HBoxContainer = stale.get("Row-" + id)
    if box == null:
      box = _new_row(id, row, on_press)
      list.add_child(box)
    else:
      stale.erase("Row-" + id)
    _update_row(box, id, row)
    if box.get_index() != index:
      list.move_child(box, index)
  for box: Node in stale.values():
    list.remove_child(box)
    box.queue_free()


# The same for a list of lines (`lines`: key, text).
static func sync_lines(list: Container, prefix: String, lines: Array) -> void:
  var stale := {}
  for label in list.get_children():
    stale[label.name] = label
  for index in range(lines.size()):
    var entry: Array = lines[index]
    var id: String = prefix + str(entry[0])
    var label: Label = stale.get(id)
    if label == null:
      label = line(id, entry[1])
      list.add_child(label)
    else:
      stale.erase(id)
      set_text(label, entry[1])
    if label.get_index() != index:
      list.move_child(label, index)
  for label: Node in stale.values():
    list.remove_child(label)
    label.queue_free()


static func _new_row(id: String, row: Dictionary, on_press: Callable) -> HBoxContainer:
  var button := choice(id, row.label, row.enabled, row.icon)
  button.pressed.connect(on_press.bind(row.key))
  var box := HBoxContainer.new()
  box.name = "Row-" + id
  box.mouse_filter = Control.MOUSE_FILTER_IGNORE
  box.add_theme_constant_override("separation", 10)
  box.add_child(button)
  return box


# The button, and the refusal beside it when the game gave one: a Label made when it is first needed and hidden when it is not.
static func _update_row(box: HBoxContainer, id: String, row: Dictionary) -> void:
  var button: Button = box.get_child(0)
  if button.text != row.label:
    button.text = row.label
  set_disabled(button, not row.enabled)
  var icon := Icons.texture(row.icon)
  if button.icon != icon:
    button.icon = icon
  var reason: Label = box.get_node_or_null(id + "-reason")
  if row.reason != "":
    if reason == null:
      reason = line(id + "-reason", row.reason, &"ReasonLabel")
      reason.size_flags_horizontal = Control.SIZE_EXPAND_FILL
      box.add_child(reason)
    else:
      set_text(reason, row.reason)
      set_shown(reason, true)
  elif reason != null:
    set_shown(reason, false)


static func set_text(label: Label, text: String) -> void:
  if label.text != text:
    label.text = text


static func set_shown(control: Control, shown: bool) -> void:
  if control.visible != shown:
    control.visible = shown


static func set_disabled(button: Button, disabled: bool) -> void:
  if button.disabled != disabled:
    button.disabled = disabled


# Takes the children out of the tree at once, so that their names are free for the ones that replace them, and frees them.
static func clear(container: Node) -> void:
  for child in container.get_children():
    container.remove_child(child)
    child.queue_free()
