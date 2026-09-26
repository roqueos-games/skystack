/**
 * SkyStack — pure game engine (no Three.js, no DOM).
 *
 * Holds every gameplay rule of the block-stacking game so it can be unit
 * tested in isolation: slide movement (ping-pong), cut geometry (overlap /
 * intersection / falling debris), perfect-snap tolerance + combo growth,
 * speed ramp, scoring, procedural block colors and background biomes.
 *
 * The Vue component (JogoSkyStack.vue) only renders this state with Three.js
 * and forwards user taps to `placeBlock`.
 */

export const BLOCK_HEIGHT = 1
export const BASE_SIZE = 7 // initial footprint on both axes
export const BASE_SPEED = 5.4 // slide units/s at height 0
export const SPEED_GAIN = 0.06 // extra units/s per placed block
export const MAX_SPEED = 11.5
export const SLIDE_RANGE = BASE_SIZE * 1.35 // ping-pong amplitude (center offset)
export const PERFECT_RATIO = 0.14 // tolerance relative to current size…
export const PERFECT_MIN = 0.12 // …but never below this absolute value
export const MIN_OVERLAP = 0.02 // slivers below this count as a miss
export const GROW_STEP = 0.55 // size recovered per perfect once on a streak
export const GROW_COMBO = 3 // streak length required to start growing
export const COMBO_BONUS_CAP = 5 // max bonus points a perfect can add

// Background biomes crossfaded by tower height (CSS gradients painted by the
// component). `from` is the placed-blocks threshold where the biome starts.
export const BIOMES = [
  { id: 'aurora', from: 0, top: '#181035', bottom: '#7d4a79', stars: false },
  { id: 'day', from: 18, top: '#1c5cae', bottom: '#7fc6e8', stars: false },
  { id: 'sunset', from: 38, top: '#341a56', bottom: '#e07a5f', stars: false },
  { id: 'night', from: 62, top: '#070b24', bottom: '#2c3a72', stars: true },
  { id: 'space', from: 90, top: '#020208', bottom: '#1c0f3e', stars: true },
]

/** Slide speed for a given number of placed blocks (ramps up, capped). */
export const speedFor = (placed) => Math.min(BASE_SPEED + placed * SPEED_GAIN, MAX_SPEED)

/** Perfect-snap tolerance for the current block size on the active axis. */
export const perfectTolerance = (size) => Math.max(PERFECT_MIN, size * PERFECT_RATIO)

/** Biome index for a given tower height (last biome whose `from` was reached). */
export const biomeForHeight = (placed) => {
  let idx = 0
  for (let i = 0; i < BIOMES.length; i++) {
    if (placed >= BIOMES[i].from) idx = i
  }
  return idx
}

/**
 * Procedural block color — hue drifts slowly along the stack while lightness
 * breathes in soft waves, producing the signature gradient tower look.
 * Returns `{ h, s, l }` with h in degrees [0, 360) and s/l in [0, 1].
 */
export const colorForIndex = (index, hueStart = 0) => {
  const h = (((hueStart + index * 3.1) % 360) + 360) % 360
  const s = 0.58
  const l = 0.55 + 0.09 * Math.sin(index * 0.36)
  return { h, s, l }
}

/** Spawn descriptor for the next sliding block (alternating entry side). */
export const spawnSlide = (placed) => {
  const fromNegative = placed % 2 === 0
  return {
    pos: fromNegative ? -SLIDE_RANGE : SLIDE_RANGE,
    dir: fromNegative ? 1 : -1,
    speed: speedFor(placed),
    range: SLIDE_RANGE,
  }
}

/**
 * Fresh game state. `hueStart` seeds the color drift (random per run in the
 * component, injectable for deterministic tests).
 */
export const createGame = ({ hueStart = 0 } = {}) => ({
  status: 'ready', // ready | playing | over
  blocks: [{ index: 0, x: 0, z: 0, w: BASE_SIZE, d: BASE_SIZE }],
  axis: 'x', // axis the active block slides on
  slide: spawnSlide(0),
  score: 0,
  combo: 0,
  placed: 0,
  hueStart,
})

