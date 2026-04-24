// src/prompts/rewrite.prompt.ts
//
//  Prompt used by QueryRewriteService to decide whether a query needs
//  rewriting and, if so, to produce a self-contained version.

export interface RewritePromptParams {
  history    : Array<{ role: 'user' | 'assistant'; content: string }>;
  latestQuery: string;
}

export function buildRewritePrompt(params: RewritePromptParams): string {
  const { history, latestQuery } = params;
  

  const historyText = history.slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return `\
You are a query pre-processor for a retrieval-augmented search system.

Your ONLY job is to decide whether the latest user query depends on the \
conversation history to be understood. If it does, rewrite it as a fully \
self-contained question that can be sent to a vector database without any \
prior context.

Rules:
1. If the query is already self-contained (no pronouns referring to earlier \
topics, no implicit follow-ups), respond with exactly:
   UNCHANGED
2. If the query depends on history, respond with ONLY the rewritten query — \
no explanation, no preamble, no quotes.
3. Never answer the question. Never add commentary.
4. Keep the rewritten query concise (one sentence if possible).

Conversation history:
${historyText || '(no history)'}

Latest query: ${latestQuery}

Decision:`;
}

export function buildRewritePrompt0(): string {

  return `\
You are a query pre-processor for a retrieval-augmented search system.

Your ONLY job is to decide whether the latest user query depends on the \
conversation history to be understood. If it does, rewrite it as a fully \
self-contained question that can be sent to a vector database without any \
prior context.

Rules:
1. If the query is already self-contained (no pronouns referring to earlier \
topics, no implicit follow-ups), respond with exactly:
   UNCHANGED
2. If the query depends on history, respond with ONLY the rewritten query — \
no explanation, no preamble, no quotes.
3. Never answer the question. Never add commentary.
4. Keep the rewritten query concise (one sentence if possible).

Decision:`;
}