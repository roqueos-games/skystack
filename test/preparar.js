// O jsdom não tem ResizeObserver, e o SkyStack ajusta o renderer e a câmera ao
// tamanho da tela com ele. No navegador o jogo recebe o observador de verdade;
// aqui basta um que não faz nada, porque nenhum teste muda o tamanho da tela
// depois de montar.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
