<template>
  <div
    ref="rootRef"
    class="ros-skystack"
    :class="{ 'ros-skystack--over': game.status === 'over', 'ros-skystack--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
    @pointerdown="onPointerDown"
  >
    <!-- Biome background — two layers crossfaded as the tower climbs -->
    <div
      class="ros-skystack__bg"
      :class="{ 'ros-skystack__bg--visible': activeBgLayer === 0 }"
      :style="bgLayerA"
    />
    <div
      class="ros-skystack__bg"
      :class="{ 'ros-skystack__bg--visible': activeBgLayer === 1 }"
      :style="bgLayerB"
    />
    <div
      class="ros-skystack__stars"
      :class="{ 'ros-skystack__stars--visible': starsVisible }"
      :style="starsStyle"
    />

    <canvas ref="canvasRef" class="ros-skystack__canvas" />

    <!-- HUD -->
    <div v-if="game.status === 'playing'" class="ros-skystack__hud" aria-hidden="true">
      <div class="ros-skystack__score">{{ game.score }}</div>
      <transition name="skystack-pop">
        <div v-if="game.combo >= 2" class="ros-skystack__combo">
          🔥 {{ txt('combo') }} ×{{ game.combo }}
        </div>
      </transition>
    </div>

    <div
      v-if="best > 0 && game.status === 'playing'"
      class="ros-skystack__best-badge"
      aria-hidden="true"
    >
      👑 {{ best }}
    </div>

    <!-- Sound toggle -->
    <button
      class="ros-skystack__sound"
      :aria-label="muted ? txt('soundOff') : txt('soundOn')"
      @pointerdown.stop
      @click.stop="toggleMute"
    >
      <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="20" />
    </button>

    <!-- Floating score gains -->
    <div class="ros-skystack__floats" aria-hidden="true">
      <transition-group name="skystack-float">
        <div
          v-for="f in floats"
          :key="f.id"
          class="ros-skystack__float"
          :class="{ 'ros-skystack__float--perfect': f.perfect }"
        >
          {{ f.text }}
        </div>
      </transition-group>
    </div>

    <!-- Start screen -->
    <div v-if="game.status === 'ready'" class="ros-skystack__start">
      <div class="ros-skystack__logo">{{ txt('title') }}</div>
      <div class="ros-skystack__tagline">{{ txt('tagline') }}</div>
      <div v-if="best > 0" class="ros-skystack__start-best">👑 {{ txt('best') }} · {{ best }}</div>
      <div class="ros-skystack__cta">{{ txt('tapToPlay') }}</div>
    </div>

    <!-- Pause overlay -->
    <div v-if="paused" class="ros-skystack__pause">
      <div class="ros-skystack__pause-title">{{ txt('paused') }}</div>
      <div class="ros-skystack__pause-cta">{{ txt('tapToResume') }}</div>
    </div>

    <!-- First-time hint -->
    <div v-if="showHint && game.status === 'playing'" class="ros-skystack__hint">
      {{ txt('hint') }}
    </div>

    <!-- Game over -->
    <div v-if="game.status === 'over'" class="ros-skystack__over">
      <div v-if="isRecord" class="ros-skystack__confetti" aria-hidden="true">
        <span
          v-for="(bit, i) in confetti"
          :key="i"
          class="ros-skystack__confetti-bit"
          :style="bit"
        />
      </div>
      <div class="ros-skystack__over-card">
        <div class="ros-skystack__over-label">{{ txt('height') }}</div>
        <div class="ros-skystack__over-score">{{ game.score }}</div>
        <div v-if="isRecord" class="ros-skystack__over-record">🏆 {{ txt('newRecord') }}</div>
        <div class="ros-skystack__over-stats">
          <span>👑 {{ txt('best') }} {{ best }}</span>
          <span class="ros-skystack__over-dot">·</span>
          <span>{{ txt('games') }} {{ games }}</span>
        </div>
        <div class="ros-skystack__over-actions">
          <button class="ros-skystack__btn-play" @pointerdown.stop @click.stop="restart">
            {{ txt('playAgain') }}
          </button>
          <button class="ros-skystack__btn-share" @pointerdown.stop @click.stop="shareScore">
            <Icone nome="compartilhar" :tamanho="16" />
            {{ txt('share') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// O SkyStack. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio,
// modo leve, métricas, avisos e armazenamento chegam por ele, e é por isso que
// o mesmo arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
//
// ⚠️ Tudo o que toca a GPU (renderer e as opções dele, pixel ratio, sombras,
// luzes, materiais, geometrias, o corte de qualidade do modo leve) veio do
// componente do RoqueOS SEM MUDANÇA. Mexer ali pede teste no iPhone de verdade
// antes de ir para produção: verde no desktop não é verde no iPhone.
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import {
  BLOCK_HEIGHT,
  BASE_SIZE,
  BIOMES,
  createGame,
  startGame,
  advanceSlide,
  placeBlock,
  biomeForHeight,
  colorForIndex,
} from './engine.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

// ── Reactive UI state ────────────────────────────────────────────────────────
const rootRef = ref(null)
const canvasRef = ref(null)
const game = reactive(createGame({ hueStart: Math.floor(Math.random() * 360) }))
const best = ref(0)
const games = ref(0)
const muted = ref(false)
const paused = ref(false)
const isRecord = ref(false)
const showHint = ref(false)
const floats = ref([])
const confetti = ref([])
const activeBgLayer = ref(0)
const bgLayerA = ref({})
const bgLayerB = ref({})
const starsVisible = ref(false)
const starsStyle = ref({})
const modoLeve = ref(false)

// ── Three.js internals (non-reactive on purpose) ─────────────────────────────
let renderer = null
let scene = null
let camera = null
let towerGroup = null
let activeMesh = null
let dirLight = null
let hemiLight = null
let unitBox = null
let ringGeo = null
let debris = [] // { mesh, vy, spin, axis }
let rings = [] // { mesh, life }
let dust = [] // { mesh, vx, vy, vz, life }
let rafId = 0
let lastT = 0
let running = false
let resizeObserver = null
let currentBiome = -1
let camFocusY = 0
let camView = 1
let lightTarget = 1
let hintPlacements = 0
let floatId = 0
let lowEnd = false
let pararIdentidade = null
const pendingTimers = new Set()

const later = (fn, ms) => {
  const id = setTimeout(() => {
    pendingTimers.delete(id)
    fn()
  }, ms)
  pendingTimers.add(id)
}

// ── Audio (all synthesized — zero assets) ────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)

// Chamado de dentro do gesto (toque, clique, tecla), sem `await` antes: o iOS
// só libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* audio is best-effort */
  }
}

