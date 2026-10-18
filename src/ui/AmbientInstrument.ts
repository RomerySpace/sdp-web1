import { Circle, Minus, Plus, Play, Square, Trash2, Volume2, VolumeX, X, createElement } from 'lucide';
import { stationKeyboard, stationPresets, stationPhase, type StationCommand, type StationSnapshot } from '../../shared/AmbientStation';
import '../styles/instrument.css';

export class AmbientInstrument {
  readonly element = document.createElement('section');
  private readonly events = new AbortController();
  private readonly pressed = new Map<string, { track: number; note: number }>();
  private state: StationSnapshot | null = null;
  private selected = 0;
  private octave = 3;
  private audioReady = false;
  private readonly lanes: HTMLElement[] = [];
  private readonly sliders = new Map<string, HTMLInputElement>();
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly keys: HTMLButtonElement[] = [];
  private play!: HTMLButtonElement;
  private record!: HTMLButtonElement;
  private tempo!: HTMLInputElement;
  private progress!: HTMLElement;
  constructor(container: HTMLElement, private readonly send: (command: StationCommand) => void, private readonly close: () => void) {
    this.element.className = 'ambient-instrument'; this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'true'); this.element.setAttribute('aria-label', 'SDP field instrument'); this.element.tabIndex = -1;
    this.element.innerHTML = `<div class="instrument-surface"><header><div><span class="instrument-mark">SDP</span><span class="instrument-title">FIELD INSTRUMENT</span></div><span class="instrument-owner"></span></header><div class="instrument-transport"></div><div class="instrument-tracks"></div><div class="instrument-effects"></div><div class="instrument-octave"></div><div class="instrument-keyboard" aria-label="Piano keyboard"></div><div class="instrument-progress"><i></i></div></div>`;
    const surface = this.element.querySelector('.instrument-surface')!;
    const button = (label: string, icon: Parameters<typeof createElement>[0], action: () => void, parent: Element) => {
      const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.append(createElement(icon));
      b.addEventListener('click', action, { signal: this.events.signal }); parent.append(b); return b;
    };
    button('Leave instrument (Esc)', X, close, this.element.querySelector('header')!);
    const transport = this.element.querySelector('.instrument-transport')!;
    this.play = button('Play loop', Play, () => this.send({ type: 'transport', playing: !this.state?.playing }), transport);
    button('Stop loop', Square, () => this.send({ type: 'transport', playing: false }), transport);
    this.record = button('Record selected track', Circle, () => this.send({ type: 'record', track: this.selected, enabled: !this.state?.tracks[this.selected].recording }), transport);
    const tempoLabel = document.createElement('label'); tempoLabel.className = 'instrument-tempo'; tempoLabel.textContent = 'BPM';
    this.tempo = document.createElement('input'); this.tempo.type = 'number'; this.tempo.min = '50'; this.tempo.max = '110'; this.tempo.step = '1'; this.tempo.setAttribute('aria-label', 'Loop tempo');
    this.tempo.addEventListener('change', () => this.send({ type: 'tempo', bpm: Number(this.tempo.value) }), { signal: this.events.signal }); tempoLabel.append(this.tempo); transport.append(tempoLabel);
    const loop = document.createElement('span'); loop.className = 'instrument-loop-length'; loop.textContent = '4 BARS'; transport.append(loop);
    for (let i = 0; i < 4; i++) {
      const lane = document.createElement('div'); lane.className = 'instrument-track';
      const select = document.createElement('button'); select.type = 'button'; select.textContent = String(i + 1).padStart(2, '0'); select.setAttribute('aria-label', `Select track ${i + 1}`); select.setAttribute('aria-pressed', 'false');
      select.addEventListener('click', () => { this.releaseKeys(); this.selected = i; this.render(); }, { signal: this.events.signal });
      const preset = document.createElement('select'); preset.setAttribute('aria-label', `Track ${i + 1} sound`);
      stationPresets.forEach(p => { const option = document.createElement('option'); option.value = p; option.textContent = p.toUpperCase(); preset.append(option); });
      preset.addEventListener('change', () => this.send({ type: 'preset', track: i, preset: preset.value as typeof stationPresets[number] }), { signal: this.events.signal });
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 42; canvas.setAttribute('aria-label', `Track ${i + 1} loop`);
      lane.append(select, preset, canvas);
      button(`Mute track ${i + 1}`, Volume2, () => this.send({ type: 'mute', track: i, enabled: !this.state?.tracks[i].muted }), lane);
      button(`Clear track ${i + 1}`, Trash2, () => this.send({ type: 'clear', track: i }), lane);
      this.lanes.push(lane); this.canvases.push(canvas); this.element.querySelector('.instrument-tracks')!.append(lane);
    }
    const effects = this.element.querySelector('.instrument-effects')!;
    for (const [key, label] of [['gain', 'LEVEL'], ['tone', 'FILTER'], ['space', 'SPACE'], ['echo', 'ECHO']] as const) {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.01'; input.setAttribute('aria-label', label);
      let lastSent = 0;
      const sendValue = () => { lastSent = performance.now(); this.send({ type: 'parameter', track: this.selected, key, value: Number(input.value) }); };
      input.addEventListener('input', () => { if (performance.now() - lastSent > 85) sendValue(); }, { signal: this.events.signal });
      input.addEventListener('change', sendValue, { signal: this.events.signal });
      this.sliders.set(key, input); field.append(input); effects.append(field);
    }
    const octaves = this.element.querySelector('.instrument-octave')!;
    const audioStatus = document.createElement('span'); audioStatus.className = 'instrument-audio-status'; audioStatus.setAttribute('role', 'status'); octaves.append(audioStatus);
    button('Lower octave (Z)', Minus, () => this.setOctave(this.octave - 1), octaves);
    const octave = document.createElement('span'); octave.className = 'instrument-octave-value'; octaves.append(octave);
    button('Higher octave (X)', Plus, () => this.setOctave(this.octave + 1), octaves);
    const piano = this.element.querySelector('.instrument-keyboard')!;
    let white = 0;
    for (let semitone = 0; semitone < 24; semitone++) {
      const black = [1, 3, 6, 8, 10].includes(semitone % 12), key = document.createElement('button');
      key.type = 'button'; key.className = `instrument-key ${black ? 'black' : 'white'}`; key.dataset.semitone = String(semitone);
      if (black) key.style.left = `${(white - .31) / 14 * 100}%`; else white++;
      const mapping = Object.entries(stationKeyboard).find(([, value]) => value === semitone)?.[0].replace('Key', '') ?? '';
      const legend = document.createElement('kbd'); legend.textContent = mapping; key.append(legend);
      key.addEventListener('pointerdown', event => { event.preventDefault(); key.setPointerCapture(event.pointerId); this.noteDown(`pointer:${event.pointerId}`, semitone); }, { signal: this.events.signal });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) key.addEventListener(event, (e: Event) => this.noteUp(`pointer:${(e as PointerEvent).pointerId}`), { signal: this.events.signal });
      key.addEventListener('keydown', event => { if (event.code === 'Space' && !event.repeat) { event.preventDefault(); this.noteDown(`space:${semitone}`, semitone); } }, { signal: this.events.signal });
      key.addEventListener('keyup', event => { if (event.code === 'Space') this.noteUp(`space:${semitone}`); }, { signal: this.events.signal });
      piano.append(key); this.keys.push(key);
    }
    this.progress = surface.querySelector('.instrument-progress i')!;
    window.addEventListener('keydown', this.keyDown, { signal: this.events.signal, capture: true });
    window.addEventListener('keyup', this.keyUp, { signal: this.events.signal, capture: true });
    window.addEventListener('blur', () => this.releaseKeys(), { signal: this.events.signal });
    container.append(this.element); this.setOctave(3); this.setAudioReady(false);
  }
  get visible(): boolean { return !this.element.hidden; }
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (!this.visible || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
    if ((event.target instanceof HTMLInputElement && event.target.type !== 'range') || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('.instrument-key'))) {
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.send({ type: 'transport', playing: !this.state?.playing }); return;
    }
    if (event.code === 'KeyZ' || event.code === 'KeyX') { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.setOctave(this.octave + (event.code === 'KeyX' ? 1 : -1)); }
    else if (stationKeyboard[event.code] !== undefined) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) this.noteDown(event.code, stationKeyboard[event.code]); }
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    if (!this.pressed.has(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.noteUp(event.code);
  };
  private setOctave(value: number): void {
    this.releaseKeys(); this.octave = Math.max(1, Math.min(5, value));
    this.element.querySelector('.instrument-octave-value')!.textContent = `C${this.octave} - B${this.octave + 1}`;
    this.keys.forEach((key, i) => key.setAttribute('aria-label', `Play MIDI note ${(this.octave + 1) * 12 + i}`));
  }
  private noteDown(key: string, semitone: number): void {
    if (!this.visible || !this.audioReady || this.pressed.has(key)) return;
    const note = (this.octave + 1) * 12 + semitone, track = this.selected;
    if ([...this.pressed.values()].some(p => p.note === note && p.track === track)) return;
    this.pressed.set(key, { note, track }); this.keys[semitone]?.classList.add('is-down');
    this.send({ type: 'note', track, note, velocity: .72, on: true });
  }
  private noteUp(key: string): void {
    const note = this.pressed.get(key); if (!note) return;
    this.pressed.delete(key); this.keys[note.note - (this.octave + 1) * 12]?.classList.remove('is-down');
    this.send({ type: 'note', ...note, velocity: 0, on: false });
  }
  releaseKeys(): void { for (const key of [...this.pressed.keys()]) this.noteUp(key); }
  setAudioReady(ready: boolean, failed = false): void {
    this.audioReady = ready; this.keys.forEach(key => key.disabled = !ready);
    this.element.querySelector('.instrument-keyboard')!.setAttribute('aria-busy', String(!ready));
    this.element.querySelector('.instrument-audio-status')!.textContent = ready ? '' : failed ? 'AUDIO UNAVAILABLE' : 'INITIALIZING AUDIO';
  }
  receive(state: StationSnapshot): void { this.state = state; this.render(); }
  private render(): void {
    const state = this.state; if (!state) return;
    this.element.querySelector('.instrument-owner')!.textContent = state.ownerName;
    this.play.setAttribute('aria-pressed', String(state.playing)); this.record.setAttribute('aria-pressed', String(state.tracks[this.selected].recording));
    this.tempo.value = String(state.bpm); this.tempo.disabled = state.playing;
    state.tracks.forEach((track, i) => {
      const lane = this.lanes[i]; lane.classList.toggle('is-selected', i === this.selected); lane.classList.toggle('is-recording', track.recording);
      lane.querySelector('button')!.setAttribute('aria-pressed', String(i === this.selected)); lane.querySelector('select')!.value = track.preset;
      const mute = lane.querySelectorAll('button')[1]; mute.setAttribute('aria-pressed', String(track.muted)); mute.replaceChildren(createElement(track.muted ? VolumeX : Volume2));
      const ctx = this.canvases[i].getContext('2d')!; ctx.clearRect(0, 0, 640, 42);
      ctx.strokeStyle = '#cbd7dc'; ctx.lineWidth = 1;
      for (let b = 0; b < 16; b++) { ctx.beginPath(); ctx.moveTo(b * 40, 0); ctx.lineTo(b * 40, 42); ctx.stroke(); }
      ctx.fillStyle = track.muted ? '#b8c2c8' : '#688a96';
      for (const note of track.notes) ctx.fillRect(note.step * 10, 36 - (note.note - 24) / 72 * 32, Math.min(640 - note.step * 10, Math.max(4, note.duration * 10 - 2)), 3);
    });
    for (const [key, input] of this.sliders) if (document.activeElement !== input) input.value = String(state.tracks[this.selected][key as 'gain' | 'tone' | 'space' | 'echo']);
  }
  update(now: number): void { if (this.visible && this.state) this.progress.style.width = `${this.state.playing ? stationPhase(this.state, now) / 64 * 100 : 0}%`; }
  open(): void { this.element.hidden = false; this.element.focus({ preventScroll: true }); }
  hide(): void { this.releaseKeys(); if (this.element.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur(); this.element.hidden = true; }
  dispose(): void { this.hide(); this.events.abort(); this.element.remove(); }
}
