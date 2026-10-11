import { AudioManager } from '../audio/AudioManager';
import { VoiceChatManager } from '../audio/VoiceChatManager';
import { LiveKitVoiceTransport } from '../audio/LiveKitVoiceTransport';
import { ChatManager } from '../chat/ChatManager';
import { ColyseusNetworkAdapter } from '../network/ColyseusNetworkAdapter';
import { InputSynchronizer } from '../network/InputSynchronizer';
import { FirstPersonController } from '../player/FirstPersonController';
import { SceneManager } from '../scene/SceneManager';
import { UIManager } from '../ui/UIManager';
import { ExperienceStateMachine } from './ExperienceState';

export class App {
  readonly state = new ExperienceStateMachine();
  private readonly scene: SceneManager;
  private readonly player: FirstPersonController;
  private readonly audio = new AudioManager();
  private readonly network = new ColyseusNetworkAdapter();
  private readonly voiceTransport: LiveKitVoiceTransport;
  private readonly voice: VoiceChatManager;
  private readonly inputs: InputSynchronizer;
  private readonly chat: ChatManager;
  private readonly ui: UIManager;
  private readonly events = new AbortController();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly limited = matchMedia('(pointer: coarse)').matches || !('requestPointerLock' in HTMLElement.prototype);
  private ready = false;
  private disposed = false;
  private contextLost = false;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private entryProgress = 0;
  private reveal = 0;

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.player = new FirstPersonController(this.scene.camera, this.scene.renderer.domElement);
    this.inputs = new InputSynchronizer(this.network, this.player);
    this.voiceTransport = new LiveKitVoiceTransport(this.network, () => this.voice?.release());
    this.voice = new VoiceChatManager(this.voiceTransport);
    this.chat = new ChatManager(this.network);
    this.ui = new UIManager(container, {
      enter: () => this.enter(), resume: () => this.resume(), submit: (text) => this.submitChat(text),
      toggleAudio: () => this.audio.toggleMute(), volume: (value) => this.audio.setVolume(value),
      fullscreen: () => this.toggleFullscreen(),
      inspect: () => this.inspect(), closeInspection: () => this.closeInspection(),
    }, this.limited, this.audio.muted);
    this.unsubscribers.push(
      this.state.subscribe((state) => {
        this.player.setEnabled(state === 'EXPLORING' && !this.limited);
        if (state !== 'EXPLORING') this.inputs.stop();
        if (state !== 'EXPLORING' && state !== 'INSPECTING') this.voice.release();
        if (state !== 'INSPECTING') this.scene.inspection.close();
        this.ui.setState(state);
      }),
      this.chat.subscribe((message) => this.ui.chat.add(message)),
      this.voice.subscribe((state) => this.ui.controls.setVoiceState(state)),
      this.voiceTransport.subscribe((state) => this.ui.controls.setVoiceConnection(state)),
      this.network.subscribeToNotice((message) => this.ui.notify(message)),
      this.network.subscribeToStatus((status) => this.ui.connection.update(status)),
      this.network.subscribeToSpawn((player) => this.player.setSpawn(player)),
      this.network.subscribeToState((snapshot) => this.scene.remotePlayers.receive(snapshot)),
    );
    this.bindEvents();
    void this.initialize();
    void this.network.connect();
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('multiplayerDebug')) {
      Object.assign(window, { sdpMultiplayer: { connection: this.network, remotes: this.scene.remotePlayers, player: this.player,
        voice: this.voice, voiceTransport: this.voiceTransport, chat: this.chat } });
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('inspectionDebug')) {
      Object.assign(window, { sdpInspection: { sculpture: this.scene.sculpture, inspection: this.scene.inspection,
        player: this.player, state: this.state } });
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  private async initialize(): Promise<void> {
    const [loaded, sculptureLoaded] = await Promise.all([
      this.scene.lighting.loadEnvironment(this.scene.renderer),
      this.scene.sculpture.loadModel('/SDP/SDPv1.glb').then(() => true).catch(() => false),
    ]);
    if (this.disposed) return;
    this.ready = true;
    this.ui.element.dataset.hdr = loaded ? 'loaded' : 'fallback';
    this.ui.element.dataset.sculpture = sculptureLoaded ? 'loaded' : 'fallback';
    this.ui.intro.ready(this.limited);
    if (!loaded) this.ui.notify('The environment light could not load. Diffuse viewing is still available.');
    if (!sculptureLoaded) this.ui.notify('The sculpture could not load. The exhibition is still available.');
  }

  private bindEvents(): void {
    const signal = this.events.signal;
    window.addEventListener('resize', () => this.scene.resize(), { signal });
    window.addEventListener('keydown', this.keydown, { signal });
    window.addEventListener('keyup', (event) => { if (event.code === 'KeyV') this.voice.release(); }, { signal });
    window.addEventListener('blur', () => this.pause(), { signal });
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) this.pause();
      else this.dispose();
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      this.audio.setVisible(!document.hidden);
      if (document.hidden) { this.pause(); cancelAnimationFrame(this.frame); }
      else { this.lastTime = 0; this.frame = requestAnimationFrame(this.tick); }
    }, { signal });
    document.addEventListener('pointerlockchange', () => {
      if (this.player.locked && this.state.value === 'INSPECTING') this.player.releaseLock();
      else if (this.player.locked && this.state.value === 'PAUSED') this.state.set('EXPLORING');
      else if (!this.player.locked && this.state.value === 'EXPLORING' && !this.limited) this.state.set('PAUSED');
    }, { signal });
    document.addEventListener('pointerlockerror', this.pointerDenied, { signal });
    document.addEventListener('fullscreenchange', () => this.ui.setFullscreen(Boolean(document.fullscreenElement)), { signal });
    this.scene.renderer.domElement.addEventListener('click', () => {
      if (this.state.value === 'INTRO') this.enter();
      else if (this.state.value === 'PAUSED') this.resume();
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); this.contextLost = true; this.pause();
      this.ui.notify('Graphics paused. Waiting for your browser to restore the exhibition.');
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; this.scene.resize();
      this.ui.notify('The exhibition is ready. Click to resume.');
    }, { signal });
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.state.value === 'CHATTING') {
      if (event.code === 'Escape') { event.preventDefault(); this.closeChat(); }
      return; // Form owns all input, including Enter; movement and voice are disabled.
    }
    if (this.state.value === 'INSPECTING') {
      if (event.repeat) return;
      if (event.code === 'KeyE' || event.code === 'Escape') { event.preventDefault(); this.closeInspection(); }
      else if (event.code === 'KeyV') { event.preventDefault(); this.voiceTransport.unlock(); void this.voice.press(); }
      else if (event.code === 'Enter') { event.preventDefault(); this.state.set('CHATTING'); }
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, button')) return;
    if (event.repeat) return;
    if (event.code === 'KeyE' && ['EXPLORING', 'PAUSED'].includes(this.state.value)) {
      event.preventDefault(); this.inspect();
    } else if (event.code === 'Enter' && ['EXPLORING', 'PAUSED'].includes(this.state.value) && !this.limited) {
      event.preventDefault();
      this.state.set('CHATTING');
      this.player.releaseLock();
    } else if (event.code === 'KeyV' && this.state.value === 'EXPLORING' && this.player.locked) {
      event.preventDefault(); this.voiceTransport.unlock(); void this.voice.press();
    }
  };

  private enter(): void {
    if (!this.ready || this.state.value !== 'INTRO') return;
    this.state.set('ENTERING');
    // Both permission-sensitive calls happen in this same trusted gesture,
    // before fetching audio or waiting for the atmospheric reveal.
    if (!this.limited) this.player.requestLock(this.pointerDenied);
    this.audio.enter();
    this.voiceTransport.unlock();
  }

  private resume(): void {
    if (this.contextLost || this.state.value !== 'PAUSED') return;
    this.audio.setVisible(true);
    this.voiceTransport.unlock();
    if (this.limited) this.state.set('EXPLORING');
    else this.player.requestLock(this.pointerDenied);
  }

  private readonly pointerDenied = (): void => {
    if (!this.disposed) this.ui.notify('Mouse control was not granted. Click to resume and try again.');
  };

  private pause(): void {
    this.voice.release(); this.player.input.clear();
    if (['EXPLORING', 'CHATTING', 'INSPECTING'].includes(this.state.value)) this.state.set('PAUSED');
    this.player.releaseLock();
  }

  private inspect(): void {
    if (!['EXPLORING', 'PAUSED'].includes(this.state.value)) return;
    if (!this.limited && !this.scene.sculpture.inRange(this.player.camera.position)) return;
    if (!this.scene.inspection.open(this.scene.sculpture)) return;
    this.voice.release();
    this.state.set('INSPECTING');
    this.player.releaseLock();
  }

  private closeInspection(): void {
    if (this.state.value !== 'INSPECTING') return;
    this.state.set('PAUSED');
    if (this.limited) this.state.set('EXPLORING');
    else this.player.requestLock(this.pointerDenied);
  }

  private submitChat(text: string): void {
    if (this.state.value !== 'CHATTING') return;
    if (!this.chat.submit(text)) {
      if (text.trim()) this.ui.notify('Chat is unavailable. Check the multiplayer connection.');
      return;
    }
    this.ui.chat.clear();
    this.closeChat();
  }

  private closeChat(): void {
    this.state.set('PAUSED');
    // Enter/Escape are trusted keyboard gestures; denied relocking leaves the
    // existing pause prompt available for a fresh click.
    this.player.requestLock(this.pointerDenied);
  }

  private toggleFullscreen(): void {
    try {
      const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void operation.catch(() => this.ui.notify('Fullscreen is unavailable in this browser window.'));
    } catch { this.ui.notify('Fullscreen is unavailable in this browser window.'); }
  }

  private readonly tick = (now: number): void => {
    if (this.disposed || document.hidden) return;
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;
    this.elapsed += dt;
    if (this.state.value === 'ENTERING') {
      this.entryProgress = Math.min(1, this.entryProgress + dt / 3.6);
      // Quintic smoothstep has zero velocity/acceleration at both endpoints.
      const t = this.entryProgress;
      this.reveal = t * t * t * (t * (t * 6 - 15) + 10);
      if (t >= 1) this.state.set(this.limited || this.player.locked ? 'EXPLORING' : 'PAUSED');
    }
    if (!this.contextLost) {
      this.player.update(dt);
      this.ui.inspection.update(
        ['EXPLORING', 'PAUSED'].includes(this.state.value) &&
          (this.limited ? this.scene.sculpture.loaded : this.scene.sculpture.inRange(this.player.camera.position)),
        this.state.value === 'INSPECTING',
      );
      this.voiceTransport.update(this.scene.camera);
      this.scene.render(dt, this.elapsed, this.reveal);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame); this.events.abort();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.inputs.dispose();
    this.voice.dispose(); this.audio.dispose(); this.chat.dispose(); this.network.disconnect();
    this.player.dispose(); this.scene.dispose(); this.ui.dispose();
  }
}