/** Short rising arpeggio for a new record. */
const fanfare = () => {
  later(() => som.sino(3), 60)
  later(() => som.sino(5), 180)
  later(() => som.sino(8), 300)
}

const buzz = (pattern) => {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics are best-effort */
  }
}

// As chaves `best`, `games`, `muted` e `seen` viram `roqueos:skystack:<chave>`
// no host, as mesmas de antes da extração: quem já jogava não perde o recorde,
// e a galeria continua lendo o best dali.
const toggleMute = () => {
  muted.value = !muted.value
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── Colors / background biomes ───────────────────────────────────────────────
const threeColor = (index) => {
  const { h, s, l } = colorForIndex(index, game.hueStart)
  return new THREE.Color().setHSL(h / 360, s, l)
}

const biomeGradient = (b) => ({
  background: `linear-gradient(180deg, ${b.top} 0%, ${b.bottom} 100%)`,
})

const LIGHT_BY_BIOME = [1, 1.15, 0.95, 0.72, 0.62]

const applyBiome = (idx, instant = false) => {
  if (idx === currentBiome) return
  currentBiome = idx
  const grad = biomeGradient(BIOMES[idx])
  if (instant) {
    bgLayerA.value = grad
    activeBgLayer.value = 0
  } else if (activeBgLayer.value === 0) {
    bgLayerB.value = grad
    activeBgLayer.value = 1
  } else {
    bgLayerA.value = grad
    activeBgLayer.value = 0
  }
  starsVisible.value = !!BIOMES[idx].stars
  lightTarget = LIGHT_BY_BIOME[idx] ?? 1
}

const buildStars = () => {
  const parts = []
  for (let i = 0; i < 34; i++) {
    const x = Math.round(Math.random() * 100)
    const y = Math.round(Math.random() * 100)
    const r = (0.6 + Math.random() * 1.3).toFixed(1)
    const a = (0.35 + Math.random() * 0.55).toFixed(2)
    parts.push(
      `radial-gradient(${r}px ${r}px at ${x}% ${y}%, rgba(255,255,255,${a}) 50%, transparent 51%)`,
    )
  }
  starsStyle.value = { backgroundImage: parts.join(',') }
}

// ── Three.js scene ───────────────────────────────────────────────────────────
const FRUSTUM_HALF_W = 10.5
const FRUSTUM_HALF_H = 9.2

const updateFrustum = () => {
  if (!camera || !renderer) return
  const { width, height } = renderer.domElement.getBoundingClientRect()
  const w = width || 640
  const h = height || 480
  const aspect = w / h
  let halfW
  let halfH
  if (aspect >= FRUSTUM_HALF_W / FRUSTUM_HALF_H) {
    halfH = FRUSTUM_HALF_H
    halfW = halfH * aspect
  } else {
    halfW = FRUSTUM_HALF_W
    halfH = halfW / aspect
  }
  camera.left = -halfW * camView
  camera.right = halfW * camView
  camera.top = halfH * camView
  camera.bottom = -halfH * camView
  camera.updateProjectionMatrix()
}

const makeBlockMesh = (block, colorIndex) => {
  const mat = new THREE.MeshLambertMaterial({ color: threeColor(colorIndex) })
  const mesh = new THREE.Mesh(unitBox, mat)
  mesh.scale.set(block.w, BLOCK_HEIGHT, block.d)
  mesh.position.set(block.x, block.index * BLOCK_HEIGHT, block.z)
  mesh.castShadow = !lowEnd
  mesh.receiveShadow = !lowEnd
  return mesh
}

const disposeMesh = (mesh) => {
  mesh.parent?.remove(mesh)
  if (mesh.material) mesh.material.dispose()
}

const clearGroup = () => {
  for (const child of [...towerGroup.children]) disposeMesh(child)
  for (const d of debris) disposeMesh(d.mesh)
  for (const r of rings) disposeMesh(r.mesh)
  for (const p of dust) disposeMesh(p.mesh)
  debris = []
  rings = []
  dust = []
}

const buildTower = () => {
  clearGroup()
  // Pedestal descending far below the first block
  const pedestal = new THREE.Mesh(
    unitBox,
    new THREE.MeshLambertMaterial({ color: threeColor(0).multiplyScalar(0.55) }),
  )
  pedestal.scale.set(BASE_SIZE, 26, BASE_SIZE)
  pedestal.position.set(0, -13 - BLOCK_HEIGHT / 2, 0)
  pedestal.receiveShadow = !lowEnd
  towerGroup.add(pedestal)
  // Base block (engine index 0)
  towerGroup.add(makeBlockMesh(game.blocks[0], 0))
  // Sliding block, hidden until the game starts
  activeMesh = makeBlockMesh(game.blocks[0], 1)
  activeMesh.visible = false
  towerGroup.add(activeMesh)
}

const positionActiveMesh = () => {
  if (!activeMesh) return
  const top = game.blocks[game.blocks.length - 1]
  const y = (top.index + 1) * BLOCK_HEIGHT
  const x = game.axis === 'x' ? game.slide.pos : top.x
  const z = game.axis === 'z' ? game.slide.pos : top.z
  activeMesh.scale.set(top.w, BLOCK_HEIGHT, top.d)
  activeMesh.position.set(x, y, z)
}

const respawnActive = () => {
  if (!activeMesh) return
  activeMesh.material.color.copy(threeColor(game.placed + 1))
  activeMesh.visible = true
  positionActiveMesh()
}

const spawnDebris = (piece, colorIndex, kick = 0) => {
  const mesh = makeBlockMesh({ ...piece, index: piece.index }, colorIndex)
  towerGroup.add(mesh)
  debris.push({
    mesh,
    vy: -1.5 - kick,
    spin: (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2.5),
    axis: game.axis === 'x' ? 'z' : 'x', // tips over the cut edge
  })
}

const spawnRing = (block) => {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(ringGeo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(block.x, block.index * BLOCK_HEIGHT + BLOCK_HEIGHT / 2 + 0.02, block.z)
  mesh.scale.setScalar(Math.max(block.w, block.d))
  towerGroup.add(mesh)
  rings.push({ mesh, life: 0 })
}

const spawnDust = (block, colorIndex) => {
  if (lowEnd) return
  const color = threeColor(colorIndex)
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(unitBox, mat)
    mesh.scale.setScalar(0.14 + Math.random() * 0.1)
    mesh.position.set(block.x, block.index * BLOCK_HEIGHT, block.z)
    const ang = Math.random() * Math.PI * 2
    towerGroup.add(mesh)
    dust.push({
      mesh,
      vx: Math.cos(ang) * (2 + Math.random() * 2),
      vy: 2.5 + Math.random() * 2,
      vz: Math.sin(ang) * (2 + Math.random() * 2),
      life: 0,
    })
  }
}

/** Hide blocks buried deep below the camera to keep draw calls flat. */
const cullBuriedBlocks = () => {
  const cutoff = game.placed - 42
  if (cutoff <= 0) return
  for (const child of towerGroup.children) {
    if (child !== activeMesh && child.position.y < cutoff * BLOCK_HEIGHT - 14) {
      child.visible = false
    }
  }
}

const initThree = () => {
  // O perfil leve vem do host, lido uma vez ao montar, como antes (o front lia
  // o `isLowEndMode` aqui). A mesma leitura liga a classe do CSS leve.
  lowEnd = Boolean(host.desempenho.modoLeve())
  modoLeve.value = lowEnd
  scene = new THREE.Scene()
  towerGroup = new THREE.Group()
  scene.add(towerGroup)

  unitBox = new THREE.BoxGeometry(1, 1, 1)
  ringGeo = new THREE.RingGeometry(0.52, 0.6, 40)

  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400)
  camera.position.set(20, 16, 20)
  camera.lookAt(0, 0, 0)

  hemiLight = new THREE.HemisphereLight(0xffffff, 0x556677, 1)
  scene.add(hemiLight)
  dirLight = new THREE.DirectionalLight(0xffffff, 1.35)
  dirLight.position.set(14, 26, 9)
  scene.add(dirLight)
  scene.add(dirLight.target)

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    alpha: true,
    antialias: !lowEnd,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2))
  if (!lowEnd) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(1024, 1024)
    const s = 13
    dirLight.shadow.camera.left = -s
    dirLight.shadow.camera.right = s
    dirLight.shadow.camera.top = s
    dirLight.shadow.camera.bottom = -s
    dirLight.shadow.camera.far = 80
  }

  buildTower()
  handleResize()
}

