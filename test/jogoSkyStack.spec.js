// O SkyStack inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. Os oito casos
// do teste que rodava no front antes da extração, em 25/09/2026, estão aqui,
// com os nomes em português.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'
import jogo from '../src/index.js'
import { SLIDE_RANGE } from '../src/engine.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/JogoSkyStack.vue?raw'

const { renderizadores, luzes } = vi.hoisted(() => ({ renderizadores: [], luzes: [] }))

// O jsdom não tem WebGL. Este é o dublê do three que o teste do front já usava:
// a cena mínima que o SkyStack toca, sem GPU nenhuma. Fica aqui, e não no
// `test/preparar.js`, porque só este arquivo monta o jogo. O que há a mais é o
// renderer anotar as opções, o pixel ratio, o mapa de sombra e o descarte, e a
// luz anotar a sombra, para o teste afirmar que o perfil leve do host chega na
// GPU do mesmo jeito que chegava antes e que desmontar solta o renderer.
vi.mock('three', () => {
  class Vec3 {
    constructor() {
      this.x = 0
      this.y = 0
      this.z = 0
    }
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
    }
    setScalar(s) {
      return this.set(s, s, s)
    }
  }
  class Color {
    setHSL() {
      return this
    }
    copy() {
      return this
    }
    multiplyScalar() {
      return this
    }
  }
  class Object3D {
    constructor() {
      this.children = []
      this.position = new Vec3()
      this.scale = new Vec3()
      this.rotation = { x: 0, y: 0, z: 0 }
      this.visible = true
      this.parent = null
      this.castShadow = false
      this.receiveShadow = false
    }
    add(...items) {
      for (const item of items) {
        item.parent = this
        this.children.push(item)
      }
    }
    remove(item) {
      this.children = this.children.filter((c) => c !== item)
    }
    lookAt() {}
    updateMatrixWorld() {}
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super()
      this.geometry = geometry
      this.material = material
    }
  }
  class Light extends Object3D {
    constructor() {
      super()
      this.intensity = 1
      this.target = new Object3D()
      this.shadow = {
        mapSize: {
          set(w, h) {
            this.w = w
            this.h = h
          },
        },
        camera: {},
      }
      luzes.push(this)
    }
  }
  class Camera extends Object3D {
    updateProjectionMatrix() {}
  }
  class Geometry {
    dispose() {}
  }
  class Material {
    constructor(opts = {}) {
      Object.assign(this, opts)
      this.color = opts.color instanceof Color ? opts.color : new Color()
      this.opacity = opts.opacity ?? 1
    }
    dispose() {}
  }
  class WebGLRenderer {
    constructor(opcoes) {
      this.opcoes = opcoes
      this.descartado = false
      this.domElement = document.createElement('canvas')
      this.domElement.width = 640
      this.domElement.height = 480
      this.shadowMap = {}
      renderizadores.push(this)
    }
    setClearColor() {}
    setPixelRatio(v) {
      this.pixelRatio = v
    }
    setSize() {}
    render() {
      this.desenhos = (this.desenhos ?? 0) + 1
    }
    dispose() {
      this.descartado = true
    }
  }
  return {
    Scene: Object3D,
    Group: Object3D,
    Mesh,
    BoxGeometry: Geometry,
    RingGeometry: Geometry,
    MeshLambertMaterial: Material,
    MeshBasicMaterial: Material,
    OrthographicCamera: Camera,
    HemisphereLight: Light,
    DirectionalLight: Light,
    Color,
    WebGLRenderer,
    PCFSoftShadowMap: 1,
    DoubleSide: 2,
  }
})

// O cartão de compartilhar é desenhado num canvas 2d, que o jsdom também não tem.
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient') return () => ({ addColorStop() {} })
        return () => {}
      },
      set: () => true,
    },
  )

