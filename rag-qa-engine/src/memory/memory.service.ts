// src/memory/memory.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionStore, Message } from './session.store';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MemoryService {
  private readonly store: SessionStore;

  constructor(private readonly config: ConfigService) {
    const windowSize = this.config.get<number>('SESSION_WINDOW_SIZE', 10);
    this.store = new SessionStore(windowSize);
  }

  // ── Create a new session and return its ID ────────────────────────────────
  createSession(): string {
    const id = uuidv4();
    this.store.getOrCreate(id);
    return id;
  }

  // ── Ensure session exists, return its ID ─────────────────────────────────
  resolveSession(sessionId?: string): string {
    const id = sessionId ?? this.createSession();
    this.store.getOrCreate(id);
    return id;
  }

  // ── Get conversation history for a session ────────────────────────────────
  getHistory(sessionId: string): Message[] {
    return this.store.getHistory(sessionId);
  }

  // ── Append user message ───────────────────────────────────────────────────
  addUserMessage(sessionId: string, content: string): void {
    this.store.addMessage(sessionId, { role: 'user', content });
  }

  // ── Append assistant message ──────────────────────────────────────────────
  addAssistantMessage(sessionId: string, content: string): void {
    this.store.addMessage(sessionId, { role: 'assistant', content });
  }

  // ── Delete a session ──────────────────────────────────────────────────────
  deleteSession(sessionId: string): void {
    this.store.delete(sessionId);
  }
}