const handleResize = () => {
  if (!renderer || !rootRef.value) return
  const w = rootRef.value.clientWidth || 640
  const h = rootRef.value.clientHeight || 480
  renderer.setSize(w, h, false)
  updateFrustum()
}

// ── Game loop ────────────────────────────────────────────────────────────────
const step = (dt) => {
  // Slide the active block
  if (game.status === 'playing' && !paused.value && activeMesh?.visible) {
    advanceSlide(game.slide, dt)
    positionActiveMesh()
  }

  // Debris physics (gravity + tip-over spin)
  const floorY = camFocusY - 30
  debris = debris.filter((d) => {
    d.vy -= 30 * dt
    d.mesh.position.y += d.vy * dt
    d.mesh.rotation[d.axis] += d.spin * dt
    if (d.mesh.position.y < floorY) {
      disposeMesh(d.mesh)
      return false
    }
    return true
  })

  // Perfect rings — expand and fade
  rings = rings.filter((r) => {
    r.life += dt
    const k = r.life / 0.55
    if (k >= 1) {
      disposeMesh(r.mesh)
      return false
    }
    r.mesh.scale.setScalar(r.mesh.scale.x + dt * 14)
    r.mesh.material.opacity = 0.85 * (1 - k)
    return true
  })

  // Cut dust
  dust = dust.filter((p) => {
    p.life += dt
    if (p.life >= 0.7) {
      disposeMesh(p.mesh)
      return false
    }
    p.vy -= 14 * dt
    p.mesh.position.x += p.vx * dt
    p.mesh.position.y += p.vy * dt
    p.mesh.position.z += p.vz * dt
    p.mesh.material.opacity = 0.9 * (1 - p.life / 0.7)
    return true
  })

  // Camera follow / game-over wide shot
  let targetFocus
  let targetView
  if (game.status === 'over') {
    const towerH = (game.placed + 1) * BLOCK_HEIGHT
    targetFocus = towerH / 2
    targetView = Math.min(4.5, Math.max(1, (towerH * 0.62 + 4) / FRUSTUM_HALF_H))
  } else {
    targetFocus = game.placed * BLOCK_HEIGHT
    targetView = 1
  }
  const ease = Math.min(1, dt * 4.5)
  camFocusY += (targetFocus - camFocusY) * ease
  if (Math.abs(targetView - camView) > 0.001) {
    camView += (targetView - camView) * ease
    updateFrustum()
  }
  camera.position.set(20, camFocusY + 16, 20)
  camera.lookAt(0, camFocusY, 0)
  dirLight.position.set(14, camFocusY + 26, 9)
  dirLight.target.position.set(0, camFocusY, 0)
  dirLight.target.updateMatrixWorld()

  // Ambient light follows the biome
  hemiLight.intensity += (lightTarget - hemiLight.intensity) * Math.min(1, dt * 2)
}

