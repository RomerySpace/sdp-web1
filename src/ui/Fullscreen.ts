export function toggleFullscreen(onError: () => void): void {
  try {
    const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void operation.catch(onError);
  } catch { onError(); }
}
