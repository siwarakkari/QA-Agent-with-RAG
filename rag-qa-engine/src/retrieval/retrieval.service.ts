// src/retrieval/retrieval.service.ts
//
//  Orchestrates: query rewrite → vector search → rerank → context build.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }       from '@nestjs/config';
import { VectorStoreService }  from '../ingestion/vector-store.service';
import { QueryRewriteService } from './query-rewrite.service';
import { ContextBuilderService, BuiltContext } from './context-builder.service';
import { Message }             from '../memory/session.store';


export interface RetrievalOutput extends BuiltContext {
  finalQuery  : string;
  wasRewritten: boolean;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly topK  : number;

  constructor(
    private readonly vectorStore   : VectorStoreService,
    private readonly queryRewriter : QueryRewriteService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly config        : ConfigService,
  ) {
    this.topK = this.config.get<number>('RETRIEVAL_TOP_K',5);
  }

  // ── Full retrieval pipeline ───────────────────────────────────────────────
  async retrieve(params: {
    query          : string;
    history        : Message[];
    collectionName : string;
  }): Promise<RetrievalOutput>  {
    const { query, history, collectionName } = params;


    // 1. Rewrite query if it depends on history
    const rewrittenQuery = await this.queryRewriter.rewrite(query, history);
    this.logger.log(`[${collectionName}] Original query: ${query}`);
    this.logger.log(`[${collectionName}] Rewritten query: ${rewrittenQuery.finalQuery}`);



    // 2. Hybrid search 
    const candidates = await this.vectorStore.similaritySearch(
      rewrittenQuery.finalQuery,
      this.topK *2,
      collectionName,
    );

    // 3. Rerank
    const ranked = this.vectorStore.rerank(rewrittenQuery.finalQuery, candidates);
    const topResults = ranked.slice(0, this.topK);

    this.logger.log(
      `[${collectionName}] Retrieved ${topResults.length} chunks ` +
      `for query: "${rewrittenQuery.finalQuery}"`,
    );

    // 4. Build context block
    const context = this.contextBuilder.build(topResults);

    return { ...context, finalQuery: rewrittenQuery.finalQuery, wasRewritten:rewrittenQuery.wasRewritten  };
  }
}