// src/chat/citation.store.ts
//
// Holds citations in memory after streamText onFinish completes.
// The UI fetches them via GET /chat/citations/:sessionId once streaming ends.
import { Injectable } from '@nestjs/common';
import { CitationDto } from './dto/citation.dto';

@Injectable()
export class CitationStore {
  private readonly store = new Map<string, CitationDto>();

  set(sessionId: string, citations: CitationDto): void {
    this.store.set(sessionId, citations);
    // Auto-expire after 5 minutes to avoid memory leak
    setTimeout(() => this.store.delete(sessionId), 5 * 60 * 1000);
  }

  get(sessionId: string): CitationDto {
    return this.store.get(sessionId) ?? { citations: [] };
  }

  clear(sessionId: string): void {
    this.store.delete(sessionId);
  }
}