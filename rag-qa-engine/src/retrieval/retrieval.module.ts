// src/retrieval/retrieval.module.ts
import { Module }                  from '@nestjs/common';
import { RetrievalService }        from './retrieval.service';
import { QueryRewriteService }     from './query-rewrite.service';
import { ContextBuilderService }   from './context-builder.service';
import { LlmModule }               from '../llm/llm.module';
import { IngestionModule }         from '../ingestion/ingestion.module';
import { VectorStoreService } from '../ingestion/vector-store.service';

@Module({
  imports  : [LlmModule, IngestionModule],
  providers: [RetrievalService, QueryRewriteService, ContextBuilderService,VectorStoreService],
  exports  : [RetrievalService, ContextBuilderService],
})
export class RetrievalModule {}