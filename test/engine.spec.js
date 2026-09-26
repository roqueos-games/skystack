import { describe, it, expect } from 'vitest'
import {
  BLOCK_HEIGHT,
  BASE_SIZE,
  BASE_SPEED,
  MAX_SPEED,
  SLIDE_RANGE,
  PERFECT_MIN,
  GROW_STEP,
  COMBO_BONUS_CAP,
  MIN_OVERLAP,
  BIOMES,
  speedFor,
  perfectTolerance,
  biomeForHeight,
  colorForIndex,
  spawnSlide,
  createGame,
  startGame,
  advanceSlide,
  placeBlock,
} from '../src/engine.js'

const playingGame = (opts) => startGame(createGame(opts))

/** Force the slide to an exact position before a tap (deterministic tests). */
const tapAt = (state, pos) => {
  state.slide.pos = pos
  return placeBlock(state)
}

describe('skystack engine', () => {
  describe('createGame / startGame', () => {
    it('starts ready with a full-size base block and an x-axis slide', () => {
      const g = createGame()
      expect(g.status).toBe('ready')
      expect(g.blocks).toHaveLength(1)
      expect(g.blocks[0]).toMatchObject({ index: 0, x: 0, z: 0, w: BASE_SIZE, d: BASE_SIZE })
      expect(g.axis).toBe('x')
      expect(g.score).toBe(0)
      expect(g.combo).toBe(0)
      expect(BLOCK_HEIGHT).toBeGreaterThan(0)
    })

    it('startGame flips ready → playing and is a no-op on other statuses', () => {
      const g = createGame()
      startGame(g)
      expect(g.status).toBe('playing')
      g.status = 'over'
      startGame(g)
      expect(g.status).toBe('over')
    })

    it('placeBlock is ignored unless playing', () => {
      const g = createGame()
      expect(placeBlock(g).type).toBe('ignored')
      expect(g.blocks).toHaveLength(1)
    })
  })

  describe('advanceSlide (ping-pong)', () => {
    it('moves by speed*dt and reflects exactly at the range edges', () => {
      const slide = { pos: 0, dir: 1, speed: 4, range: 10 }
      advanceSlide(slide, 0.5)
      expect(slide.pos).toBeCloseTo(2)
      // Travel past the edge: 2 + 4*2.25 = 11 → reflects to 9, dir flips.
      advanceSlide(slide, 2.25)
      expect(slide.pos).toBeCloseTo(9)
      expect(slide.dir).toBe(-1)
    })

    it('reflects at the negative edge and clamps huge dt inside the band', () => {
      const slide = { pos: -9.5, dir: -1, speed: 5, range: 10 }
      advanceSlide(slide, 0.2) // -10.5 → reflects to -9.5, dir +1
      expect(slide.pos).toBeCloseTo(-9.5)
      expect(slide.dir).toBe(1)
      const wild = { pos: 0, dir: 1, speed: 300, range: 10 }
      advanceSlide(wild, 1)
      expect(Math.abs(wild.pos)).toBeLessThanOrEqual(10)
    })
  })

  describe('spawnSlide', () => {
    it('alternates the entry side per placed block and ramps speed', () => {
      const a = spawnSlide(0)
      const b = spawnSlide(1)
      expect(a.pos).toBe(-SLIDE_RANGE)
      expect(a.dir).toBe(1)
      expect(b.pos).toBe(SLIDE_RANGE)
      expect(b.dir).toBe(-1)
      expect(b.speed).toBeGreaterThan(a.speed)
    })

    it('speedFor ramps from BASE_SPEED and caps at MAX_SPEED', () => {
      expect(speedFor(0)).toBe(BASE_SPEED)
      expect(speedFor(10)).toBeGreaterThan(BASE_SPEED)
      expect(speedFor(10_000)).toBe(MAX_SPEED)
    })
  })

  describe('placeBlock — cut geometry', () => {
    it('trims the block to the intersection and emits matching debris (positive offset)', () => {
      const g = playingGame()
      const r = tapAt(g, 2) // top at x=0 size 7 → overlap 5
      expect(r.type).toBe('cut')
      expect(r.block).toMatchObject({ x: 1, w: 5, d: BASE_SIZE, z: 0 })
      expect(r.debris.w).toBeCloseTo(2)
      // Debris hugs the outer edge: center + delta/2 + size/2 = 0 + 1 + 3.5
      expect(r.debris.x).toBeCloseTo(4.5)
      expect(r.scoreGain).toBe(1)
      expect(g.score).toBe(1)
      expect(g.axis).toBe('z') // axis alternates
      expect(g.blocks[1]).toBe(r.block)
    })

    it('handles negative offsets mirrored (debris on the negative side)', () => {
      const g = playingGame()
      const r = tapAt(g, -2)
      expect(r.block.x).toBeCloseTo(-1)
      expect(r.debris.x).toBeCloseTo(-4.5)
    })

    it('cuts on the z axis after the first placement', () => {
      const g = playingGame()
      tapAt(g, 0) // perfect on x → axis now z
      const r = tapAt(g, 1.5)
      expect(r.type).toBe('cut')
      expect(r.block.z).toBeCloseTo(0.75)
      expect(r.block.d).toBeCloseTo(BASE_SIZE - 1.5)
      expect(r.block.w).toBeCloseTo(BASE_SIZE) // x untouched
      expect(r.debris.z).toBeCloseTo(4.25)
      expect(r.debris.d).toBeCloseTo(1.5)
    })

    it('a cut resets the combo', () => {
      const g = playingGame()
      tapAt(g, 0)
      expect(g.combo).toBe(1)
      tapAt(g, 2)
      expect(g.combo).toBe(0)
    })
  })

  describe('placeBlock — perfect snap', () => {
    it('snaps within tolerance keeping center/size, and pays combo bonus', () => {
      const g = playingGame()
      const r = tapAt(g, PERFECT_MIN * 0.9)
      expect(r.type).toBe('perfect')
      expect(r.block).toMatchObject({ x: 0, z: 0, w: BASE_SIZE, d: BASE_SIZE })
      expect(r.debris).toBeNull()
      expect(g.combo).toBe(1)
      expect(r.scoreGain).toBe(2) // 1 + combo(1)
    })

    it('perfect bonus is capped at COMBO_BONUS_CAP', () => {
      const g = playingGame()
      let last
      for (let i = 0; i < COMBO_BONUS_CAP + 3; i++) last = tapAt(g, 0)
      expect(last.scoreGain).toBe(1 + COMBO_BONUS_CAP)
    })

    it('tolerance is proportional to size with an absolute floor', () => {
      expect(perfectTolerance(BASE_SIZE)).toBeCloseTo(BASE_SIZE * 0.14)
      expect(perfectTolerance(0.2)).toBe(PERFECT_MIN)
    })

    it('regrows the footprint on the active axis once the streak reaches GROW_COMBO', () => {
      const g = playingGame()
      // Perfect taps must aim at the CURRENT top center on the active axis.
      const perfectTap = () => {
        const top = g.blocks[g.blocks.length - 1]
        return tapAt(g, g.axis === 'x' ? top.x : top.z)
      }
      // Shrink x first: cut of 2 → w=5, center x=1
      tapAt(g, 2) // axis → z
      perfectTap() // perfect on z (combo 1) → axis x
      perfectTap() // perfect on x (combo 2, below GROW_COMBO) → keeps w=5
      expect(g.blocks[g.blocks.length - 1].w).toBeCloseTo(5)
      perfectTap() // combo 3 on z → d grows (already at base, capped)
      const r = perfectTap() // combo 4 on x → w regrows by GROW_STEP
      expect(r.block.w).toBeCloseTo(5 + GROW_STEP)
      // Never grows past the base size
      for (let i = 0; i < 20; i++) perfectTap()
      const topBlock = g.blocks[g.blocks.length - 1]
      expect(topBlock.w).toBeLessThanOrEqual(BASE_SIZE)
      expect(topBlock.d).toBeLessThanOrEqual(BASE_SIZE)
    })
  })

  describe('placeBlock — game over', () => {
    it('ends the game when there is no overlap and drops the whole block', () => {
      const g = playingGame()
      const r = tapAt(g, BASE_SIZE + 1)
      expect(r.type).toBe('gameover')
      expect(g.status).toBe('over')
      expect(r.debris).toMatchObject({ w: BASE_SIZE, d: BASE_SIZE })
      expect(r.debris.x).toBeCloseTo(BASE_SIZE + 1)
      expect(g.blocks).toHaveLength(1) // nothing stacked
      expect(g.score).toBe(0)
    })

    it('slivers below MIN_OVERLAP also end the game', () => {
      const g = playingGame()
      const r = tapAt(g, BASE_SIZE - 0.01) // overlap 0.01 ≤ MIN_OVERLAP
      expect(r.type).toBe('gameover')
    })
  })

  describe('colors & biomes', () => {
    it('colorForIndex drifts hue, stays in valid HSL ranges and honors hueStart', () => {
      const a = colorForIndex(0, 200)
      const b = colorForIndex(1, 200)
      expect(a.h).toBeCloseTo(200)
      expect(b.h).toBeGreaterThan(a.h)
      for (let i = 0; i < 200; i++) {
        const c = colorForIndex(i, 733) // hueStart beyond 360 still normalizes
        expect(c.h).toBeGreaterThanOrEqual(0)
        expect(c.h).toBeLessThan(360)
        expect(c.s).toBeGreaterThan(0)
        expect(c.s).toBeLessThanOrEqual(1)
        expect(c.l).toBeGreaterThan(0.3)
        expect(c.l).toBeLessThan(0.8)
      }
    })

    it('biomeForHeight walks the BIOMES thresholds up to space', () => {
      expect(biomeForHeight(0)).toBe(0)
      expect(biomeForHeight(BIOMES[1].from)).toBe(1)
      expect(biomeForHeight(BIOMES[1].from - 1)).toBe(0)
      expect(biomeForHeight(9999)).toBe(BIOMES.length - 1)
      expect(BIOMES[BIOMES.length - 1].stars).toBe(true)
    })
  })

  describe('full run integrity', () => {
    it('a long mixed run keeps score/blocks/axis consistent', () => {
      const g = playingGame({ hueStart: 120 })
      let expectedScore = 0
      for (let i = 0; i < 40; i++) {
        const top = g.blocks[g.blocks.length - 1]
        const center = g.axis === 'x' ? top.x : top.z
        const size = g.axis === 'x' ? top.w : top.d
        // P-P-C-C pattern: since the axis alternates every placement, this
        // spreads the cuts across BOTH axes (P-C-P-C would starve one axis).
        const offset = i % 4 < 2 ? 0 : perfectTolerance(size) + 0.05
        const r = tapAt(g, center + offset)
        expect(['perfect', 'cut']).toContain(r.type)
        expectedScore += r.scoreGain
      }
      expect(g.score).toBe(expectedScore)
      expect(g.blocks).toHaveLength(41)
      expect(g.placed).toBe(40)
      expect(g.status).toBe('playing')
      // Every stacked block keeps a positive footprint
      for (const b of g.blocks) {
        expect(b.w).toBeGreaterThan(0)
        expect(b.d).toBeGreaterThan(0)
      }
    })
  })
})

