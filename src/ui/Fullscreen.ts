type WebKitDocument = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type WebKitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenState(): { active: boolean; installed: boolean } {
  const doc = document as WebKitDocument;
  const native = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  const installed = !native && (!!(navigator as Navigator & { standalone?: boolean }).standalone
    || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches);
  return { active: native || installed, installed };
}

export function toggleFullscreen(onError: (message: string) => void): void {
  const doc = document as WebKitDocument, element = document.documentElement as WebKitElement;
  const unavailable = 'Fullscreen is unavailable here. Open SDP from your Home Screen or in a browser that supports fullscreen.';
  try {
    let operation: Promise<void> | void;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') operation = doc.exitFullscreen();
      else if (typeof doc.webkitExitFullscreen === 'function') operation = doc.webkitExitFullscreen();
      else { onError('This browser cannot exit fullscreen programmatically.'); return; }
    } else if (fullscreenState().installed) {
      onError('SDP is already open in Home Screen mode.'); return;
    } else if (typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) {
      // Keep the request synchronous with the tap; awaiting first loses user activation.
      operation = element.requestFullscreen({ navigationUI: 'hide' });
    } else if (typeof element.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false) {
      operation = element.webkitRequestFullscreen();
    } else { onError(unavailable); return; }
    void Promise.resolve(operation).catch(() => onError(unavailable));
  } catch { onError(unavailable); }
}
