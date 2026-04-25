// src/prompts/eval-judge.prompt.ts
//
//  Prompt used by the evaluation harness (evaluate.ts) to score
//  RAG responses as an LLM judge.
//
//  Kept separate from evaluate.ts so the scoring rubric can be
//  versioned, tweaked, and tested independently of the harness logic.

export interface JudgePromptParams {
  question: string;
  answer  : string;
}

export interface JudgeOutput {
  relevance         : number;   // 1–5
  relevanceReason   : string;
  groundedness      : number;   // 1–5
  groundednessReason: string;
}

// ── Prompt builder ────────────────────────────────────────────────────────────
export function buildJudgePrompt({ question, answer }: JudgePromptParams): string {
  return `\
You are an evaluation judge for a RAG (Retrieval-Augmented Generation) system \
about World War II.

Score the following question-answer pair on two dimensions.
Respond ONLY with valid JSON — no markdown fences, no preamble, no explanation.

Question: ${question}

Answer: ${answer}


SCORING RUBRIC


RELEVANCE (1–5) — Does the answer actually address the question asked?
  5 = Fully answers the question with appropriate detail
  4 = Mostly answers, minor gaps
  3 = Partially answers, some relevant content but incomplete
  2 = Barely relevant, mostly off-topic
  1 = Does not answer the question at all

GROUNDEDNESS (1–5) — Is every claim supported by a cited source?
  Citations appear as [N] markers inline in the answer.
  5 = Every claim is backed by a [N] citation, no hallucinations
  4 = Most claims cited, one or two uncited but clearly plausible
  3 = Some citations present, several uncited claims
  2 = Few citations, many unsupported claims
  1 = No citations, answer appears fabricated

SPECIAL CASE — Out-of-scope questions:
  If the question is clearly outside the knowledge base scope and the answer
  appropriately declines or redirects, award 5 for both dimensions.


REQUIRED OUTPUT FORMAT
{
  "relevance": <integer 1–5>,
  "relevance_reason": "<one concise sentence explaining the score>",
  "groundedness": <integer 1–5>,
  "groundedness_reason": "<one concise sentence explaining the score>"
}`;
}

// ── Output parser — safe, handles model markdown fences ──────────────────────
export function parseJudgeOutput(raw: string): JudgeOutput {
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      relevance         : clamp(parsed.relevance    ?? 1),
      relevanceReason   : String(parsed.relevance_reason    ?? ''),
      groundedness      : clamp(parsed.groundedness ?? 1),
      groundednessReason: String(parsed.groundedness_reason ?? ''),
    };
  } catch {
    return {
      relevance: 1, relevanceReason: 'Failed to parse judge output',
      groundedness: 1, groundednessReason: 'Failed to parse judge output',
    };
  }
}

function clamp(n: number): number {
  return Math.min(5, Math.max(1, Math.round(Number(n))));
}