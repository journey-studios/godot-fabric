extends RefCounted

# Frontier's own PRNG: PCG32 (XSH-RR, 64-bit state), in integers only. Nothing in the game calls randi(), randf() or
# RandomNumberGenerator, whose streams Godot does not promise to keep between versions or platforms.
#
# GDScript ints are 64-bit and wrap on + and *, which is the modulo-2^64 arithmetic PCG32 wants. Its right shifts are
# arithmetic on a signed int, so each one is followed by the mask that makes it the logical shift of an unsigned
# 64-bit value. The generator is stored as plain dictionary entries so that it is part of the canonical state: the
# 64-bit state and increment are split into two unsigned 32-bit halves, which stay exact in JSON and in a double.

const MULTIPLIER := 6364136223846793005
const MASK32 := 0xFFFFFFFF
# Masks for the logical shifts by 18 and by 27 of a 64-bit value: the 46 and the 37 bits that stay.
const MASK_AFTER_18 := 0x3FFFFFFFFFFF
const MASK_AFTER_27 := 0x1FFFFFFFFF


# The generator PCG's reference implementation builds from (state, sequence). `draws` counts the outputs taken.
static func create(seed_value: int, sequence: int) -> Dictionary:
  var rng := {"state_hi": 0, "state_lo": 0, "inc_hi": 0, "inc_lo": 0, "draws": 0}
  _store(rng, "inc", (sequence << 1) | 1)
  _advance(rng)
  _store(rng, "state", _load(rng, "state") + seed_value)
  _advance(rng)
  return rng


# The next 32 random bits, as a non-negative int below 2^32.
static func next_u32(rng: Dictionary) -> int:
  var old := _advance(rng)
  var shifted := ((((old >> 18) & MASK_AFTER_18) ^ old) >> 27) & MASK_AFTER_27 & MASK32
  var rotation := (old >> 59) & 31
  rng.draws = int(rng.draws) + 1
  return ((shifted >> rotation) | (shifted << ((32 - rotation) & 31))) & MASK32


# An unbiased integer in [0, bound): the draws below the threshold are rejected, as PCG's own bounded generator does.
static func next_below(rng: Dictionary, bound: int) -> int:
  var threshold := (0x100000000 - bound) % bound
  while true:
    var value := next_u32(rng)
    if value >= threshold:
      return value % bound
  return 0


# The first outputs of the generator PCG's reference demo seeds with (42, 54). They are published, so a test can check
# the implementation against a source that is not this code.
static func reference_vector() -> Array:
  var rng := create(42, 54)
  var out := []
  for _index in 6:
    out.append(next_u32(rng))
  return out


static func _advance(rng: Dictionary) -> int:
  var old := _load(rng, "state")
  _store(rng, "state", old * MULTIPLIER + _load(rng, "inc"))
  return old


static func _load(rng: Dictionary, key: String) -> int:
  return (int(rng[key + "_hi"]) << 32) | int(rng[key + "_lo"])


static func _store(rng: Dictionary, key: String, value: int) -> void:
  rng[key + "_hi"] = (value >> 32) & MASK32
  rng[key + "_lo"] = value & MASK32