const tick = (now) => {
  if (!running) return
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0
  lastT = now
  step(dt)
  renderer.render(scene, camera)
  rafId = requestAnimationFrame(tick)
}

const startLoop = () => {
  if (running || !renderer) return
  running = true
  lastT = 0
  rafId = requestAnimationFrame(tick)
}

const stopLoop = () => {
  running = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

// ── Gameplay flow ────────────────────────────────────────────────────────────
const pushFloat = (text, perfect) => {
  const id = ++floatId
  floats.value.push({ id, text, perfect })
  if (floats.value.length > 3) floats.value.shift()
  later(() => {
    floats.value = floats.value.filter((f) => f.id !== id)
  }, 900)
}

const start = () => {
  startGame(game)
  respawnActive()
  showHint.value = !seenBefore()
  hintPlacements = 0
  host.metricas.evento('game_start')
}

const place = () => {
  const colorIndex = game.placed + 1
  const result = placeBlock(game)

  if (result.type === 'gameover') {
    activeMesh.visible = false
    spawnDebris(result.debris, colorIndex, 2)
    finishGame()
    return
  }

  towerGroup.add(makeBlockMesh(result.block, colorIndex))

  if (result.type === 'perfect') {
    spawnRing(result.block)
    som.sino(result.combo)
    buzz(18)
    pushFloat(`${txt('perfect')} +${result.scoreGain}`, true)
  } else {
    if (result.debris) spawnDebris(result.debris, colorIndex)
    spawnDust(result.block, colorIndex)
    som.baque()
    buzz(8)
  }

  respawnActive()
  applyBiome(biomeForHeight(game.placed))
  cullBuriedBlocks()

  if (showHint.value) {
    hintPlacements += 1
    if (hintPlacements >= 2) {
      showHint.value = false
      markSeen()
    }
  }
}

const finishGame = () => {
  games.value += 1
  isRecord.value = game.score > 0 && game.score > best.value
  if (isRecord.value) {
    best.value = game.score
    buildConfetti()
    fanfare()
    buzz([20, 40, 20, 40, 80])
  } else {
    som.desabou()
    buzz([40, 60, 80])
  }
  persistScores()
  host.metricas.evento('game_over', { score: game.score })
}

const restart = () => {
  const fresh = createGame({ hueStart: Math.floor(Math.random() * 360) })
  Object.assign(game, fresh)
  isRecord.value = false
  confetti.value = []
  floats.value = []
  camFocusY = 0
  camView = 1
  buildTower()
  updateFrustum()
  applyBiome(0)
  start()
}

const handlePrimary = () => {
  if (paused.value) {
    paused.value = false
    return
  }
  if (game.status === 'ready') start()
  else if (game.status === 'playing') place()
}

const onPointerDown = (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  primeAudio()
  handlePrimary()
}

// Só a janela ativa ouve o teclado. O ouvinte é do `window`, então com duas
// janelas de jogo abertas o espaço soltaria o bloco nas duas; o `ativo` vem do
// host (a janela em foco, no RoqueOS).
const onKeyDown = (e) => {
  if (!props.estado.ativo) return
  if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return
  if (game.status === 'over') return
  e.preventDefault()
  primeAudio()
  handlePrimary()
}

// ── Score persistence ────────────────────────────────────────────────────────
const seenBefore = () => host.armazenamento.ler('seen') === '1'

const markSeen = () => {
  host.armazenamento.gravar('seen', '1')
}

const loadLocal = () => {
  best.value = parseInt(host.armazenamento.ler('best'), 10) || 0
  games.value = parseInt(host.armazenamento.ler('games'), 10) || 0
  muted.value = host.armazenamento.ler('muted') === '1'
}

// O placar da conta leva `{ best, games }`, os dois números, com os mesmos
// nomes que o SkyStack gravava no documento dele antes da extração. Qual
// documento recebe isso é decisão do host do RoqueOS, não do jogo.
const persistScores = () => {
  host.armazenamento.gravar('best', String(best.value))
  host.armazenamento.gravar('games', String(games.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: best.value, games: games.value }))
    .catch(() => {})
}