describe('skystack: as três bordas que decidem a jogada', () => {
  /**
   * `overlap <= MIN_OVERLAP` é a lasca que NÃO conta. Afrouxada, uma sobra de
   * exatamente 0.02 unidade vira uma peça jogável de dois centésimos de largura
   * empilhada na torre: a partida continua com um bloco invisível.
   */
  it('a lasca de exatamente o mínimo é derrota, não peça', () => {
    const g = playingGame()
    const top = g.blocks[g.blocks.length - 1]
    // overlap = size - |delta|, então |delta| = size - MIN_OVERLAP dá o empate.
    g.slide.pos = top.x + (top.w - MIN_OVERLAP)
    expect(placeBlock(g).type).toBe('gameover')

    const g2 = playingGame()
    const t2 = g2.blocks[g2.blocks.length - 1]
    g2.slide.pos = t2.x + (t2.w - MIN_OVERLAP * 2)
    expect(placeBlock(g2).type).not.toBe('gameover')
  })

  /**
   * `Math.abs(delta) <= tol` é a tolerância do encaixe perfeito, e ela é
   * inclusiva: parar EM CIMA do limite ainda é perfeito. Apertada, o jogador
   * que acerta na borda da tolerância perde o combo sem entender por quê.
   */
  it('parar exatamente na tolerância ainda é perfeito', () => {
    const g = playingGame()
    const top = g.blocks[g.blocks.length - 1]
    const tol = perfectTolerance(top.w)
    g.slide.pos = top.x + tol
    expect(placeBlock(g).type).toBe('perfect')

    const g2 = playingGame()
    const t2 = g2.blocks[g2.blocks.length - 1]
    g2.slide.pos = t2.x + perfectTolerance(t2.w) * 1.0001
    expect(placeBlock(g2).type).toBe('cut')
  })

  /**
   * `pos > slide.range` é o ponto exato do rebote. Afrouxado, o bloco inverte
   * a direção um quadro ANTES de chegar na ponta e a faixa de movimento encolhe
   * -- o jogo fica mais fácil sem ninguém ter pedido.
   */
  it('chegar exatamente na ponta ainda é ida, não volta', () => {
    const s = { pos: 0, dir: 1, speed: 1, range: 2 }
    advanceSlide(s, 2) // pos = 2, exatamente a ponta
    expect(s.pos).toBe(2)
    expect(s.dir).toBe(1)

    advanceSlide(s, 0.5) // agora sim passa
    expect(s.dir).toBe(-1)
  })
})
