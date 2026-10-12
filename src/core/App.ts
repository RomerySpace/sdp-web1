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
import { GameModeManager } from '../modes/GameModeManager';
import { disposeAudioContext } from '../audio/AudioContextHub';
import { assetCount } from '../assets/AssetCache';
import { LOBBY_NAME } from '../../shared/MultiplayerProtocol';
import { Vector3 } from 'three';
import { modeConfig } from '../modes/ModeConfig';
import '../styles/modes.css';
import { ENABLE_SHOOTER_TEST } from '../../shared/GameplayConfig';
import { PlayerSettings } from './PlayerSettings';

export class App {
  readonly state = new ExperienceStateMachine();
  private readonly scene: SceneManager;
  private readonly player: FirstPersonController;
  private readonly audio = new AudioManager();
  private readonly settings = new PlayerSettings();
  private readonly network = new ColyseusNetworkAdapter();
  private readonly voiceTransport: LiveKitVoiceTransport;
  private readonly voice: VoiceChatManager;
  private readonly inputs: InputSynchronizer;
  private readonly chat: ChatManager;
  private readonly ui: UIManager;
  readonly modes: GameModeManager;
  private readonly interactionTarget = new Vector3();
  private readonly interactionDirection = new Vector3();
  private diagnostics?: HTMLElement;
  private diagnosticTime = 0;
  private pingTime = 0;
  private latency = 0;
  private fps = 60;
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
  private entering = false;

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    this.player = new FirstPersonController(this.scene.camera, this.scene.renderer.domElement);
    this.inputs = new InputSynchronizer(this.network, this.player);
    this.voiceTransport = new LiveKitVoiceTransport(this.network, () => this.voice?.release());
    this.voice = new VoiceChatManager(this.voiceTransport);
    this.chat = new ChatManager(this.network);
    this.ui = new UIManager(container, {
      enter: (name) => this.enter(name), resume: () => this.resume(), submit: (text) => this.submitChat(text),
      toggleAudio: () => this.settings.toggleMute(), volume: (value) => this.settings.set('volume', value),
      fullscreen: () => this.toggleFullscreen(),
      inspect: () => this.limited ? this.inspectSculpture() : this.interact(), closeInspection: () => this.closeInspection(),
    }, this.limited, this.audio.muted, this.network.displayName);
    this.modes = new GameModeManager(container, this.scene.renderer, this.network, {
      pauseLimbo: () => { this.pause(); this.player.setEnabled(false); },
      suspendCommunication: () => { this.inputs.setEnabled(false); this.voice.release(); this.voiceTransport.setEnabled(false); this.audio.setActive(false); },
      restoreCommunication: () => { this.inputs.setEnabled(true); this.voiceTransport.setEnabled(true); this.audio.setActive(true); },
      restoreLimbo: () => { this.scene.resize(); this.state.set('PAUSED'); this.ui.setState(this.state.value); if (this.limited) this.state.set('EXPLORING'); },
      resetChat: () => { this.chat.reset(); this.ui.chat.reset(); },
      changed: mode => { this.ui.element.inert = mode !== 'LIMBO' && mode !== 'SHOOTER'; if (mode !== 'LIMBO') this.ui.inspection.update(false, false); },
      inspect: () => this.inspectSculpture(),
    }, this.settings);
    container.dataset.mode = 'LIMBO';
    this.unsubscribers.push(
      this.settings.subscribe(state => {
        this.player.sensitivity = state.sensitivity; this.audio.setVolume(state.volume); this.audio.setMuted(state.muted);
        this.ui.setMuted(state.muted); this.ui.setVolume(state.volume);
      }),
      this.state.subscribe((state) => {
        this.player.setEnabled(this.modes.value === 'LIMBO' && state === 'EXPLORING' && !this.limited);
        if (state !== 'EXPLORING') this.inputs.stop();
        if (state !== 'EXPLORING' && state !== 'INSPECTING') this.voice.release();
        if (state !== 'INSPECTING') this.scene.inspection.close();
        this.ui.setState(state);
        this.modes.setInspection(state === 'INSPECTING');
      }),
      this.chat.subscribe((message) => this.ui.chat.add(message)),
      this.voice.subscribe((state) => this.ui.controls.setVoiceState(state)),
      this.voiceTransport.subscribe((state) => this.ui.controls.setVoiceConnection(state)),
      this.network.subscribeToNotice((message) => this.ui.notify(message)),
      this.network.subscribeToStatus((status) => this.ui.connection.update(status)),
      this.network.subscribeToSpawn((player) => { if (this.network.roomType === LOBBY_NAME) this.player.setSpawn(player); }),
      this.network.subscribeToState((snapshot) => { if (this.network.roomType === LOBBY_NAME || !snapshot.players.length) this.scene.remotePlayers.receive(snapshot); }),
    );
    this.bindEvents();
    void this.initialize();
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('multiplayerDebug')) {
      Object.assign(window, { sdpMultiplayer: { connection: this.network, remotes: this.scene.remotePlayers, player: this.player,
        voice: this.voice, voiceTransport: this.voiceTransport, chat: this.chat } });
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('inspectionDebug')) {
      Object.assign(window, { sdpInspection: { sculpture: this.scene.sculpture, inspection: this.scene.inspection,
        player: this.player, state: this.state } });
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('debugMode')) {
      this.diagnostics = document.createElement('pre'); this.diagnostics.className = 'mode-diagnostics'; container.append(this.diagnostics);
      Object.assign(window, { sdpUnified: { modes: this.modes, network: this.network, scene: this.scene, player: this.player,
        state: this.state, voice: this.voice, voiceTransport: this.voiceTransport, chat: this.chat } });
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
    if (import.meta.env.DEV && ENABLE_SHOOTER_TEST && new URLSearchParams(location.search).get('debugMode') === 'shooter') {
      this.network.setDisplayName(this.network.displayName || 'DEV PLAYER');
      try {
        await this.network.switchRoom(LOBBY_NAME);
        if (!this.disposed && this.network.snapshot?.shooterEnabled !== false) {
          this.state.set('ENTERING'); this.entryProgress = 1; this.reveal = 1; this.state.set('PAUSED');
          void this.modes.joinShooter();
        }
      } catch { this.ui.notify('Development connection unavailable. Enter Limbo to retry.'); }
    }
  }

  private bindEvents(): void {
    const signal = this.events.signal;
    window.addEventListener('resize', () => { if (this.modes.value === 'SHOOTER') this.modes.resize(); else this.scene.resize(); }, { signal });
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
      if (this.modes.value !== 'LIMBO') return;
      if (this.player.locked && this.state.value === 'INSPECTING') this.player.releaseLock();
      else if (this.player.locked && this.state.value === 'PAUSED') this.state.set('EXPLORING');
      else if (!this.player.locked && this.state.value === 'EXPLORING' && !this.limited) this.state.set('PAUSED');
    }, { signal });
    document.addEventListener('pointerlockerror', this.pointerDenied, { signal });
    document.addEventListener('fullscreenchange', () => this.ui.setFullscreen(Boolean(document.fullscreenElement)), { signal });
    this.scene.renderer.domElement.addEventListener('click', () => {
      if (this.modes.value !== 'LIMBO') return;
      if (this.state.value === 'INTRO') this.enter();
      else if (this.state.value === 'PAUSED') this.resume();
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); this.contextLost = true; this.pause(); this.modes.pause();
      this.ui.notify('Graphics paused. Waiting for your browser to restore the exhibition.');
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; if (this.modes.value === 'SHOOTER') this.modes.resize(); else this.scene.resize();
      this.ui.notify('The exhibition is ready. Click to resume.');
    }, { signal });
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.state.value === 'CHATTING') {
      if (event.code === 'Escape') { event.preventDefault(); this.closeChat(); }
      return; // Form owns all input, including Enter; movement and voice are disabled.
    }
    if (this.modes.value === 'SHOOTER') {
      if (event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest('input[type="text"],textarea,[contenteditable]')) return;
      if (event.code === 'KeyP') { event.preventDefault(); this.modes.toggleMenu(); }
      else if (event.code === 'Escape') { event.preventDefault(); this.modes.pause(); }
      else if (!this.modes.ui.element.hidden) return;
      else if (event.code === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault(); this.modes.shooter?.pause(true); this.modes.ui.hide(); this.state.set('CHATTING');
      }
      return;
    }
    if (this.modes.value !== 'LIMBO') {
      if ((event.code === 'Escape' || event.code === 'KeyE') && !event.repeat) { event.preventDefault(); void this.modes.returnToLimbo(); }
      return;
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
      event.preventDefault(); this.interact();
    } else if (event.code === 'Enter' && ['EXPLORING', 'PAUSED'].includes(this.state.value) && !this.limited) {
      event.preventDefault();
      this.state.set('CHATTING');
      this.player.releaseLock();
    } else if (event.code === 'KeyV' && this.state.value === 'EXPLORING' && this.player.locked) {
      event.preventDefault(); this.voiceTransport.unlock(); void this.voice.press();
    }
  };

  private enter(name?: string): void {
    if (!this.ready || this.entering || this.state.value !== 'INTRO') return;
    if (name === undefined) { this.ui.intro.chooseName(); return; }
    this.network.setDisplayName(name); this.entering = true; this.ui.intro.connecting(true);
    // Both permission-sensitive calls happen in this same trusted gesture,
    // before fetching audio or waiting for the atmospheric reveal.
    if (!this.limited) this.player.requestLock(this.pointerDenied);
    this.audio.enter();
    this.voiceTransport.unlock();
    void this.network.connect().then(() => {
      if (this.disposed) return;
      if (this.network.status.state === 'disconnected') this.ui.notify('Multiplayer unavailable. Reconnecting in the background.');
      this.state.set('ENTERING');
    }).catch(() => {
      this.entering = false; this.player.releaseLock(); this.ui.intro.connecting(false, 'Connection unavailable. Please try again.');
    });
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
    if (this.modes?.value === 'SHOOTER') {
      if (this.state.value === 'CHATTING') this.state.set('PAUSED');
      this.modes.pause(); return;
    }
    this.voice.release(); this.player.input.clear();
    if (['EXPLORING', 'CHATTING', 'INSPECTING'].includes(this.state.value)) this.state.set('PAUSED');
    this.player.releaseLock();
  }

  private canInteract(): boolean {
    if (!this.scene.sculpture.loaded || this.modes.value !== 'LIMBO' || this.state.value !== 'EXPLORING') return false;
    this.interactionTarget.copy(this.scene.sculpture.root.position); this.interactionTarget.y += .45;
    this.interactionTarget.sub(this.player.camera.position);
    if (this.interactionTarget.length() > modeConfig.interactionDistance) return false;
    this.player.camera.getWorldDirection(this.interactionDirection);
    return this.interactionTarget.normalize().dot(this.interactionDirection) >= modeConfig.interactionFacingCosine;
  }
  private interact(): void { if (this.canInteract()) this.modes.interact(); }

  private inspectSculpture(): void {
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
    if (this.modes.value === 'SHOOTER') { this.modes.shooter?.resume(); return; }
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
    const frameDt = this.lastTime ? (now - this.lastTime) / 1000 : 0;
    const dt = Math.min(frameDt, 0.05);
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
      // Shooter catches up bounded fixed steps after a slow render frame.
      this.modes.update(this.modes.value === 'SHOOTER' ? Math.min(frameDt, .125) : dt);
      if (this.modes.value !== 'SHOOTER' && this.modes.value !== 'RETURNING_TO_LIMBO') {
        if (this.modes.value === 'LIMBO') this.player.update(dt);
        this.ui.inspection.update(
          this.limited && this.modes.value === 'LIMBO' && this.state.value === 'EXPLORING' ? this.scene.sculpture.loaded : this.canInteract(),
          this.state.value === 'INSPECTING',
        );
        this.modes.setInspection(this.modes.value === 'LIMBO' && this.state.value === 'INSPECTING');
        if (this.modes.value === 'LIMBO') this.voiceTransport.update(this.scene.camera);
        this.scene.render(dt, this.elapsed, this.reveal);
      }
    }
    if (this.diagnostics && dt > 0) {
      this.fps += (1 / frameDt - this.fps) * .08;
      if (now - this.pingTime > 2000) { this.pingTime = now; void this.network.ping().then(ms => this.latency = ms).catch(() => {}); }
      if (now - this.diagnosticTime > 500) {
        this.diagnosticTime = now;
        const shooter = this.modes.shooter?.snapshot;
        this.diagnostics.textContent = `MODE ${this.modes.value}\nROOM ${this.network.status.roomId || '-'}\nONLINE ${this.network.status.online}/${this.network.status.capacity}\nFPS ${Math.round(this.fps)}\nPING ${Math.round(this.latency)} ms\nPHYSICS ${shooter?.physicsSteps ?? 'inactive'}\nJITTER ${Math.round(shooter?.network.jitterMs ?? 0)} ms\nBUFFER ${Math.round(shooter?.network.interpolationMs ?? 0)} ms\nCORRECTIONS ${shooter?.network.corrections ?? 0} / TELEPORTS ${shooter?.network.teleports ?? 0}\nMODEL CACHE ${assetCount()}\nRENDERERS 1`;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame); this.events.abort();
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.modes.dispose(); this.diagnostics?.remove();
    this.inputs.dispose();
    this.voice.dispose(); this.audio.dispose(); this.chat.dispose(); this.network.disconnect();
    this.player.dispose(); this.scene.dispose(); this.ui.dispose();
    disposeAudioContext();
  }
}