// O placar da conta ganha do local quando é maior (recorde e partidas, cada
// um por si), e o local sobe quando o recorde dele é o maior. Convidado não tem
// placar na conta: o host devolve null e ignora o salvar.
const syncRemote = async () => {
  try {
    const remote = await host.placar.carregar()
    if (remote) {
      if ((remote.best || 0) > best.value) best.value = remote.best
      if ((remote.games || 0) > games.value) games.value = remote.games
      host.armazenamento.gravar('best', String(best.value))
      host.armazenamento.gravar('games', String(games.value))
    }
    if (best.value > (remote?.best || 0)) {
      await host.placar.salvar({ best: best.value, games: games.value })
    }
  } catch (err) {
    console.error('[SkyStack] Score sync failed:', err)
  }
}

// ── New-record confetti ──────────────────────────────────────────────────────
const buildConfetti = () => {
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff']
  confetti.value = Array.from({ length: 26 }, () => ({
    left: `${Math.round(Math.random() * 100)}%`,
    background: colors[Math.floor(Math.random() * colors.length)],
    animationDelay: `${(Math.random() * 0.8).toFixed(2)}s`,
    animationDuration: `${(1.6 + Math.random() * 1.4).toFixed(2)}s`,
    transform: `rotate(${Math.round(Math.random() * 360)}deg)`,
  }))
}

