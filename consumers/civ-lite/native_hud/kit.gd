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


# A choice and, when the game refused it, the refusal beside it.
static func row(button: Button, reason_id: String, reason: String) -> HBoxContainer:
  var box := HBoxContainer.new()
  box.name = "Row-" + button.name
  box.mouse_filter = Control.MOUSE_FILTER_IGNORE
  box.add_theme_constant_override("separation", 10)
  box.add_child(button)
  if reason != "":
    var label := line(reason_id, reason, &"ReasonLabel")
    label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    box.add_child(label)
  return box


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
