// src/ingestion/ingestion.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { Article } from './ingestion.interfaces';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly chunking     : ChunkingService,
    private readonly embedding    : EmbeddingService,
    private readonly vectorStore  : VectorStoreService,
  ) {}

  
  async ingestCorpus(jsonPath: string, collectionName?: string): Promise<void> {
    this.logger.log(`Reading corpus from: ${jsonPath}`);

    const raw      = fs.readFileSync(jsonPath, 'utf-8');
    const articles : Article[] = JSON.parse(raw);

    this.logger.log(
      `Found ${articles.length} articles — ingesting into collection ` +
      `"${collectionName ?? 'default'}"...`
    );

    // Process each article sequentially 
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      this.logger.log(`[${i + 1}/${articles.length}] "${article.title}"`);
      await this.ingestArticle(article, collectionName);
    }

    // Rebuild BM25 ONCE after all articles are stored 
    this.logger.log('Rebuilding BM25 index from stored payloads...');
    await this.vectorStore.rebuildBM25(collectionName);

    const { totalChunks } = this.vectorStore.stats;
    this.logger.log('═'.repeat(50));
    this.logger.log(`✅ Ingestion complete`);
    this.logger.log(`   Articles : ${articles.length}`);
    this.logger.log(`   Chunks   : ${totalChunks}`);
    this.logger.log('═'.repeat(50));
  }

  // ── Process one article ───────────────────────────────────────────────────
  async ingestArticle(article: Article, collectionName?: string): Promise<void> {
    // 1. Chunk
    const chunks = this.chunking.chunkArticle(article);
    if (chunks.length === 0) {
      this.logger.warn(`  No chunks produced for "${article.title}", skipping`);
      return;
    }
    this.logger.log(`  Chunked   → ${chunks.length} chunks`);

    // 2. Embed
    const embedded = await this.embedding.embedChunks(chunks);
    this.logger.log(`  Embedded  → ${embedded.length} vectors`);

    // 3. Store 
    await this.vectorStore.upsert(embedded, collectionName);
    this.logger.log(`  Stored    ✓`);
  }


  async deleteCollection(collectionName?: string): Promise<void> {
    this.logger.log(`Deleting collection "${collectionName ?? 'default'}"...`);
    await this.vectorStore.deleteCollection(collectionName!);
    this.logger.log(`Deleted collection "${collectionName ?? 'default'}"`);
  }
}