// ── Share (screenshot card) ──────────────────────────────────────────────────
const composeShareCard = () => {
  const w = 1080
  const h = 1350
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const biome = BIOMES[Math.max(0, currentBiome)]
  const grad = g.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, biome.top)
  grad.addColorStop(1, biome.bottom)
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)

  // Fresh frame of the tower, drawn "cover" into the middle band
  renderer.render(scene, camera)
  const src = renderer.domElement
  const bandY = 330
  const bandH = 760
  const scale = Math.max(w / src.width, bandH / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  g.drawImage(src, (w - dw) / 2, bandY + (bandH - dh) / 2, dw, dh)

  // Legibility scrims + copy
  const top = g.createLinearGradient(0, 0, 0, 430)
  top.addColorStop(0, 'rgba(0,0,0,0.55)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = top
  g.fillRect(0, 0, w, 430)
  const bottom = g.createLinearGradient(0, h - 260, 0, h)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(1, 'rgba(0,0,0,0.6)')
  g.fillStyle = bottom
  g.fillRect(0, h - 260, w, 260)

  g.textAlign = 'center'
  g.fillStyle = 'rgba(255,255,255,0.78)'
  g.font = '600 44px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(txt('height').toUpperCase(), w / 2, 150)
  g.fillStyle = '#ffffff'
  g.font = '200 300px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(String(game.score), w / 2, 420)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = '700 52px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText(`${txt('title')} · RoqueOS`, w / 2, h - 120)
  g.fillStyle = 'rgba(255,255,255,0.65)'
  g.font = '400 36px -apple-system, "Segoe UI", Roboto, sans-serif'
  g.fillText('roqueos.com.br', w / 2, h - 62)
  return c
}

const shareScore = async () => {
  try {
    const text = txt('shareText', { score: game.score })
    const url = 'https://roqueos.com.br'
    let blob = null
    try {
      const card = composeShareCard()
      blob = await new Promise((resolve) => card.toBlob(resolve, 'image/png'))
    } catch {
      blob = null
    }
    if (blob && navigator.share && navigator.canShare) {
      const file = new File([blob], 'skystack-score.png', { type: 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: txt('title') })
        return
      }
    }
    if (navigator.share) {
      await navigator.share({ text, url, title: txt('title') })
      return
    }
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'skystack-score.png'
      a.click()
      later(() => URL.revokeObjectURL(a.href), 4000)
      host.avisar(txt('shareSaved'), { tipo: 'sucesso' })
    }
  } catch (err) {
    if (err?.name === 'AbortError') return
    console.error('[SkyStack] Share failed:', err)
    // Era `errors.operationFailed` do RoqueOS. O texto veio para o JSON do jogo,
    // nos dez idiomas, igual ao que o RoqueOS mostrava.
    host.avisar(txt('operationFailed'), { tipo: 'erro' })
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// Perder o foco pausa a partida e para o laço: janela em segundo plano não
// gasta GPU. O `ativo` vem do host (a janela em foco, no RoqueOS; a aba em foco,
// no `yarn dev`).
watch(
  () => props.estado.ativo,
  (active) => {
    if (active === false) {
      if (game.status === 'playing') paused.value = true
      stopLoop()
    } else {
      startLoop()
    }
  },
)

const onVisibility = () => {
  if (document.hidden) {
    if (game.status === 'playing') paused.value = true
    stopLoop()
  } else if (props.estado.ativo !== false) {
    startLoop()
  }
}

onMounted(() => {
  loadLocal()
  buildStars()
  applyBiome(0, true)
  initThree()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê o recorde da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  startLoop()

  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(rootRef.value)
  window.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibility)

  if (emModoE2E()) {
    window.__skystack = {
      get state() {
        return game
      },
      place: handlePrimary,
      setSlidePos: (pos) => {
        game.slide.pos = pos
      },
      restart,
    }
  }
})

onUnmounted(() => {
  stopLoop()
  for (const id of pendingTimers) clearTimeout(id)
  pendingTimers.clear()
  window.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObserver?.disconnect()
  pararIdentidade?.()
  if (emModoE2E()) delete window.__skystack
  if (towerGroup) clearGroup()
  unitBox?.dispose()
  ringGeo?.dispose()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
})
</script>

