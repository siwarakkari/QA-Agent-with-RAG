// src/evaluation/metrics.service.ts
//
//  Responsible for all scoring logic:
//    - LLM-as-judge  (relevance + groundedness) via direct Groq fetch
//    - Citation accuracy (programmatic, no LLM needed)
//
//  Intentionally has zero NestJS dependencies so it can run in a plain
//  tsx script without bootstrapping the full application.

import { buildJudgePrompt, parseJudgeOutput, JudgeOutput } from '../prompts/eval-judge.prompt';

export interface CitationLike {
  id         : number;
  sourceTitle: string;
  excerpt    : string;
}

export interface ScoreResult {
  relevance         : number; // 1–5  (LLM judge)
  groundedness      : number; // 1–5  (LLM judge)
  citationAccuracy  : number; // 0–1  (programmatic)
  citationCount     : number;
  relevanceReason   : string;
  groundednessReason: string;
}

export class MetricsService {
  constructor(
    private readonly groqApiKey : string,
    private readonly judgeModel : string,
  ) {}

  // ── Score a single response ───────────────────────────────────────────────
  async score(params: {
    question : string;
    answer   : string;
    citations: CitationLike[];
  }): Promise<ScoreResult> {
    const [judgeScores, citationAccuracy] = await Promise.all([
      this.judgeWithLLM(params.question, params.answer),
      Promise.resolve(this.scoreCitationAccuracy(params.answer, params.citations)),
    ]);

    return {
      relevance         : judgeScores.relevance,
      groundedness      : judgeScores.groundedness,
      citationAccuracy,
      citationCount     : params.citations.length,
      relevanceReason   : judgeScores.relevanceReason,
      groundednessReason: judgeScores.groundednessReason,
    };
  }

  // ── LLM-as-judge via direct Groq fetch ───────────────────────────────────
  //  Uses direct fetch instead of the AI SDK to avoid any message format
  //  transformation that could cause a 400 on non-OpenAI providers.
  private async judgeWithLLM(question: string, answer: string): Promise<JudgeOutput> {
    const prompt = buildJudgePrompt({ question, answer });

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method : 'POST',
      headers: {
        Authorization : `Bearer ${this.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model      : this.judgeModel,
        messages   : [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Judge API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content ?? '{}';
    return parseJudgeOutput(raw);
  }

  // ── Programmatic citation accuracy (0–1) ─────────────────────────────────
  //
  //  Checks three things:
  //   1. [N] markers exist in the answer text
  //   2. Every mentioned [N] has a matching citation object  (coverage)
  //   3. No citation objects are unreferenced in the text    (no dangling)
  //
  //  Score = 0.7 × coverage + 0.3 × (1 − dangling_ratio)
  //
  //  Edge cases:
  //   - No markers AND no objects → 0.5 (neutral: may be out-of-scope decline)
  //   - Objects exist but no markers → 0.0 (broken citation rendering)
  private scoreCitationAccuracy(answer: string, citations: CitationLike[]): number {
    const mentionedIds = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1]));

    if (mentionedIds.length === 0 && citations.length === 0) return 0.5;
    if (mentionedIds.length === 0) return 0;

    const citationIdSet  = new Set(citations.map((c) => c.id));
    const mentionedSet   = new Set(mentionedIds);

    const coveredCount   = [...mentionedSet].filter((id) => citationIdSet.has(id)).length;
    const coverage       = coveredCount / mentionedSet.size;

    const danglingCount  = [...citationIdSet].filter((id) => !mentionedSet.has(id)).length;
    const danglingRatio  = danglingCount / Math.max(citationIdSet.size, 1);

    return Math.round((coverage * 0.7 + (1 - danglingRatio) * 0.3) * 100) / 100;
  }
}