/** Transition ready → playing (no-op on any other status). */
export const startGame = (state) => {
  if (state.status !== 'ready') return state
  state.status = 'playing'
  return state
}

/**
 * Advance the sliding block by `dt` seconds — ping-pong with exact reflection
 * at ±range so movement stays deterministic and frame-rate independent.
 * Mutates and returns `slide`.
 */
export const advanceSlide = (slide, dt) => {
  let pos = slide.pos + slide.dir * slide.speed * dt
  if (pos > slide.range) {
    pos = slide.range - (pos - slide.range)
    slide.dir = -1
  } else if (pos < -slide.range) {
    pos = -slide.range - (pos + slide.range)
    slide.dir = 1
  }
  // Guard against huge dt (tab switch): clamp inside the travel band.
  slide.pos = Math.max(-slide.range, Math.min(slide.range, pos))
  return slide
}

/**
 * Resolve a tap while playing. Computes the overlap between the sliding block
 * and the tower top on the active axis, then either:
 *  - `gameover` — no overlap; the whole block falls (returned as debris),
 *  - `perfect`  — |offset| within tolerance; block snaps, combo grows and the
 *                 footprint recovers `GROW_STEP` once the streak reaches
 *                 `GROW_COMBO`,
 *  - `cut`      — block is trimmed to the intersection; the outer slice is
 *                 returned as debris with its exact position/size.
 *
 * Mutates `state` (pushes the new block, advances axis/slide/score) and
 * returns a result object for the renderer.
 */
export const placeBlock = (state) => {
  if (state.status !== 'playing') return { type: 'ignored' }

  const top = state.blocks[state.blocks.length - 1]
  const axis = state.axis
  const size = axis === 'x' ? top.w : top.d
  const center = axis === 'x' ? top.x : top.z
  const delta = state.slide.pos - center
  const overlap = size - Math.abs(delta)
  const index = top.index + 1

  if (overlap <= MIN_OVERLAP) {
    state.status = 'over'
    return {
      type: 'gameover',
      // The whole active block falls as debris from where it was tapped.
      debris: {
        index,
        x: axis === 'x' ? state.slide.pos : top.x,
        z: axis === 'z' ? state.slide.pos : top.z,
        w: top.w,
        d: top.d,
      },
    }
  }

  const tol = perfectTolerance(size)
  const perfect = Math.abs(delta) <= tol
  let block
  let debris = null
  let scoreGain

  if (perfect) {
    state.combo += 1
    // Streak reward: footprint recovers on the active axis (capped at base).
    let w = top.w
    let d = top.d
    if (state.combo >= GROW_COMBO) {
      if (axis === 'x') w = Math.min(BASE_SIZE, w + GROW_STEP)
      else d = Math.min(BASE_SIZE, d + GROW_STEP)
    }
    block = { index, x: top.x, z: top.z, w, d }
    scoreGain = 1 + Math.min(state.combo, COMBO_BONUS_CAP)
  } else {
    state.combo = 0
    const newCenter = center + delta / 2
    const debrisSize = Math.abs(delta)
    const debrisCenter = center + delta / 2 + Math.sign(delta) * (size / 2)
    block = {
      index,
      x: axis === 'x' ? newCenter : top.x,
      z: axis === 'z' ? newCenter : top.z,
      w: axis === 'x' ? overlap : top.w,
      d: axis === 'z' ? overlap : top.d,
    }
    debris = {
      index,
      x: axis === 'x' ? debrisCenter : top.x,
      z: axis === 'z' ? debrisCenter : top.z,
      w: axis === 'x' ? debrisSize : top.w,
      d: axis === 'z' ? debrisSize : top.d,
    }
    scoreGain = 1
  }

  state.blocks.push(block)
  state.placed += 1
  state.score += scoreGain
  state.axis = axis === 'x' ? 'z' : 'x'
  state.slide = spawnSlide(state.placed)

  return { type: perfect ? 'perfect' : 'cut', block, debris, scoreGain, combo: state.combo }
}
