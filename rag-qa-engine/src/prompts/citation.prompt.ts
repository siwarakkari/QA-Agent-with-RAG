// src/prompts/citation.prompt.ts
//
//  Prompt used by LlmService to extract structured citations from a
//  streamed answer that already contains inline [N] markers.

export interface CitationPromptParams {
  answer  : string;
  chunks  : Array<{ id: number; text: string; sourceTitle: string; url: string }>;
}

export function buildCitationPrompt(params: CitationPromptParams): string {
  const { answer, chunks } = params;

  const chunkList = chunks
    .map((c) => `[${c.id}] "${c.sourceTitle}" — ${c.text.slice(0, 200)}…`)
    .join('\n');

  return `\
Given the following answer and the source chunks it references, extract the \
citations that were actually used (i.e., whose [N] marker appears in the answer).

Answer:
${answer}

Available source chunks:
${chunkList}

Return a JSON object with a "citations" array. Each element must have:
  id          : the number from the [N] marker (integer)
  sourceTitle : the source title for that chunk
  excerpt     : a short excerpt (≤ 120 chars) from the chunk most relevant to \
how it was used in the answer

Return ONLY the JSON object. No markdown fences, no explanation.`;
}