// src/evaluation/evaluator.service.ts
//
//  Responsible for:
//    - Calling POST /chat and parsing the SSE stream
//    - Managing session IDs for follow-up question chains
//    - Assembling EvalResult objects (calls MetricsService for scores)
//
//  Parses the exact SSE format written by ChatService:
//    data: <UIMessageChunk JSON>\n\n     — streamed text parts
//    data: {"type":"data-citations",...} — citation block
//    data: [DONE]                        — stream end

import * as path from 'path';
import { MetricsService, ScoreResult, CitationLike } from './metrics.service';
import { Logger } from '@nestjs/common';

// ── Shared types ──────────────────────────────────────────────────────────────
export interface TestCase {
  id               : number;
  category         : 'factual' | 'multi_document' | 'followup' | 'out_of_scope';
  question         : string;
  expected_topics  : string[];
  expected_behavior?: string;
  followup_of      : number | null;
  note?            : string;
}

export interface EvalResult {
  id        : number;
  category  : string;
  question  : string;
  answer    : string;
  citations : CitationLike[];
  scores    : ScoreResult;
  durationMs: number;
  error?    : string;
}

export class EvaluatorService {
  // Tracks sessionId per test-case id so follow-ups reuse the same session
  private readonly sessionMap = new Map<number, string>();

  constructor(
    private readonly apiUrl    : string,
    private readonly collection: string,
    private readonly metrics   : MetricsService,
  ) {}

  // ── Run a single test case end-to-end ─────────────────────────────────────
  async runCase(tc: TestCase): Promise<EvalResult> {
    const start = Date.now();

    // Follow-up questions reuse their parent's session
    const parentSession = tc.followup_of !== null
      ? this.sessionMap.get(tc.followup_of)
      : undefined;
    const sessionId = parentSession ?? `eval-${tc.id}-${Date.now()}`;

    try {
      const { answer, citations, returnedSessionId } = await this.callChat(
        tc.question,
        sessionId,
      );
      Logger.log(
        `Received answer for test case ${tc.id} (question: ${tc.question}), answer: ${answer}, citations: ${JSON.stringify(citations)}, sessionId: ${returnedSessionId}`,
      );

      // Store session so downstream follow-ups can reuse it
      this.sessionMap.set(tc.id, returnedSessionId);

      const scores = await this.metrics.score({
        question: tc.question,
        answer,
        citations,
      });
      Logger.log(`Scores for test case ${tc.id}: ${JSON.stringify(scores)}`);

      return {
        id: tc.id, category: tc.category, question: tc.question,
        answer, citations, scores, durationMs: Date.now() - start,
      };
    } catch (err) {
      Logger.error(`Error occurred while evaluating test case ${tc.id}: ${String(err)}`);
      return {
        id: tc.id, category: tc.category, question: tc.question,
        answer: '', citations: [],
        scores: {
          relevance: 0, groundedness: 0, citationAccuracy: 0,
          citationCount: 0, relevanceReason: '', groundednessReason: '',
        },
        durationMs: Date.now() - start,
        error     : String(err),
      };
    }
  }

  // ── POST /chat and parse the SSE stream ───────────────────────────────────
  private async callChat(
    question : string,
    sessionId: string,
  ): Promise<{ answer: string; citations: CitationLike[]; returnedSessionId: string }> {
    Logger.log("start")

    const res = await fetch(this.apiUrl, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        messages      : [{ role: 'user', content: question }],
        sessionId: sessionId,
        collectionName: this.collection,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    Logger.log(`Started chat for session ${sessionId} with question: ${question}`);
    Logger.log(`Result for session ${sessionId}: ${res}`);

    const raw        = await res.text();
    let   answer     = '';
    let   citations  : CitationLike[] = [];
    let   returnedId = sessionId;

    // Parse SSE lines:  "data: <payload>\n\n"
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') break;

      let chunk: Record<string, unknown>;
      try { chunk = JSON.parse(payload); } catch { continue; }

      // Text delta chunks from toUIMessageStream()
      if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
        answer += chunk.delta;
        continue;
      }

      // Citation block written by ChatService after stream completes
      if (chunk.type === 'data-citations') {
        const data = chunk.data as { citations?: CitationLike[] } | undefined;
        if (data?.citations) citations = data.citations;
        continue;
      }

      // Session ID written as a custom SSE chunk if present
      if (chunk.type === 'data-session' && typeof chunk.sessionId === 'string') {
        returnedId = chunk.sessionId;
      }
    }

    // Fallback: read session id from response header
    const headerSession = res.headers.get('x-session-id');
    if (headerSession) returnedId = headerSession;

    return { answer, citations, returnedSessionId: returnedId };
  }
}