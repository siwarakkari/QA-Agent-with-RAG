// src/memory/session.store.ts

export interface Message {
  role   : 'user' | 'assistant';
  content: string;
}

export interface Session {
  id        : string;
  messages  : Message[];
  createdAt : Date;
  updatedAt : Date;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly windowSize: number;

  constructor(windowSize = 10) {
    this.windowSize = windowSize;
  }

  // ── Get or create a session ───────────────────────────────────────────────
  getOrCreate(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id       : sessionId,
        messages : [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return this.sessions.get(sessionId)!;
  }

  // ── Append a message and enforce the sliding window ───────────────────────
  addMessage(sessionId: string, message: Message): void {
    const session = this.getOrCreate(sessionId);
    session.messages.push(message);

    // Keep only the last N messages 
    if (session.messages.length > this.windowSize) {
      session.messages = session.messages.slice(-this.windowSize);
    }

    session.updatedAt = new Date();
  }

  // ── Return the current message history for a session ─────────────────────
  getHistory(sessionId: string): Message[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  // ── Delete a session ──────────────────────────────────────────────────────
  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ── List all active session IDs ───────────────────────────────────────────
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }
}