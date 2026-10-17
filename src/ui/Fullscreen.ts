type WebKitDocument = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void; webkitCancelFullScreen?: () => Promise<void> | void };
type WebKitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void; webkitRequestFullScreen?: () => Promise<void> | void };

export function supportsFullscreen(): boolean {
  const element = document.documentElement as WebKitElement, doc = document as WebKitDocument;
  return typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled !== false
    || !!(element.webkitRequestFullscreen || element.webkitRequestFullScreen) && doc.webkitFullscreenEnabled !== false;
}

export function fullscreenState(): { active: boolean; installed: boolean } {
  const doc = document as WebKitDocument;
  const native = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  const installed = !native && (!!(navigator as Navigator & { standalone?: boolean }).standalone
    || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches);
  return { active: native || installed, installed };
}

export function toggleFullscreen(onError: (message: string) => void): void {
  const doc = document as WebKitDocument, element = document.documentElement as WebKitElement;
  const unavailable = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    ? 'Fullscreen is unavailable in this browser tab. In Safari: Share > Add to Home Screen > Open as Web App. Then launch SDP from its Home Screen icon.'
    : 'Fullscreen is unavailable here. Browser menu > Add to Home Screen / Install app, then open SDP from its Home Screen icon.';
  try {
    let operation: Promise<void> | void;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') operation = doc.exitFullscreen();
      else if (typeof doc.webkitExitFullscreen === 'function') operation = doc.webkitExitFullscreen();
      else if (typeof doc.webkitCancelFullScreen === 'function') operation = doc.webkitCancelFullScreen();
      else { onError('This browser cannot exit fullscreen programmatically.'); return; }
    } else if (fullscreenState().installed) {
      onError('SDP is already open in Home Screen mode.'); return;
    } else if (typeof element.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) {
      // Keep the request synchronous with the tap; awaiting first loses user activation.
      // Some mobile engines reject navigationUI options despite supporting fullscreen.
      operation = element.requestFullscreen();
    } else if (typeof element.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false) {
      operation = element.webkitRequestFullscreen();
    } else if (typeof element.webkitRequestFullScreen === 'function' && doc.webkitFullscreenEnabled !== false) {
      operation = element.webkitRequestFullScreen();
    } else { onError(unavailable); return; }
    void Promise.resolve(operation).catch(() => onError(unavailable));
  } catch { onError(unavailable); }
}
