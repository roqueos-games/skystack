// O som do SkyStack, procedural: nenhum arquivo de áudio, só osciladores. O
// AudioContext é do host (no RoqueOS, o compartilhado com os apps de música;
// fora dele, um próprio), e o jogo só toca quando o contexto já está rodando,
// porque tocar num contexto suspenso enfileira som que sai tudo junto depois.
//
// Timbres, frequências e envelopes são os do componente que rodava no RoqueOS
// até 25/09/2026, sem mudança.

const PENTATONICA = [0, 2, 4, 7, 9]

/**
 * @param {{ contexto: () => AudioContext | null }} audio a capacidade `audio` do host
 * @param {() => boolean} estaMudo
 */
export function criarSom(audio, estaMudo) {
  let volume = null
  let dono = null

  const contexto = () => {
    if (estaMudo()) return null
    try {
      const c = audio.contexto()
      if (!c || c.state !== 'running') return null
      // O ganho mestre pertence a UM contexto. Se o host trocar de contexto
      // (o iOS fecha o antigo ao voltar do fundo), recria em vez de ligar num
      // nó morto.
      if (dono !== c) {
        volume = c.createGain()
        volume.gain.value = 0.5
        volume.connect(c.destination)
        dono = c
      }
      return c
    } catch {
      return null
    }
  }

  const envelope = (c, t0, pico, queda) => {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(pico, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + queda)
    g.connect(volume)
    return g
  }

  return {
    /** O "toc" grave do bloco que assenta com corte. */
    baque() {
      const c = contexto()
      if (!c) return
      const t0 = c.currentTime
      const g = envelope(c, t0, 0.32, 0.12)
      const o = c.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(150, t0)
      o.frequency.exponentialRampToValueAtTime(55, t0 + 0.1)
      o.connect(g)
      o.start(t0)
      o.stop(t0 + 0.14)
    },
    /** O sino pentatônico do encaixe perfeito, que sobe com o combo. */
    sino(combo) {
      const c = contexto()
      if (!c) return
      const idx = Math.min(Math.max(0, combo - 1), 14)
      const midi = 64 + PENTATONICA[idx % 5] + 12 * Math.floor(idx / 5)
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const t0 = c.currentTime
      const g = envelope(c, t0, 0.34, 0.5)
      const o1 = c.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = freq
      o1.connect(g)
      const o2 = c.createOscillator()
      o2.type = 'triangle'
      o2.frequency.value = freq * 2
      const g2 = c.createGain()
      g2.gain.value = 0.22
      o2.connect(g2)
      g2.connect(g)
      o1.start(t0)
      o2.start(t0)
      o1.stop(t0 + 0.55)
      o2.stop(t0 + 0.55)
    },
    /** A queda do fim de partida. */
    desabou() {
      const c = contexto()
      if (!c) return
      const t0 = c.currentTime
      const g = envelope(c, t0, 0.3, 0.55)
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(220, t0)
      o.frequency.exponentialRampToValueAtTime(38, t0 + 0.5)
      o.connect(g)
      o.start(t0)
      o.stop(t0 + 0.6)
    },
  }
}
