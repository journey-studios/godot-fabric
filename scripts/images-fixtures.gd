extends SceneTree

# Encodes the two fixture formats Node cannot write itself, JPEG and lossless WebP, from the PNG that
# scripts/images-fixtures.mjs wrote. Run through that script, never by hand.
func _initialize() -> void:
  var directory := "res://tests/fixtures/images/formats/"
  var picture := Image.load_from_file(directory + "format.png")
  if picture == null or picture.is_empty():
    push_error("format.png is missing")
    quit(1)
    return
  var failures := 0
  failures += 0 if picture.save_jpg(directory + "format.jpg", 0.9) == OK else 1
  failures += 0 if picture.save_webp(directory + "format.webp", false, 1.0) == OK else 1
  quit(failures)