let el = null
let host = null
let montagem = null
// O laço do jogo fica parado até o teste rodar um quadro com `quadros(n)`.
const pedidosDeQuadro = new Map()
let proximoQuadro = 0
let relogio = 1000

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-skystack')) throw new Error('o SkyStack ainda não montou')
  })
const montar = async ({ ativo = true, antes, ...opcoesDoHost } = {}) => {
  host = criarHostFalso({ jogoId: 'skystack', ...opcoesDoHost })
  await antes?.(host)
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const avisos = () => host.chamadas.filter((c) => c.capacidade === 'avisar').map((c) => c.args)
const salvamentos = () =>
  host.chamadas.filter((c) => c.capacidade === 'placar' && c.metodo === 'salvar').map((c) => c.args)
const tocar = async (alvo = $('.ros-skystack')) => {
  alvo.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
  await nextTick()
}
const clicar = async (sel) => {
  await tocar($(sel))
  $(sel).click()
  await nextTick()
}
const tecla = async (code) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }))
  await nextTick()
}
const quadros = (n, passoMs = 50) => {
  for (let i = 0; i < n; i++) {
    relogio += passoMs
    const [id, fn] = pedidosDeQuadro.entries().next().value ?? []
    if (!fn) return
    pedidosDeQuadro.delete(id)
    fn(relogio)
  }
}
const sky = () => window.__skystack
// Solta o bloco com o deslize parado em `pos` (0 é em cima da torre: perfeito).
const soltarEm = async (pos) => {
  sky().setSlidePos(pos)
  await tocar()
}

