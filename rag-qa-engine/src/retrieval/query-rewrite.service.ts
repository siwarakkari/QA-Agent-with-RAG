// src/retrieval/query-rewrite.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService }         from '../llm/llm.service';
import { buildRewritePrompt } from '../prompts/rewrite.prompt';
import { Message }             from '../memory/session.store';


export interface RewriteResult {
  finalQuery  : string;
  wasRewritten: boolean;
  reasoning   : string;
}

@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);

  constructor(private readonly llm: LlmService) {}

  async rewrite(query: string, history: Message[]): Promise<RewriteResult> {
    this.logger.log(`[QUERY REWRITE SEVICE] rewriting query: ${query}`);

    if (history.length === 0)  {
      return { finalQuery: query, wasRewritten: false, reasoning: 'No history' };
    }

    const prompt = buildRewritePrompt({history:history ,latestQuery:query});
    const raw    = await this.llm.generateText(prompt);
    this.logger.log(`[QUERY REWRITE SEVICE] raw: ${raw}`);

    if (raw !== "UNCHANGED" ) {
      this.logger.log(`[QUERY REWRITE SEVICE] Rewritten query: ${raw}`);
      return { finalQuery: raw, wasRewritten: true, reasoning: 'Query rewritten' };
    }else{
      this.logger.log(`[QUERY REWRITE SEVICE] No rewrite needed`);
      return { finalQuery: query, wasRewritten: false, reasoning: 'No rewrite needed' };
  }
  
}}




















// // src/retrieval/query-rewrite.service.ts
// //
// //  Decides whether a query needs rewriting given conversation history,
// //  and produces a self-contained version when it does.
// //
// //  Only calls the LLM when there IS history — saves latency on first messages.

// import { Injectable, Logger } from '@nestjs/common';
// import { LlmService }          from '../llm/llm.service';
// import { Message }             from '../memory/session.store';
// import { buildRewritePrompt }  from '../prompts/rewrite.prompt';

// @Injectable()
// export class QueryRewriteService {
//   private readonly logger = new Logger(QueryRewriteService.name);

//   constructor(private readonly llm: LlmService) {}

//   // ── Rewrite query if needed, return the query to use for retrieval ────────
//   async rewrite(query: string, history: Message[]): Promise<string> {
//     // No history → nothing to resolve, skip the LLM call entirely
//     if (history.length === 0) return query;

//     const prompt = buildRewritePrompt({
//       history    : history.slice(-6), // last 3 turns (6 messages) is enough context
//       latestQuery: query,
//     });

//     const raw = (await this.llm.generateText(prompt, 150)).trim();

//     if (raw === 'UNCHANGED' || raw === '') {
//       this.logger.debug(`Query rewrite: UNCHANGED — "${query}"`);
//       return query;
//     }

//     this.logger.log(`Query rewritten: "${query}" → "${raw}"`);
//     return raw;
//   }
// }