# Changelog

## 0.1.0 (25/09/2026)

- O SkyStack sai do repositório do RoqueOS e passa a falar com ele só pelo `jogo-sdk` 0.1.0. O
  `three` vira `peerDependency` (o RoqueOS fornece o dele, `^0.171.0`), e o código que toca a
  GPU veio sem mudança.
- Texto nos dez idiomas em `i18n/`, com o nome do jogo e o aviso de falha ao compartilhar
  trazidos do texto do RoqueOS; ícones SVG próprios; o estilo, que morava num arquivo à parte
  no RoqueOS, vem dentro do componente; e o jogo roda sozinho com `yarn dev`.
- As chaves de armazenamento (`best`, `games`, `muted`, `seen`) e os eventos (`game_start`,
  `game_over`) continuam os mesmos: ninguém perde recorde nem histórico. O placar da conta
  recebe `{ best, games }`, os mesmos nomes e tipos que o SkyStack gravava antes.
- Quem entra na conta com o jogo aberto passa a ver o recorde e as partidas da conta sem
  reabrir o jogo.
- Em árabe o jogo passa a ser desenhado da direita para a esquerda.
- O perfil leve passa a vir do host no momento em que o jogo abre, e não mais do atributo que
  o RoqueOS põe no `<html>`.