<style scoped lang="scss">
// O estilo morava em `sky-stack/styles/ros-sky-stack.scss` no RoqueOS e veio
// para cá inteiro. Só mudou de onde vêm os tokens do sistema (e o perfil leve,
// no fim do arquivo).
.ros-skystack {
  // Os tokens do RoqueOS que o jogo usa. Cada um herda o do sistema quando ele
  // existe (e acompanha o tema escolhido) e cai no valor que o tema padrão do
  // RoqueOS dá hoje quando o jogo roda sozinho, porque fora do RoqueOS não há
  // `tokens-root.scss` nenhum carregado.
  --ros-skystack-texto: var(--ros-text, rgba(255, 255, 255, 0.95));
  --ros-skystack-texto-suave: var(--ros-text-muted, rgba(255, 255, 255, 0.72));
  --ros-skystack-texto-sutil: var(--ros-text-subtle, rgba(255, 255, 255, 0.62));
  --ros-skystack-texto-100: var(--ros-text-100, #ffffff);
  --ros-skystack-sombra-35: var(--ros-shadow-35, rgba(0, 0, 0, 0.35));
  --ros-skystack-sombra-40: var(--ros-shadow-40, rgba(0, 0, 0, 0.4));
  --ros-skystack-sombra-45: var(--ros-shadow-45, rgba(0, 0, 0, 0.45));
  --ros-skystack-sombra-lg: var(--ros-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.4));
  --ros-skystack-preto-rgb: var(--ros-black-rgb, 0, 0, 0);
  --ros-skystack-veu-30: var(--ros-scrim-30, rgba(0, 0, 0, 0.3));
  --ros-skystack-veu-40: var(--ros-scrim-40, rgba(0, 0, 0, 0.4));
  --ros-skystack-preenchimento-100: var(--ros-fill-100, rgba(255, 255, 255, 1));
  --ros-skystack-preenchimento-14: var(--ros-fill-14, rgba(255, 255, 255, 0.14));
  --ros-skystack-preenchimento-06: var(--ros-fill-06, rgba(255, 255, 255, 0.06));
  --ros-skystack-borda-sutil: var(--ros-border-subtle, rgba(255, 255, 255, 0.12));
  --ros-skystack-desfoque: var(--ros-backdrop-blur, blur(20px));
  --ros-skystack-acento-gradiente: var(
    --ros-accent-gradient,
    linear-gradient(135deg, #007aff 0%, #5856d6 100%)
  );
  // Cores de identidade deste jogo, como custom property para que um tema
  // consiga alcançá-las.
  --ros-skystack-fg-1: #ffd166;
  --ros-skystack-bg-1: #ef8fb7;
  --ros-skystack-bg-2: rgba(30, 30, 30, 0.62);
  --ros-skystack-bg-3: rgba(30, 30, 30, 0.95);
}

.ros-skystack {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;

  &__bg {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 1.6s ease;
    pointer-events: none;

    &--visible {
      opacity: 1;
    }
  }

  &__stars {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 2s ease;
    pointer-events: none;
    animation: skystack-twinkle 5s ease-in-out infinite;

    &--visible {
      opacity: 1;
    }
  }

  &__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  &__hud {
    position: absolute;
    top: 18px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }

  &__score {
    font-size: 64px;
    font-weight: 200;
    line-height: 1;
    color: var(--ros-skystack-texto);
    text-shadow: 0 2px 18px var(--ros-skystack-sombra-35);
    font-variant-numeric: tabular-nums;
  }

  &__combo {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--ros-skystack-fg-1);
    background: rgba(var(--ros-skystack-preto-rgb), 0.28);
    padding: 4px 12px;
    border-radius: 999px;
    text-shadow: 0 1px 6px var(--ros-skystack-sombra-40);
  }

  &__best-badge {
    position: absolute;
    top: 16px;
    left: 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ros-skystack-texto-suave);
    background: rgba(var(--ros-skystack-preto-rgb), 0.22);
    padding: 4px 10px;
    border-radius: 999px;
    pointer-events: none;
  }

  &__sound {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(var(--ros-skystack-preto-rgb), 0.22);
    color: var(--ros-skystack-texto-suave);
    cursor: pointer;
    z-index: 5;
    transition: background 0.15s ease;

    &:hover {
      background: var(--ros-skystack-veu-40);
      color: var(--ros-skystack-texto);

      @media (max-width: 768px) {
        top: 58px;
      }
    }
  }

  // ── Floating gains ─────────────────────────────────────────────────────────
  &__floats {
    position: absolute;
    top: 110px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    pointer-events: none;
  }

  &__float {
    font-size: 15px;
    font-weight: 700;
    color: var(--ros-skystack-texto);
    text-shadow: 0 1px 8px var(--ros-skystack-sombra-45);

    &--perfect {
      color: var(--ros-skystack-fg-1);
      font-size: 17px;
    }
  }

  // ── Start screen ───────────────────────────────────────────────────────────
  &__start {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding-top: clamp(48px, 16%, 140px);
    pointer-events: none;
  }

  &__logo {
    font-size: clamp(40px, 9vw, 58px);
    font-weight: 800;
    letter-spacing: -1.5px;
    background: linear-gradient(
      120deg,
      var(--ros-skystack-preenchimento-100) 10%,
      var(--ros-skystack-fg-1) 45%,
      var(--ros-skystack-bg-1) 80%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 18px var(--ros-skystack-sombra-35));
  }

  &__tagline {
    margin-top: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--ros-skystack-texto-suave);
    letter-spacing: 0.4px;
  }

  &__start-best {
    margin-top: 22px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ros-skystack-texto);
    background: rgba(var(--ros-skystack-preto-rgb), 0.24);
    padding: 6px 14px;
    border-radius: 999px;
  }

  &__cta {
    position: absolute;
    bottom: calc(18% + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ros-skystack-texto);
    animation: skystack-pulse 1.6s ease-in-out infinite;
  }

  // ── Pause ──────────────────────────────────────────────────────────────────
  &__pause {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(var(--ros-skystack-preto-rgb), 0.35);
    pointer-events: none;
  }

  &__pause-title {
    font-size: 26px;
    font-weight: 700;
    color: var(--ros-skystack-texto);
    letter-spacing: 2px;
  }

  &__pause-cta {
    font-size: 14px;
    color: var(--ros-skystack-texto-suave);
  }

  &__hint {
    position: absolute;
    bottom: calc(14% + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    color: var(--ros-skystack-texto);
    background: var(--ros-skystack-veu-30);
    padding: 8px 16px;
    border-radius: 999px;
    pointer-events: none;
    animation: skystack-pulse 2s ease-in-out infinite;
  }

  // ── Game over ──────────────────────────────────────────────────────────────
  &__over {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(var(--ros-skystack-preto-rgb), 0.34);
    animation: skystack-fade-in 0.45s ease both;
  }

  &__over-card {
    // No RoqueOS o normalize do Quasar deixa tudo em border-box; sozinho, sem
    // isto, o cartão ganhava o padding por fora e ficava 52 px mais largo.
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(340px, 92%);
    padding: 30px 26px 26px;
    border-radius: 22px;
    background: var(--ros-skystack-bg-2);
    backdrop-filter: var(--ros-skystack-desfoque);
    -webkit-backdrop-filter: var(--ros-skystack-desfoque);
    border: 1px solid var(--ros-skystack-borda-sutil);
    box-shadow: var(--ros-skystack-sombra-lg);
  }

  &__over-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: var(--ros-skystack-texto-sutil);
  }

  &__over-score {
    font-size: 84px;
    font-weight: 200;
    line-height: 1.05;
    color: var(--ros-skystack-texto);
    font-variant-numeric: tabular-nums;
  }

  &__over-record {
    margin-top: 2px;
    font-size: 15px;
    font-weight: 700;
    color: var(--ros-skystack-fg-1);
    animation: skystack-pulse 1.4s ease-in-out infinite;
  }

  &__over-stats {
    margin-top: 12px;
    display: flex;
    gap: 8px;
    font-size: 13px;
    color: var(--ros-skystack-texto-suave);
  }

  &__over-dot {
    opacity: 0.5;
  }

  &__over-actions {
    margin-top: 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  // Os dois botões herdam a fonte da página, como no RoqueOS, onde o normalize
  // do Quasar faz isso por todo botão; sozinho, sem isto, eles caíam na fonte
  // padrão de botão do navegador (Arial no Chromium) e com outra altura de linha.
  &__btn-play {
    font: inherit;
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 12px;
    background: var(--ros-skystack-acento-gradiente);
    color: var(--ros-skystack-texto-100);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: filter 0.15s ease;

    &:hover {
      filter: brightness(1.12);
    }
  }

  &__btn-share {
    font: inherit;
    width: 100%;
    padding: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid var(--ros-skystack-borda-sutil);
    border-radius: 12px;
    background: var(--ros-skystack-preenchimento-06);
    color: var(--ros-skystack-texto);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: var(--ros-skystack-preenchimento-14);
    }
  }

  // ── Confetti (new record) ──────────────────────────────────────────────────
  &__confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  &__confetti-bit {
    position: absolute;
    top: -14px;
    width: 8px;
    height: 13px;
    border-radius: 2px;
    animation: skystack-confetti linear both infinite;
  }
}

