extends RefCounted

# The canonical serialization and the hash of Frontier's state.
#
# The text is JSON restricted so that one state has exactly one spelling: objects with their keys sorted by code
# point, no whitespace, decimal integers without sign or leading zeros (except "-" on a negative), and strings of
# printable ASCII with only \" and \\ escaped. The state and the snapshot hold nothing else. A float, a bool, a
# null, a key that is not a string, a string outside printable ASCII or any other Variant is not part of the
# game's data: encode() answers "" for it, and the hash of "" is never a valid state hash.
#
# The hash is SHA-256 (HashingContext) of the UTF-8 bytes of that text, as 64 lowercase hex digits. SHA-256 is the
# function a test in any language already has, so the golden hash can be re-derived from the serialization alone.


static func encode(value: Variant) -> String:
  var parts := PackedStringArray()
  if not _write(value, parts):
    return ""
  return "".join(parts)


static func hash_text(text: String) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(text.to_utf8_buffer())
  return context.finish().hex_encode()


static func state_hash(value: Variant) -> String:
  var text := encode(value)
  if text.is_empty():
    return ""
  return hash_text(text)


static func _write(value: Variant, parts: PackedStringArray) -> bool:
  match typeof(value):
    TYPE_INT:
      parts.append(str(value))
      return true
    TYPE_STRING:
      return _write_string(value, parts)
    TYPE_ARRAY:
      parts.append("[")
      var first := true
      for item: Variant in value:
        if not first:
          parts.append(",")
        first = false
        if not _write(item, parts):
          return false
      parts.append("]")
      return true
    TYPE_DICTIONARY:
      var keys: Array = value.keys()
      keys.sort()
      parts.append("{")
      var first_key := true
      for key: Variant in keys:
        if typeof(key) != TYPE_STRING:
          return false
        if not first_key:
          parts.append(",")
        first_key = false
        if not _write_string(key, parts):
          return false
        parts.append(":")
        if not _write(value[key], parts):
          return false
      parts.append("}")
      return true
  return false


static func _write_string(text: String, parts: PackedStringArray) -> bool:
  var out := "\""
  for index in text.length():
    var code := text.unicode_at(index)
    if code < 0x20 or code > 0x7E:
      return false
    if code == 0x22 or code == 0x5C:
      out += "\\"
    out += char(code)
  parts.append(out + "\"")
  return true
