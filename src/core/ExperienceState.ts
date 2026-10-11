export type ExperienceState = 'INTRO' | 'ENTERING' | 'EXPLORING' | 'CHATTING' | 'PAUSED';

const transitions: Record<ExperienceState, readonly ExperienceState[]> = {
  INTRO: ['ENTERING'],
  ENTERING: ['EXPLORING', 'PAUSED'],
  EXPLORING: ['CHATTING', 'PAUSED'],
  CHATTING: ['EXPLORING', 'PAUSED'],
  PAUSED: ['EXPLORING', 'CHATTING'],
};

export class ExperienceStateMachine {
  private current: ExperienceState = 'INTRO';
  private readonly listeners = new Set<(state: ExperienceState) => void>();

  get value(): ExperienceState { return this.current; }

  set(next: ExperienceState): void {
    if (next === this.current || !transitions[this.current].includes(next)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: (state: ExperienceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}
