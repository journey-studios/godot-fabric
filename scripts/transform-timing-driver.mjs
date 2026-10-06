// RN's native timing driver for the one animation the transform probes run: Animated.timing
// with a duration of 600 ms and Easing.inOut(Easing.cubic) on the native driver
// (examples/transforms/App.jsx). Written from RN's own sources, not from the probes: the
// frame table is TimingAnimation.js's, and FrameAnimationDriver.cpp and AnimationDriver.cpp
// step it. The only thing it takes from a host is the timestamp of each frame that host
// delivered to RN's AnimationBackend.
//
// The value of a frame is a function of the timestamps alone. The first frame anchors the
// animation; the table entry of a frame is its time since the anchor rounded to RN's frame
// interval of 1/60 s; the value is the segment that starts at that entry, extended linearly
// to the frame's time (ExtrapolateTypeExtend), mapped to the range of the animation. The
// driver completes on the first frame whose entry is the table's last, with the end value
// itself. Rounding the entry makes the value jump by half the table's second difference at
// every half interval, so two frames that straddle one differ by more than their time does:
// a host that delivers frames in bursts (a fraction of a millisecond apart, then tens of
// milliseconds apart) shows a step against the direction of the curve that is RN's own.
// Neither a monotone curve nor a count of frames holds at every pacing; this does.
const FRAME_MS = 1000 / 60;
const DURATION_MS = 600;

// Easing.inOut(Easing.cubic), as RN composes it.
const cubic = t => t * t * t;
const inOutCubic = t => (t < 0.5 ? cubic(t * 2) / 2 : 1 - cubic((1 - t) * 2) / 2);
// The C++ interpolate() of both steps, with both ends extended.
const mix = (x, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * (x - inMin) / (inMax - inMin);

// A driver for one animation from `from` to `to`. Each call is one delivered frame and
// returns the node's value after it and whether the driver completed.
export function timingDriver({from, to}) {
  const count = Math.round(DURATION_MS / FRAME_MS);
  const table = Array.from({length: count}, (_, index) => inOutCubic(index / count));
  table.push(inOutCubic(1));
  let started = null;
  return timestamp => {
    started ??= timestamp;
    const delta = timestamp - started;
    const index = Math.round(delta / FRAME_MS);
    if (index + 1 >= table.length) {
      return {value: to, complete: true};
    }
    const frame = mix(delta, index * FRAME_MS, (index + 1) * FRAME_MS, table[index], table[index + 1]);
    return {value: mix(frame, 0, 1, from, to), complete: false};
  };
}