// ── Animations ───────────────────────────────────────────────────────────────
@keyframes skystack-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@keyframes skystack-twinkle {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(0.7);
  }
}

@keyframes skystack-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes skystack-confetti {
  to {
    transform: translateY(115vh) rotate(680deg);
  }
}

.skystack-pop-enter-active,
.skystack-pop-leave-active {
  transition:
    transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease;
}

.skystack-pop-enter-from,
.skystack-pop-leave-to {
  transform: scale(0.6);
  opacity: 0;
}

.skystack-float-enter-active {
  transition:
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.3s ease;
}

.skystack-float-leave-active {
  transition:
    transform 0.5s ease,
    opacity 0.5s ease;
}

.skystack-float-enter-from {
  transform: translateY(10px) scale(0.7);
  opacity: 0;
}

.skystack-float-leave-to {
  transform: translateY(-26px);
  opacity: 0;
}

// Low-end mode: flatten the expensive layers. O perfil leve vem do host
// (`desempenho.modoLeve`), não do atributo que o RoqueOS põe no <html>: fora do
// RoqueOS esse atributo não existe.
.ros-skystack--low {
  .ros-skystack__bg,
  .ros-skystack__stars {
    transition: none;
  }

  .ros-skystack__stars {
    animation: none;
  }

  .ros-skystack__over-card {
    background: var(--ros-skystack-bg-3);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .ros-skystack__confetti {
    display: none;
  }
}
</style>
