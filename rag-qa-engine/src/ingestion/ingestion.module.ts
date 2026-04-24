// src/ingestion/ingestion.module.ts
import { Module } from '@nestjs/common';
import { ChunkingService }    from './chunking.service';
import { EmbeddingService }   from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { IngestionService }   from './ingestion.service';

@Module({
  providers: [
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    IngestionService,
  ],
  exports: [IngestionService,VectorStoreService,EmbeddingService,],
})
export class IngestionModule {}