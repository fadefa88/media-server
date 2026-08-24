const player = document.querySelector('#player');
const playerLayer = document.querySelector('#playerLayer');

async function enterFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (player?.webkitDisplayingFullscreen) {
      player.webkitExitFullscreen?.();
      return;
    }
    if (player?.webkitEnterFullscreen) {
      player.webkitEnterFullscreen();
      return;
    }
    if (player?.requestFullscreen) {
      await player.requestFullscreen();
      return;
    }
    if (playerLayer?.requestFullscreen) {
      await playerLayer.requestFullscreen();
      return;
    }
    throw new Error('Fullscreen non supportato da questo browser');
  } catch (error) {
    const toast = document.querySelector('#toast');
    if (toast) {
      toast.textContent = error?.message || 'Impossibile aprire lo schermo intero';
      toast.hidden = false;
      clearTimeout(enterFullscreen.timer);
      enterFullscreen.timer = setTimeout(() => { toast.hidden = true; }, 3000);
    }
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('#fullscreenBtn');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  enterFullscreen();
}, true);
