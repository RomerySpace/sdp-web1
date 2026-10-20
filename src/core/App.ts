import { AudioManager } from '../audio/AudioManager';
import { VoiceChatManager } from '../audio/VoiceChatManager';
import { AmbientStationController } from '../audio/AmbientStationController';
import { LiveKitVoiceTransport } from '../audio/LiveKitVoiceTransport';
import { ChatManager } from '../chat/ChatManager';
import { ColyseusNetworkAdapter } from '../network/ColyseusNetworkAdapter';
import { InputSynchronizer } from '../network/InputSynchronizer';
import { SessionActivity } from '../network/SessionActivity';
import { FirstPersonController } from '../player/FirstPersonController';
import { SceneManager } from '../scene/SceneManager';
import { UIManager } from '../ui/UIManager';
import { ExperienceStateMachine } from './ExperienceState';
import { GameModeManager } from '../modes/GameModeManager';
import { disposeAudioContext } from '../audio/AudioContextHub';
import { assetCount } from '../assets/AssetCache';
import { LOBBY_NAME } from '../../shared/MultiplayerProtocol';
import { galleryImmersion } from '../../shared/LowerGallery';
import { Vector3 } from 'three';
import { modeConfig } from '../modes/ModeConfig';
import '../styles/modes.css';
import { ENABLE_SHOOTER_TEST } from '../../shared/GameplayConfig';
import { PlayerSettings } from './PlayerSettings';
import { SettingsMenu } from '../ui/SettingsMenu';
import { VisitorOptions } from '../ui/VisitorOptions';
import { VisitorPreferences } from './VisitorPreferences';
import { toggleFullscreen } from '../ui/Fullscreen';
import { usesTouchControls } from '../input/InputCapabilities';
import { TouchControls, type TouchAction } from '../ui/TouchControls';
import type { VoiceState } from '../audio/VoiceChatManager';
import type { VoiceConnectionState } from '../audio/LiveKitVoiceTransport';

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
  private readonly activity: SessionActivity;
  private inactive = false;
  private readonly chat: ChatManager;
  private readonly ui: UIManager;
  private readonly settingsMenu: SettingsMenu;
  private readonly instrument: AmbientStationController;
  private readonly visitorPreferences = new VisitorPreferences();
  private readonly visitorOptions: VisitorOptions;
  private focusedVisitor?: { id: string; name: string };
  private focusedSeat?: number;
  private readonly touchControls?: TouchControls;
  private microphone: VoiceState = 'idle';
  private voiceConnection: VoiceConnectionState = 'disconnected';
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
  private readonly touch = usesTouchControls();
  private readonly limited = !this.touch && !('requestPointerLock' in HTMLElement.prototype);
  private ready = false;
  private disposed = false;
  private contextLost = false;
  private frame = 0;
  private lastTime = 0;
  private elapsed = 0;
  private entryProgress = 0;
  private reveal = 0;
  private entering = false;
  private chatFromInspection = false;
  private chatViewport?: { width: number; height: number };
  private hudTouch?: { id: number; x: number; y: number; time: number };
  private lastHudTap?: { x: number; y: number; time: number };

  constructor(container: HTMLElement) {
    this.scene = new SceneManager(container);
    container.dataset.input = this.touch ? 'touch' : 'mouse';
    this.player = new FirstPersonController(this.scene.camera, this.scene.renderer.domElement, this.touch);
    this.inputs = new InputSynchronizer(this.network, this.player);
    this.voiceTransport = new LiveKitVoiceTransport(this.network, () => this.voice?.suspend());
    this.scene.remotePlayers.setVoiceLevels(this.voiceTransport.voiceLevels);
    this.voice = new VoiceChatManager(this.voiceTransport);
    this.chat = new ChatManager(this.network);
    this.ui = new UIManager(container, {
      enter: (name) => this.enter(name), resume: () => this.resume(), submit: (text) => this.submitChat(text),
      inspect: () => this.limited ? this.inspectSculpture() : this.interact(), closeInspection: () => this.closeInspection(),
      menu: () => this.openSettings(),
      closeChat: () => this.closeChat(),
      visitor: () => this.openVisitorOptions(this.focusedVisitor?.id),
      seat: () => this.interactSeat(),
    }, this.limited, this.network.displayName);
    this.audio.attach(this.ui.element);
    this.scene.environment.gallery.film.attach(this.ui.element);
    this.settingsMenu = new SettingsMenu(container, this.settings, () => this.closeSettings(), () => this.openVisitorOptions());
    this.visitorOptions = new VisitorOptions(container, this.visitorPreferences, () => {
      this.voiceTransport.setMutedVisitors(id => this.visitorPreferences.muted(id));
      this.chat.setHiddenSenders(id => this.visitorPreferences.hidden(id));
      this.ui.chat.removeSenders(id => this.visitorPreferences.hidden(id));
    }, () => this.closeVisitorOptions());
    this.modes = new GameModeManager(container, this.scene.renderer, this.network, {
      pauseLimbo: () => { this.pause(); this.player.setEnabled(false); },
      suspendCommunication: () => { this.inputs.setEnabled(false); this.voice.suspend(); this.voiceTransport.setEnabled(false); },
      restoreCommunication: () => { this.inputs.setEnabled(true); this.voiceTransport.setEnabled(true); },
      restoreLimbo: () => { this.scene.resize(); this.state.set('PAUSED'); this.ui.setState(this.state.value); if (this.limited || this.touch) this.state.set('EXPLORING'); },
      resetChat: () => { this.chat.reset(); this.ui.chat.reset(); },
      pauseChat: () => { if (this.state.value === 'CHATTING') this.state.set('PAUSED'); },
      changed: mode => { this.ui.element.inert = mode !== 'LIMBO' && mode !== 'SHOOTER'; if (mode !== 'LIMBO') this.ui.inspection.update(false, false); },
      inspect: () => this.inspectSculpture(),
    }, this.settings, this.touch);
    if (this.touch) this.touchControls = new TouchControls(container, {
      move: (f, r) => {
        if (this.modes.value === 'SHOOTER') this.modes.shooter?.input.setTouchMovement(f, r);
        else if (this.modes.value === 'LIMBO') this.player.input.setTouchMovement(f, r);
      },
      look: (dx, dy) => { if (this.modes.value === 'SHOOTER') this.modes.shooter?.input.touchLook(dx, dy); else this.player.touchLook(dx, dy); },
      action: (action, active) => this.touchAction(action, active),
      reset: () => { this.player.input.clear(); this.modes.shooter?.input.clear(); this.voice.deactivate(); },
    });
    container.dataset.mode = 'LIMBO';
    this.instrument = new AmbientStationController(container, this.network, this.ui.element, () => {
      this.pause(); this.ui.element.inert = true;
    }, () => { this.ui.element.inert = false; this.player.input.clear(); if (!document.hidden && !this.disposed && this.network.status.state === 'connected') this.resume(); }, message => this.ui.notify(message), () => { this.player.input.clear(); this.inputs.stop(); });
    this.activity = new SessionActivity(container, this.network, () => {
      this.inactive = true; this.pause(); this.modes.pause(); this.inputs.setEnabled(false);
      this.player.setEnabled(false); this.player.releaseLock(); this.voice.suspend(); this.voiceTransport.setEnabled(false);
      this.audio.setVisible(false); this.modes.shooter?.audio.setVisible(false);
      this.scene.environment.gallery.update(this.scene.camera, false, 0);
      this.instrument.update(this.scene.camera, false, 0, false, 0);
      this.touchControls?.reset(); this.ui.element.inert = true; cancelAnimationFrame(this.frame);
    });
    this.unsubscribers.push(
      this.settings.subscribe(state => {
        this.player.sensitivity = state.sensitivity; this.audio.setVolume(state.musicVolume); this.audio.setMuted(state.muted);
        this.voice.setMode(state.voiceMode); this.ui.controls.setVoiceMode(state.voiceMode); this.touchControls?.setVoiceMode(state.voiceMode);
      }),
      this.state.subscribe((state) => {
        this.player.setEnabled(this.modes.value === 'LIMBO' && state === 'EXPLORING' && !this.limited);
        this.touchControls?.reset();
        if (state !== 'EXPLORING') this.inputs.stop();
        if (state !== 'EXPLORING' && state !== 'INSPECTING') this.voice.deactivate();
        if (state !== 'INSPECTING' && !(state === 'CHATTING' && this.chatFromInspection)) this.scene.inspection.close();
        this.ui.setState(state);
        this.modes.setInspection(state === 'INSPECTING');
      }),
      this.chat.subscribe((message) => this.ui.chat.add(message)),
      this.voice.subscribe((state) => { this.microphone = state; this.ui.controls.setVoiceState(state); this.touchControls?.voice(state, this.voiceConnection); }),
      this.voiceTransport.subscribe((state) => { this.voiceConnection = state; this.ui.controls.setVoiceConnection(state); this.touchControls?.voice(this.microphone, state); }),
      this.network.subscribeToNotice((message) => this.ui.notify(message)),
      this.network.subscribeToStatus((status) => { this.ui.connection.update(status); this.player.setNetworkReady(status.state === 'connected' && this.network.roomType === LOBBY_NAME); }),
      this.network.subscribeToSpawn((player) => { if (this.network.roomType === LOBBY_NAME) this.player.setSpawn(player); }),
      this.network.subscribeToCorrection(player => { if (this.network.roomType === LOBBY_NAME) this.player.correctAuthoritative(player); }),
      this.network.subscribeToState((snapshot) => {
        this.audio.receive(snapshot);
        if (this.network.roomType === LOBBY_NAME) this.scene.environment.gallery.film.receive(snapshot.wallTime, snapshot.receivedAt);
        if (this.network.roomType === LOBBY_NAME || !snapshot.players.length) this.scene.remotePlayers.receive(snapshot);
        if (this.network.roomType === LOBBY_NAME) {
          const local = snapshot.players.find(player => player.playerId === snapshot.localPlayerId);
          if (local) {
            if (!this.player.synchronized) this.player.correctAuthoritative(local);
            this.player.setNetworkReady(true); this.player.receiveSeating(local); this.player.reconcile(local);
          }
        }
        this.visitorOptions.update(snapshot.players.filter(player => player.connected && player.playerId !== snapshot.localPlayerId)
          .map(player => ({ id: player.playerId, name: player.displayName || 'VISITOR' })));
      }),
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
        state: this.state, voice: this.voice, voiceTransport: this.voiceTransport, chat: this.chat, audio: this.audio, instrument: this.instrument } });
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
    window.addEventListener('resize', () => this.resizeViewport(), { signal });
    window.addEventListener('pointerdown', event => {
      if (this.touch && event.pointerType === 'touch' && event.isPrimary && this.ui.isHudHidden && this.modes.value === 'LIMBO' && !this.settingsMenu.visible && this.state.value !== 'CHATTING') {
        this.hudTouch = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
      }
    }, { signal });
    window.addEventListener('pointerup', event => {
      const start = this.hudTouch; if (!start || start.id !== event.pointerId) return;
      this.hudTouch = undefined;
      const now = performance.now();
      if (now - start.time > 300 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) { this.lastHudTap = undefined; return; }
      const previous = this.lastHudTap;
      if (previous && now - previous.time < 350 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        this.lastHudTap = undefined; this.openSettings();
      } else this.lastHudTap = { x: event.clientX, y: event.clientY, time: now };
    }, { signal });
    window.addEventListener('pointercancel', () => { this.hudTouch = this.lastHudTap = undefined; }, { signal });
    window.addEventListener('keydown', this.keydown, { signal });
    window.addEventListener('keyup', (event) => { if (event.code === 'KeyV') this.voice.deactivate(); }, { signal });
    window.addEventListener('blur', () => { this.voice.release(); this.pause(); }, { signal });
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) { this.voice.suspend(); this.pause(); }
      else this.dispose();
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (this.inactive) return;
      this.audio.setVisible(!document.hidden);
      this.modes.shooter?.audio.setVisible(!document.hidden);
      if (document.hidden) { this.voice.suspend(); this.pause(); cancelAnimationFrame(this.frame); }
      else { this.lastTime = 0; this.frame = requestAnimationFrame(this.tick); }
    }, { signal });
    document.addEventListener('pointerlockchange', () => {
      if (this.modes.value !== 'LIMBO' || this.touch) return;
      if (this.settingsMenu.visible || this.visitorOptions.visible) { if (this.player.locked) this.player.releaseLock(); return; }
      if (this.player.locked && this.state.value === 'INSPECTING') this.player.releaseLock();
      else if (this.player.locked && this.state.value === 'PAUSED') this.state.set('EXPLORING');
      else if (!this.player.locked && this.state.value === 'EXPLORING' && !this.limited) this.state.set('PAUSED');
    }, { signal });
    document.addEventListener('pointerlockerror', this.pointerDenied, { signal });
    this.scene.renderer.domElement.addEventListener('click', () => {
      if (this.modes.value !== 'LIMBO') return;
      if (this.state.value === 'INTRO') this.enter();
      else if (this.state.value === 'PAUSED') this.resume();
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); this.contextLost = true; this.voice.release(); this.pause(); this.modes.pause();
      this.ui.notify('Graphics paused. Waiting for your browser to restore the exhibition.');
    }, { signal });
    this.scene.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; if (this.modes.value === 'SHOOTER') this.modes.resize(); else this.scene.resize();
      this.ui.notify('The exhibition is ready. Click to resume.');
    }, { signal });
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (this.inactive) return;
    if (this.instrument.visible) {
      if (event.code === 'KeyV' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLElement && event.target.closest('input,select,textarea'))) {
        event.preventDefault(); this.voiceTransport.unlock(); void this.voice.activate();
      }
      return;
    }
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const voiceTyping = event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input:not([type="range"]):not([type="checkbox"]),textarea'));
    if (event.code === 'KeyV' && !event.repeat && !voiceTyping && this.modes.value === 'LIMBO' && (this.settingsMenu.visible || this.visitorOptions.visible || this.state.value === 'PAUSED')) {
      event.preventDefault(); this.voiceTransport.unlock(); void this.voice.activate(); return;
    }
    if (this.visitorOptions.visible) {
      if (!event.repeat && ['Escape', 'KeyE', 'KeyP'].includes(event.code)) { event.preventDefault(); this.closeVisitorOptions(); }
      return;
    }
    const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input:not([type="range"]):not([type="checkbox"]),textarea'));
    if (event.code === 'KeyH' && !typing && !this.settingsMenu.visible && this.modes.value === 'LIMBO' && ['EXPLORING', 'PAUSED', 'INSPECTING'].includes(this.state.value)) {
      event.preventDefault(); if (!event.repeat) this.ui.toggleHud(); return;
    }
    if (event.code === 'KeyF' && !typing && this.state.value !== 'CHATTING') {
      event.preventDefault(); if (!event.repeat) toggleFullscreen(message => this.ui.notify(message)); return;
    }
    if (this.settingsMenu.visible) {
      if (!event.repeat && (event.code === 'KeyP' || event.code === 'Escape')) { event.preventDefault(); this.closeSettings(); }
      return;
    }
    if (event.code === 'KeyP' && !typing && this.modes.value === 'LIMBO' && this.state.value !== 'CHATTING' && this.state.value !== 'ENTERING') {
      event.preventDefault(); if (!event.repeat) this.openSettings(); return;
    }
    if (this.state.value === 'CHATTING') {
      if (event.code === 'Escape') { event.preventDefault(); this.closeChat(); }
      return; // Form owns all input, including Enter; movement and voice are disabled.
    }
    if (this.modes.value === 'SHOOTER') {
      if(!typing&&this.modes.shooter?.handleAirstrikeKey(event))return;
      if (event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest('input[type="text"],textarea,[contenteditable]')) return;
      if (event.code === 'KeyP') { event.preventDefault(); this.modes.toggleMenu(); }
      else if (event.code === 'Escape') { event.preventDefault(); this.modes.pause(); }
      else if (!this.modes.ui.element.hidden) return;
      else if (event.code === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault(); this.openChat();
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
      else if (event.code === 'KeyV') { event.preventDefault(); this.voiceTransport.unlock(); void this.voice.activate(); }
      else if (event.code === 'Enter') { event.preventDefault(); this.openChat(); }
      return;
    }
    const target = event.target;
    if (typing || target instanceof HTMLElement && target.closest('button') && this.state.value !== 'EXPLORING') return;
    if (event.repeat) return;
    if (event.code === 'KeyE' && ['EXPLORING', 'PAUSED'].includes(this.state.value)) {
      event.preventDefault();
      if (this.player.seated) this.interactSeat();
      else if (!this.instrument.prompt.hidden) this.instrument.interact();
      else if (this.focusedVisitor && !this.ui.isHudHidden) this.openVisitorOptions(this.focusedVisitor.id);
      else if (this.player.seated || this.focusedSeat !== undefined) this.interactSeat();
      else this.interact();
    } else if (event.code === 'Enter' && ['EXPLORING', 'PAUSED'].includes(this.state.value) && !this.limited) {
      event.preventDefault();
      this.openChat();
    } else if (event.code === 'KeyV' && this.state.value === 'EXPLORING' && this.player.locked) {
      event.preventDefault(); this.voiceTransport.unlock(); void this.voice.activate();
    }
  };

  private enter(name?: string): void {
    if (!this.ready || this.entering || this.state.value !== 'INTRO') return;
    if (name === undefined) { this.ui.intro.chooseName(); return; }
    this.network.setDisplayName(name); this.entering = true; this.ui.intro.connecting(true);
    // Both permission-sensitive calls happen in this same trusted gesture,
    // before fetching audio or waiting for the atmospheric reveal.
    if (!this.limited && !this.touch) this.player.requestLock(this.pointerDenied);
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
    if (this.contextLost || this.settingsMenu.visible || this.visitorOptions.visible || this.instrument.visible || this.state.value !== 'PAUSED') return;
    this.audio.setVisible(true);
    this.voiceTransport.unlock();
    if (this.limited || this.touch) this.state.set('EXPLORING');
    else this.player.requestLock(this.pointerDenied);
  }

  private readonly pointerDenied = (): void => {
    if (!this.disposed) this.ui.notify('Mouse control was not granted. Click to resume and try again.');
  };

  private pause(): void {
    this.touchControls?.reset();
    if (this.modes?.value === 'SHOOTER') {
      if (this.state.value === 'CHATTING') this.state.set('PAUSED');
      this.modes.pause(); return;
    }
    this.voice.deactivate(); this.player.input.clear();
    if (this.settingsMenu.visible) { this.player.releaseLock(); return; }
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
  private interactSeat(): void {
    if (this.modes.value !== 'LIMBO' || this.state.value !== 'EXPLORING' || this.settingsMenu.visible || this.visitorOptions.visible) return;
    const seat = this.player.seated ? -1 : this.focusedSeat;
    if (seat === undefined) return;
    this.player.input.clear(); this.inputs.stop(); this.network.requestSeat(seat);
  }

  private inspectSculpture(): void {
    if (!['EXPLORING', 'PAUSED'].includes(this.state.value)) return;
    if (!this.limited && !this.scene.sculpture.inRange(this.player.camera.position)) return;
    if (!this.scene.inspection.open(this.scene.sculpture)) return;
    this.voice.deactivate();
    this.state.set('INSPECTING');
    this.player.releaseLock();
  }

  private closeInspection(): void {
    if (this.state.value !== 'INSPECTING') return;
    this.state.set('PAUSED');
    if (this.limited || this.touch) this.state.set('EXPLORING');
    else this.player.requestLock(this.pointerDenied);
  }

  private submitChat(text: string): void {
    if (this.state.value !== 'CHATTING') return;
    if (!text.trim()) { this.ui.chat.clear(); this.closeChat(); return; }
    if (!this.chat.submit(text)) {
      if (text.trim()) this.ui.notify('Chat is unavailable. Check the multiplayer connection.');
      return;
    }
    this.ui.chat.clear();
    this.closeChat();
  }

  private closeChat(): void {
    if (this.state.value !== 'CHATTING') return;
    if (this.chatFromInspection && this.modes.value === 'LIMBO') {
      this.chatFromInspection = false; this.state.set('INSPECTING'); this.scene.inspection.controls.enabled = true;
      requestAnimationFrame(() => this.resizeViewport()); return;
    }
    this.state.set('PAUSED');
    requestAnimationFrame(() => this.resizeViewport());
    if (this.modes.value === 'SHOOTER') { this.modes.shooter?.resume(); return; }
    // Enter/Escape are trusted keyboard gestures; denied relocking leaves the
    // existing pause prompt available for a fresh click.
    if (this.touch || this.limited) this.state.set('EXPLORING');
    else this.player.requestLock(this.pointerDenied);
  }
  private openChat(): void {
    if (this.state.value === 'CHATTING') return;
    this.chatViewport = { width: window.innerWidth, height: window.innerHeight };
    this.chatFromInspection = this.state.value === 'INSPECTING';
    if (this.chatFromInspection) this.scene.inspection.controls.enabled = false;
    this.touchControls?.reset();
    if (this.modes.value === 'SHOOTER') { this.modes.shooter?.pause(true); this.modes.ui.hide(); }
    this.state.set('CHATTING'); this.player.releaseLock();
  }
  private resizeViewport(): void {
    if (this.disposed || this.state.value === 'CHATTING') return;
    // Mobile keyboards may resize the layout viewport before they finish closing.
    if (this.touch && this.chatViewport && window.innerWidth === this.chatViewport.width && window.innerHeight < this.chatViewport.height * .8) return;
    this.chatViewport = undefined;
    if (this.modes.value === 'SHOOTER') this.modes.resize(); else this.scene.resize();
  }
  private touchAction(action: TouchAction, active: boolean): void {
    if (this.inactive) return;
    if (action === 'voice') {
      if (!active) { this.voice.deactivate(); return; }
      if (this.modes.value === 'LIMBO' && ['EXPLORING', 'INSPECTING'].includes(this.state.value)) { this.voiceTransport.unlock(); void this.voice.activate(); }
      return;
    }
    if (action === 'chat' && active) { this.openChat(); return; }
    if (action === 'menu' && active) { if (this.modes.value === 'SHOOTER') this.modes.pause(); else this.openSettings(); return; }
    if (this.modes.value === 'LIMBO') {
      if (action === 'sprint') this.player.input.setTouchSprint(active);
      if (action === 'crouch') this.player.input.setTouchKey('ControlLeft', active);
      if (action === 'jump' && active) { this.player.input.setTouchKey('Space', true); window.setTimeout(() => this.player.input.setTouchKey('Space', false), 100); }
      return;
    }
    const input = this.modes.shooter?.input; if (this.modes.value !== 'SHOOTER' || !input) return;
    if (action === 'fire') input.touchFire(active);
    else if (action === 'aim') input.aiming = active && input.enabled;
    else {
      const keys: Partial<Record<TouchAction, string>> = { jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft', reload: 'KeyR', mode: 'KeyB', flashlight: 'KeyZ' };
      const key = keys[action];
      if (key) input.touchKey(key, active);
    }
  }
  private updateTouchControls(): void {
    if (!this.touchControls) return;
    const shooter = this.modes.shooter;
    if (this.contextLost || this.settingsMenu.visible || this.visitorOptions.visible || (this.modes.value === 'SHOOTER' && (this.state.value === 'CHATTING' || !shooter || shooter.paused || shooter.roundComplete || shooter.targeting.blocking))) {
      this.touchControls.update('hidden', '');
    } else if (this.modes.value === 'SHOOTER' && shooter) {
      this.touchControls.update(shooter.dead ? 'dead' : 'shooter', String(shooter.life), shooter.weapon.automatic, !shooter.dead && shooter.flashlightEnabled);
    } else if (this.modes.value === 'LIMBO' && ['EXPLORING', 'INSPECTING'].includes(this.state.value)) {
      this.touchControls.update(this.state.value === 'INSPECTING' ? 'inspection' : 'limbo', '');
    } else this.touchControls.update('hidden', '');
  }

  private openSettings(): void {
    if (this.instrument.visible) return;
    if (this.modes.value !== 'LIMBO' || this.state.value === 'ENTERING' || this.settingsMenu.visible) return;
    if (this.state.value === 'EXPLORING' || this.state.value === 'CHATTING') this.pause();
    this.touchControls?.reset();
    this.voice.deactivate(); this.player.input.clear(); this.scene.inspection.controls.enabled = false;
    this.ui.element.inert = true; this.ui.element.classList.add('is-settings-open'); this.settingsMenu.open(); this.modes.setInspection(false);
  }
  private openVisitorOptions(selected?: string): void {
    if (this.modes.value !== 'LIMBO' || this.visitorOptions.visible || !['EXPLORING', 'PAUSED'].includes(this.state.value)) return;
    const snapshot = this.network.snapshot;
    const visitors = snapshot?.players.filter(player => player.connected && player.playerId !== snapshot.localPlayerId)
      .map(player => ({ id: player.playerId, name: player.displayName || 'VISITOR' })) ?? [];
    if (selected && !visitors.some(visitor => visitor.id === selected)) return;
    this.settingsMenu.hide(); this.pause(); this.inputs.stop();
    this.ui.element.inert = true; this.ui.element.classList.add('is-settings-open');
    this.visitorOptions.open(visitors, selected);
  }
  private closeVisitorOptions(): void {
    this.visitorOptions.hide(); this.ui.element.inert = false; this.ui.element.classList.remove('is-settings-open');
    this.resume();
  }
  private closeSettings(): void {
    this.settingsMenu.hide(); this.ui.element.inert = false; this.ui.element.classList.remove('is-settings-open');
    if (this.state.value === 'INSPECTING') { this.scene.inspection.controls.enabled = true; this.modes.setInspection(true); }
    else if (this.state.value === 'PAUSED') this.resume();
  }

  private readonly tick = (now: number): void => {
    if (this.disposed || this.inactive || document.hidden) return;
    const frameDt = this.lastTime ? (now - this.lastTime) / 1000 : 0;
    const dt = Math.min(frameDt, 0.05);
    this.lastTime = now;
    this.elapsed += dt;
    if (this.voiceTransport.hasVoiceActivity) this.activity.mark();
    if (this.state.value === 'ENTERING') {
      this.entryProgress = Math.min(1, this.entryProgress + dt / 3.6);
      // Quintic smoothstep has zero velocity/acceleration at both endpoints.
      const t = this.entryProgress;
      this.reveal = t * t * t * (t * (t * 6 - 15) + 10);
      if (t >= 1) this.state.set(this.touch || this.limited || this.player.locked ? 'EXPLORING' : 'PAUSED');
    }
    if (!this.contextLost) {
      this.updateTouchControls();
      // Shooter catches up bounded fixed steps after a slow render frame.
      this.modes.update(this.modes.value === 'SHOOTER' ? Math.min(frameDt, .125) : dt);
      if (this.modes.value === 'LIMBO') this.player.update(dt);
      this.audio.updateEnvironment(this.scene.camera, this.modes.value === 'LIMBO', this.reveal);
      const instrumentFocus = this.modes.value === 'LIMBO' && this.state.value === 'EXPLORING' && !this.settingsMenu.visible && !this.visitorOptions.visible && !this.player.seated
        && this.scene.environment.instrument.focus(this.scene.camera, [this.scene.sculpture.root, ...this.scene.environment.occluders]);
      const audioSettings = this.settings.value;
      this.ui.element.classList.toggle('in-gallery', this.modes.value === 'LIMBO' && galleryImmersion(this.scene.camera.position.x, this.scene.camera.position.y, this.scene.camera.position.z) > .4);
      this.scene.environment.gallery.update(this.scene.camera, this.modes.value === 'LIMBO' && this.reveal > .95 && !this.scene.inspection.active, audioSettings.muted ? 0 : audioSettings.volume);
      this.instrument.update(this.scene.camera, this.modes.value === 'LIMBO', this.reveal, instrumentFocus, audioSettings.muted ? 0 : audioSettings.volume);
      this.scene.environment.instrument.update(!!this.instrument.snapshot?.ownerId, this.elapsed);
      if (this.modes.value !== 'SHOOTER' && this.modes.value !== 'RETURNING_TO_LIMBO') {
        this.ui.inspection.update(
          this.limited && this.modes.value === 'LIMBO' && this.state.value === 'EXPLORING' ? this.scene.sculpture.loaded : this.canInteract(),
          this.state.value === 'INSPECTING',
        );
        this.modes.setInspection(this.modes.value === 'LIMBO' && this.state.value === 'INSPECTING' && !this.settingsMenu.visible);
        if (this.modes.value === 'LIMBO') this.voiceTransport.update(this.scene.camera);
        this.scene.render(dt, this.elapsed, this.reveal, this.modes.value === 'LIMBO', this.state.value === 'CHATTING');
        this.focusedVisitor = this.modes.value === 'LIMBO' && this.state.value === 'EXPLORING' && !this.settingsMenu.visible && !this.visitorOptions.visible
          ? this.scene.remotePlayers.focus(this.scene.camera, [this.scene.sculpture.root, ...this.scene.environment.occluders]) : undefined;
        this.ui.focusVisitor(this.focusedVisitor?.name);
        const seatAvailable = this.modes.value === 'LIMBO' && this.state.value === 'EXPLORING' && !this.settingsMenu.visible && !this.visitorOptions.visible && !this.focusedVisitor && !instrumentFocus;
        this.focusedSeat = seatAvailable && !this.player.seated ? this.scene.environment.retreat.focusSeat(this.scene.camera, [this.scene.sculpture.root, ...this.scene.environment.occluders]) : undefined;
        // Offer the other half rather than marking a partly occupied bench unavailable.
        if (this.focusedSeat !== undefined) {
          const occupied = (seat: number) => !!this.network.snapshot?.players.some(player => player.connected && player.seatIndex === seat);
          const neighbour = this.focusedSeat ^ 1;
          if (occupied(this.focusedSeat) && !occupied(neighbour)) this.focusedSeat = neighbour;
        }
        const seatOccupied = this.focusedSeat !== undefined && !!this.network.snapshot?.players.some(player => player.connected && player.seatIndex === this.focusedSeat);
        this.ui.seating(seatAvailable && (this.player.seated || this.focusedSeat !== undefined), this.player.seated, seatOccupied);
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
    this.instrument.dispose();
    this.modes.dispose(); this.diagnostics?.remove();
    this.inputs.dispose();
    this.activity.dispose();
    this.voice.dispose(); this.audio.dispose(); this.chat.dispose(); this.network.disconnect();
    this.touchControls?.dispose(); this.player.dispose(); this.scene.dispose(); this.ui.dispose(); this.settingsMenu.dispose(); this.visitorOptions.dispose();
    disposeAudioContext();
  }
}
