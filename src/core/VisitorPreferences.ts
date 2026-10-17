export interface VisitorPreference { id: string; name: string; voice: boolean; messages: boolean; blocked: boolean }

/** Local communication boundaries for server-issued session identities, not account bans. */
export class VisitorPreferences {
  private readonly entries = new Map<string, VisitorPreference>();
  get all(): VisitorPreference[] { return [...this.entries.values()]; }
  get(id: string): VisitorPreference | undefined { return this.entries.get(id); }
  remember(id: string, name: string): VisitorPreference {
    let entry = this.entries.get(id);
    if (!entry) { entry = { id, name, voice: false, messages: false, blocked: false }; this.entries.set(id, entry); }
    entry.name = name;
    return entry;
  }
  muted(id: string): boolean { const entry = this.entries.get(id); return !!entry && (entry.voice || entry.blocked); }
  hidden(id: string): boolean { const entry = this.entries.get(id); return !!entry && (entry.messages || entry.blocked); }
}