describe('SkyStack pelo jogo-sdk', () => {
  let origCtx
  let origToBlob
  let origURL
  beforeEach(() => {
    // O gancho de QA (`window.__skystack`) só existe em modo E2E, e é por ele que
    // o teste para o deslize onde quer.
    window.__ROS_E2E__ = {}
    origCtx = HTMLCanvasElement.prototype.getContext
    origToBlob = HTMLCanvasElement.prototype.toBlob
    origURL = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d())
    pedidosDeQuadro.clear()
    renderizadores.length = 0
    luzes.length = 0
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      pedidosDeQuadro.set(++proximoQuadro, fn)
      return proximoQuadro
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => pedidosDeQuadro.delete(id))
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    HTMLCanvasElement.prototype.getContext = origCtx
    HTMLCanvasElement.prototype.toBlob = origToBlob
    delete window.__ROS_E2E__
    delete window.__skystack
    delete navigator.share
    delete document.hidden
    for (const [nome, fn] of Object.entries(origURL)) {
      if (fn) URL[nome] = fn
      else delete URL[nome]
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('skystack')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  it('abre na tela inicial com o nome, a chamada e o convite, sem placar', async () => {
    await montar()
    expect($('.ros-skystack__logo').textContent).toBe(ptBR.title)
    expect($('.ros-skystack__tagline').textContent).toBe(ptBR.tagline)
    expect($('.ros-skystack__cta').textContent).toBe(ptBR.tapToPlay)
    expect($('.ros-skystack__hud')).toBeNull()
    expect($('.ros-skystack__start-best')).toBeNull()
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-skystack__cta').textContent).toBe(enUS.tapToPlay)
    expect($('.ros-skystack').getAttribute('dir')).toBe('ltr')
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-skystack__cta').textContent).toBe(ptBR.tapToPlay))
  })

  it('em árabe a tela corre da direita para a esquerda', async () => {
    await montar({ idioma: 'ar-AR' })
    expect($('.ros-skystack').getAttribute('dir')).toBe('rtl')
  })

  it('o primeiro toque começa a partida, mostra o placar e registra game_start', async () => {
    await montar()
    await tocar()
    expect(sky().state.status).toBe('playing')
    expect($('.ros-skystack__score').textContent).toBe('0')
    expect(eventos('game_start').map((c) => c.args)).toEqual([['game_start', {}]])
  })

  it('o bloco centrado é perfeito: soma o bônus do combo e mostra o ganho', async () => {
    await montar()
    await tocar() // começa
    await soltarEm(0) // perfeito
    const st = sky().state
    expect(st.blocks).toHaveLength(2)
    expect(st.combo).toBe(1)
    expect(st.score).toBe(2) // 1 + bônus do combo
    expect($('.ros-skystack__score').textContent).toBe('2')
    expect($('.ros-skystack__float--perfect').textContent.trim()).toBe(`${ptBR.perfect} +2`)
    expect($('.ros-skystack__combo')).toBeNull()

    await soltarEm(0) // segundo perfeito seguido
    expect(sky().state.score).toBe(5)
    expect($('.ros-skystack__combo').textContent.trim()).toBe(`🔥 ${ptBR.combo} ×2`)
  })

  it('errar tudo acaba a partida, mostra o cartão e recomeça limpo', async () => {
    await montar()
    await tocar() // começa
    await soltarEm(SLIDE_RANGE) // longe da base: derrota
    expect(sky().state.status).toBe('over')
    await nextTick()
    expect($('.ros-skystack__over-card')).not.toBeNull()
    expect($('.ros-skystack__over-label').textContent).toBe(ptBR.height)
    // Zero pontos não é recorde.
    expect($('.ros-skystack__over-record')).toBeNull()
    expect(eventos('game_over').map((c) => c.args)).toEqual([['game_over', { score: 0 }]])
    expect(host.storage.getItem('roqueos:skystack:games')).toBe('1')

    await clicar('.ros-skystack__btn-play')
    expect(sky().state.status).toBe('playing')
    expect(sky().state.blocks).toHaveLength(1)
    expect($('.ros-skystack__over-card')).toBeNull()
    expect(eventos('game_start')).toHaveLength(2)
  })

  it('o recorde novo fica nas chaves de antes e a tela comemora', async () => {
    await montar()
    await tocar() // começa
    await soltarEm(0) // 2 pontos
    await soltarEm(SLIDE_RANGE) // acaba com 2
    await nextTick()
    expect(host.storage.getItem('roqueos:skystack:best')).toBe('2')
    expect(host.storage.getItem('roqueos:skystack:games')).toBe('1')
    expect($('.ros-skystack__over-record').textContent.trim()).toBe(`🏆 ${ptBR.newRecord}`)
    expect($('.ros-skystack__confetti')).not.toBeNull()
    expect($('.ros-skystack__over-stats').textContent).toContain(`${ptBR.best} 2`)
    expect($('.ros-skystack__over-stats').textContent).toContain(`${ptBR.games} 1`)
  })

  it('abre lendo recorde, partidas e mudo das chaves de antes', async () => {
    await montar({
      antes: (h) => {
        h.storage.setItem('roqueos:skystack:best', '7')
        h.storage.setItem('roqueos:skystack:games', '3')
        h.storage.setItem('roqueos:skystack:muted', '1')
      },
    })
    expect($('.ros-skystack__start-best').textContent).toContain('7')
    expect($('.ros-skystack__sound').getAttribute('aria-label')).toBe(ptBR.soundOff)
    await tocar()
    expect($('.ros-skystack__best-badge').textContent).toContain('7')
    await soltarEm(SLIDE_RANGE)
    expect(host.storage.getItem('roqueos:skystack:games')).toBe('4')
    expect(host.storage.getItem('roqueos:skystack:best')).toBe('7')
  })

  it('o som liga e desliga na chave de antes, e o botão não solta bloco', async () => {
    await montar()
    await tocar() // começa
    const antes = sky().state.blocks.length
    await clicar('.ros-skystack__sound')
    expect(host.storage.getItem('roqueos:skystack:muted')).toBe('1')
    expect($('.ros-skystack__sound').getAttribute('aria-label')).toBe(ptBR.soundOff)
    expect(sky().state.blocks).toHaveLength(antes)
    await clicar('.ros-skystack__sound')
    expect(host.storage.getItem('roqueos:skystack:muted')).toBe('0')
    expect($('.ros-skystack__sound').getAttribute('aria-label')).toBe(ptBR.soundOn)
  })

  it('perder o foco pausa; o toque que tira a pausa não solta bloco', async () => {
    await montar()
    await tocar() // começa
    montagem.ativar(false)
    await nextTick()
    expect($('.ros-skystack__pause-title').textContent).toBe(ptBR.paused)
    montagem.ativar(true)
    await nextTick()
    const antes = sky().state.blocks.length
    await tocar() // só tira a pausa
    expect($('.ros-skystack__pause')).toBeNull()
    expect(sky().state.blocks).toHaveLength(antes)
  })

  it('a aba escondida também pausa e para o laço; ao voltar, o laço volta', async () => {
    await montar()
    await tocar()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect($('.ros-skystack__pause')).not.toBeNull()
    expect(pedidosDeQuadro.size).toBe(0)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pedidosDeQuadro.size).toBe(1)
  })

  it('o laço de verdade move o bloco; sem foco ele para de desenhar, e a pausa congela', async () => {
    await montar()
    await tocar()
    const inicio = sky().state.slide.pos
    quadros(6)
    const andou = sky().state.slide.pos
    expect(andou).not.toBe(inicio)

    // Janela em segundo plano não gasta GPU: nenhum quadro pedido, nada desenhado.
    montagem.ativar(false)
    await nextTick()
    const desenhos = renderizadores[0].desenhos
    expect(pedidosDeQuadro.size).toBe(0)
    quadros(6)
    expect(renderizadores[0].desenhos).toBe(desenhos)
    expect(sky().state.slide.pos).toBe(andou)
    montagem.ativar(true)
    await nextTick()
    quadros(6) // o laço volta, mas a partida segue pausada
    expect(sky().state.slide.pos).toBe(andou)

    await tocar() // tira a pausa
    quadros(6)
    expect(sky().state.slide.pos).not.toBe(andou)
  })

  it('só a janela ativa ouve o teclado', async () => {
    await montar({ ativo: false })
    await tecla('Space')
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-skystack__start')).not.toBeNull()

    montagem.ativar(true)
    await nextTick()
    await tecla('Space')
    expect(eventos('game_start')).toHaveLength(1)
    expect($('.ros-skystack__start')).toBeNull()
    sky().setSlidePos(0)
    await tecla('Enter')
    expect(sky().state.blocks).toHaveLength(2)
    sky().setSlidePos(0)
    await tecla('NumpadEnter')
    expect(sky().state.blocks).toHaveLength(3)

    montagem.ativar(false)
    await nextTick()
    await tecla('Space') // só tiraria a pausa, se ouvisse
    expect($('.ros-skystack__pause')).not.toBeNull()
  })

  it('no fim da partida o teclado não recomeça: só o botão', async () => {
    await montar()
    await tecla('Space')
    sky().setSlidePos(SLIDE_RANGE)
    await tecla('Space')
    expect(sky().state.status).toBe('over')
    await tecla('Space')
    await tecla('Enter')
    expect(sky().state.status).toBe('over')
    expect(eventos('game_start')).toHaveLength(1)
  })

  it('a dica aparece só até a segunda peça da primeira partida, pela chave seen de antes', async () => {
    await montar()
    await tocar()
    expect($('.ros-skystack__hint').textContent.trim()).toBe(ptBR.hint)
    await soltarEm(0)
    expect($('.ros-skystack__hint')).not.toBeNull()
    expect(host.storage.getItem('roqueos:skystack:seen')).toBeNull()
    await soltarEm(0)
    expect($('.ros-skystack__hint')).toBeNull()
    expect(host.storage.getItem('roqueos:skystack:seen')).toBe('1')
    montagem.desmontar()
    el.remove()

    await montar({ antes: (h) => h.storage.setItem('roqueos:skystack:seen', '1') })
    await tocar()
    expect(sky().state.status).toBe('playing')
    expect($('.ros-skystack__hint')).toBeNull()
  })

  describe('o placar da conta', () => {
    // Antes da extração o SkyStack gravava `{ best, games }`, os dois números, num
    // documento próprio (`users/{uid}/roqueos/skystack`). O host do RoqueOS aponta
    // o placar do skystack para esse mesmo documento; o jogo só precisa mandar os
    // mesmos nomes e os mesmos tipos de antes.
    it('recebe best e games, números, com os nomes de antes', async () => {
      await montar()
      await tocar()
      await soltarEm(0) // 2 pontos
      await soltarEm(SLIDE_RANGE) // acaba com 2
      await vi.waitFor(() => expect(salvamentos()).toHaveLength(1))
      const [[dados]] = salvamentos()
      expect(Object.keys(dados).sort()).toEqual(['best', 'games'])
      expect(dados).toEqual({ best: 2, games: 1 })
      expect(typeof dados.best).toBe('number')
      expect(typeof dados.games).toBe('number')
      expect(await host.placar.carregar()).toEqual({ best: 2, games: 1 })
    })

    it('convidado não tem placar na conta: o recorde fica só no aparelho', async () => {
      await montar({
        antes: (h) => {
          // O host do RoqueOS, para convidado: carregar devolve null e salvar não grava.
          h.placar.carregar = vi.fn(async () => null)
          h.placar.salvar = vi.fn(async () => false)
        },
      })
      await tocar()
      await soltarEm(0)
      await soltarEm(SLIDE_RANGE)
      await nextTick()
      expect(host.storage.getItem('roqueos:skystack:best')).toBe('2')
      expect($('.ros-skystack__over-record')).not.toBeNull()
      await vi.waitFor(() => expect(host.placar.salvar).toHaveBeenCalledWith({ best: 2, games: 1 }))
      expect(avisos()).toEqual([])
    })

    it('recorde e partidas da conta maiores que os locais vêm para a tela e para as chaves', async () => {
      await montar({
        antes: async (h) => {
          h.storage.setItem('roqueos:skystack:games', '3')
          await h.placar.salvar({ best: 500, games: 7 })
        },
      })
      await vi.waitFor(() => expect(host.storage.getItem('roqueos:skystack:best')).toBe('500'))
      expect(host.storage.getItem('roqueos:skystack:games')).toBe('7')
      await nextTick()
      expect($('.ros-skystack__start-best').textContent).toContain('500')
    })

    it('o recorde local maior que o da conta sobe para a conta', async () => {
      await montar({
        antes: (h) => {
          h.storage.setItem('roqueos:skystack:best', '300')
          h.storage.setItem('roqueos:skystack:games', '4')
        },
      })
      await vi.waitFor(async () =>
        expect(await host.placar.carregar()).toEqual({ best: 300, games: 4 }),
      )
    })

    it('entrar na conta com o jogo aberto busca o placar da conta de novo', async () => {
      await montar()
      await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
      host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
      await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
    })
  })

  describe('o perfil leve chega na GPU como chegava antes', () => {
    it('com o perfil leve: sem antialias, pixel ratio até 1,25 e sem sombra', async () => {
      vi.stubGlobal('devicePixelRatio', 3)
      await montar({ modoLeve: true })
      expect($('.ros-skystack').classList.contains('ros-skystack--low')).toBe(true)
      expect(renderizadores).toHaveLength(1)
      expect(renderizadores[0].opcoes).toMatchObject({
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance',
      })
      expect(renderizadores[0].pixelRatio).toBe(1.25)
      expect(renderizadores[0].shadowMap).toEqual({})
      const sol = luzes.find((l) => l.castShadow)
      expect(sol).toBeUndefined()
    })

    it('sem o perfil leve: antialias, pixel ratio até 2 e sombra suave de 1024', async () => {
      vi.stubGlobal('devicePixelRatio', 3)
      await montar()
      expect($('.ros-skystack').classList.contains('ros-skystack--low')).toBe(false)
      expect(renderizadores[0].opcoes).toMatchObject({
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      })
      expect(renderizadores[0].pixelRatio).toBe(2)
      expect(renderizadores[0].shadowMap).toEqual({ enabled: true, type: 1 })
      const sol = luzes.find((l) => l.castShadow)
      expect(sol.shadow.mapSize).toMatchObject({ w: 1024, h: 1024 })
      expect(sol.shadow.camera).toEqual({ left: -13, right: 13, top: 13, bottom: -13, far: 80 })
    })
  })

  describe('compartilhar o recorde', () => {
    const acabar = async () => {
      await montar()
      await tocar()
      await soltarEm(0)
      await soltarEm(SLIDE_RANGE) // acaba com 2
      await nextTick()
      HTMLCanvasElement.prototype.toBlob = function (fn) {
        fn(new Blob(['png'], { type: 'image/png' }))
      }
    }

    it('sem compartilhamento no navegador, baixa a imagem e avisa com sucesso', async () => {
      await acabar()
      URL.createObjectURL = vi.fn(() => 'blob:skystack')
      URL.revokeObjectURL = vi.fn()
      const baixar = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      await clicar('.ros-skystack__btn-share')
      await vi.waitFor(() => expect(avisos()).toEqual([[ptBR.shareSaved, { tipo: 'sucesso' }]]))
      expect(baixar).toHaveBeenCalledTimes(1)
      expect(baixar.mock.contexts[0].download).toBe('skystack-score.png')
    })

    it('com compartilhamento, manda o texto do idioma com os pontos e o nome do jogo', async () => {
      await acabar()
      navigator.share = vi.fn(async () => {})
      await clicar('.ros-skystack__btn-share')
      await vi.waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1))
      expect(navigator.share).toHaveBeenCalledWith({
        text: ptBR.shareText.replace('{score}', '2'),
        url: 'https://roqueos.com.br',
        title: ptBR.title,
      })
      expect(avisos()).toEqual([])
    })

    it('a falha avisa com o texto de erro do jogo; cancelar não avisa nada', async () => {
      await acabar()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      navigator.share = vi.fn(async () => {
        throw new Error('falhou')
      })
      await clicar('.ros-skystack__btn-share')
      await vi.waitFor(() => expect(avisos()).toEqual([[ptBR.operationFailed, { tipo: 'erro' }]]))

      navigator.share = vi.fn(async () => {
        throw new DOMException('cancelado', 'AbortError')
      })
      await clicar('.ros-skystack__btn-share')
      await vi.waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1))
      await new Promise((r) => setTimeout(r, 20))
      expect(avisos()).toHaveLength(1)
    })
  })

  it('desmontar solta tudo: o gancho, a tela, o teclado, a conta e o renderer', async () => {
    await montar()
    expect(sky()).toBeTruthy()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    montagem.desmontar()
    expect(window.__skystack).toBeUndefined()
    expect(el.querySelector('.ros-skystack')).toBeNull()
    expect(renderizadores[0].descartado).toBe(true)
    expect(pedidosDeQuadro.size).toBe(0)
    await tecla('Space')
    expect(eventos('game_start')).toHaveLength(0)
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await new Promise((r) => setTimeout(r, 20))
    expect(host.contar('placar', 'carregar')).toBe(1)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'skystack' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-skystack')).toBeNull()
    expect(renderizadores).toHaveLength(0)
  })

  it('toda chave que a tela usa existe no pt-BR', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(15)
    const faltando = usadas.filter((k) => typeof ptBR[k] !== 'string')
    expect(faltando).toEqual([])
  })
})
