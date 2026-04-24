// src/ingestion/embedding.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Chunk, EmbeddedChunk } from './ingestion.interfaces';

type PipelineType = (
  task: string,
  model: string,
  options?: Record<string, unknown>,
) => Promise<{ (input: string | string[], options?: Record<string, unknown>): Promise<any> }>;

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly modelName: string;
  private readonly batchSize: number;
  private initPromise: Promise<void>;
  private pipeline: Awaited<ReturnType<PipelineType>> | null = null;

  constructor(private readonly config: ConfigService) {
    this.modelName  = this.config.get<string>('EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2');
    this.batchSize  = this.config.get<number>('EMBEDDING_BATCH_SIZE', 1);
  }


  async onModuleInit() {
    this.initPromise = this.initialize();
    await this.initPromise;
  }

  private async initialize() {
    this.logger.log(`Loading embedding model: ${this.modelName}`);

    try {
      
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: PipelineType };

      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });

      this.logger.log('Embedding model ready');
    } catch (err) {
      this.logger.error(`Failed to load embedding model: ${err.message ?? err}`);
      throw err;
    }
  }

  // ── Embed a single text ───────────────────────────────────────────────────
  async embedText(text: string): Promise<number[]> {
    return this.runEmbedding([text]).then((vecs) => vecs[0]);
  }

  // ── Embed chunks in batches (parallel within each batch) ─────────────────
  async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    this.logger.log(`Embedding ${chunks.length} chunks in batches of ${this.batchSize}...`);

    const embedded: EmbeddedChunk[] = [];

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch  = chunks.slice(i, i + this.batchSize);
      const texts  = batch.map((c) => c.text);
      const vectors = await this.runEmbedding(texts);

      for (let j = 0; j < batch.length; j++) {
        embedded.push({ ...batch[j], vector: vectors[j] });
      }

      this.logger.log(`  Embedded ${Math.min(i + this.batchSize, chunks.length)}/${chunks.length}`);
    }

    return embedded;
  }

  private async ensureReady() {
    await this.initPromise;
    if (!this.pipeline) {
      throw new Error('Embedding pipeline failed to initialise');
    }
  }

  // ── Call model and return normalized float[] vectors ─────────────────────
  private async runEmbedding(texts: string[]): Promise<number[][]> {
    await this.ensureReady();

    const output = await this.pipeline!(texts, {
      pooling: 'mean',
      normalize: true,
    });

    return output.tolist() as number[][];
  }

  get dimension(): number {
    const dims: Record<string, number> = {
      'Xenova/all-MiniLM-L6-v2'    : 384,
      'Xenova/bge-small-en-v1.5'   : 384,
      'Xenova/bge-base-en-v1.5'    : 768,
    };
    return dims[this.modelName] ?? 384;
  }
}