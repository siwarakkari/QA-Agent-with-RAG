// src/ingestion/vector-store.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService }                     from '@nestjs/config';
import { QdrantClient }                      from '@qdrant/js-client-rest';
import { EmbeddingService }                              from './embedding.service';
import { BM25Index }                                     from './bm25.index';
import { EmbeddedChunk, ChunkMetadata, RetrievalResult } from './ingestion.interfaces';

// ── Payload shape Qdrant point ────────────────────────────
interface ChunkPayload extends ChunkMetadata {
  text            : string;
  chunkIndexGlobal: number;
}

function asPayload(raw: Record<string, unknown> | null | undefined): ChunkPayload {
  return raw as unknown as ChunkPayload;
}

const DENSE        = 'dense';
const SPARSE       = 'sparse';
const UPSERT_BATCH = 25;
const SCROLL_PAGE  = 500;

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);

  private readonly client            : QdrantClient;
  private readonly defaultCollection : string;
  private readonly topK              : number;
  private readonly vectorWeight      : number;
  private readonly bm25Weight        : number;

  private readonly bm25Map = new Map<string, BM25Index>();
  private readonly sizeMap = new Map<string, number>();

  constructor(
    private readonly config   : ConfigService,
    private readonly embedding: EmbeddingService,
  ) {
    const url    = this.config.get<string>('QDRANT_URL', 'http://localhost:6333');
    const apiKey = this.config.get<string | undefined>('QDRANT_API_KEY');

    this.client             = new QdrantClient(apiKey ? { url, apiKey } : { url });
    this.defaultCollection  = this.config.get<string>('QDRANT_DEFAULT_COLLECTION', 'wwii_corpus');
    this.topK               = this.config.get<number>('RETRIEVAL_TOP_K', 10);
    this.vectorWeight       = this.config.get<number>('RETRIEVAL_VECTOR_WEIGHT', 0.7);
    this.bm25Weight         = this.config.get<number>('RETRIEVAL_BM25_WEIGHT', 0.3);
  }

  async onModuleInit(): Promise<void> {
    await this.waitForQdrant();
    await this.ensureCollection(this.defaultCollection);
    await this.warmupBM25(this.defaultCollection);
    this.logger.log(
      `VectorStoreService ready — collection="${this.defaultCollection}" ` +
      `(${this.sizeMap.get(this.defaultCollection) ?? 0} points)`,
    );
  }

  
  private async waitForQdrant(): Promise<void> {
    const maxRetries = this.config.get<number>('QDRANT_CONNECT_RETRIES', 10);
    const delayMs    = this.config.get<number>('QDRANT_CONNECT_DELAY_MS', 2000);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.client.getCollections();
        this.logger.log(`Qdrant is reachable (attempt ${attempt}/${maxRetries})`);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })
          ?.cause?.code ?? (err as NodeJS.ErrnoException)?.code;

        this.logger.warn(
          `Qdrant not ready yet (${code ?? 'unknown'}) — ` +
          `waiting ${delayMs}ms… (${attempt}/${maxRetries})`,
        );

        if (attempt === maxRetries) {
          throw new Error(
            `Cannot reach Qdrant at ${this.config.get('QDRANT_URL', 'http://localhost:6333')} ` +
            `after ${maxRetries} attempts. Is Qdrant running?\n` +
            `Start it with: docker run -d -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant`,
          );
        }

        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  upsert()
  // ══════════════════════════════════════════════════════════════════════════
  async upsert(
    chunks         : EmbeddedChunk[],
    collectionName = this.defaultCollection,
  ): Promise<void> {
    if (chunks.length === 0) return;

    // ensureCollection is intentionally NOT called here —
    // the collection is already guaranteed to exist after onModuleInit.
    // Calling getCollection() on every article upsert hammers Qdrant
    // with repeated TCP connections and causes UND_ERR_SOCKET drops.
    const bm25  = this.getBM25(collectionName);
    const start = this.sizeMap.get(collectionName) ?? 0;

    const points = chunks.map((chunk, i) => ({
      id    : start + i,
      vector: {
        [DENSE] : chunk.vector,
        [SPARSE]: this.toSparseVector(chunk.text, bm25),
      },
      payload: {
        text            : chunk.text,
        chunkIndexGlobal: start + i,
        ...chunk.metadata,
      } satisfies ChunkPayload,
    }));

    for (let i = 0; i < points.length; i += UPSERT_BATCH) {
      const batch = points.slice(i, i + UPSERT_BATCH);
      await this.withRetry(() =>
        this.client.upsert(collectionName, { wait: true, points: batch }),
      );
    }

    this.sizeMap.set(collectionName, start + chunks.length);
    // NOTE: warmupBM25 is intentionally NOT called here.
    // It rebuilds from ALL stored payloads via Qdrant scroll — O(total_points).
    // Calling it after every article would be O(n²) over the whole corpus.
    // Call vectorStore.rebuildBM25() once after ingesting everything.
    this.logger.log(
      `[${collectionName}] Upserted ${chunks.length} chunks (total: ${start + chunks.length})`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  similaritySearch() — hybrid dense + sparse with server-side RRF
  // ══════════════════════════════════════════════════════════════════════════
  async similaritySearch(
      query          : string,
      topK           = this.topK,
      collectionName = this.defaultCollection,
    ): Promise<RetrievalResult[]> {
      if ((this.sizeMap.get(collectionName) ?? 0) === 0) return [];
  
      const bm25     = this.getBM25(collectionName);
      const queryVec = await this.embedding.embedText(query);
      const sparse   = this.toSparseVector(query, bm25);
  
      const response = await this.client.query(collectionName, {
        prefetch: [
          { query: queryVec,            using: DENSE,  limit: topK * 3 },
          { query: sparse,              using: SPARSE, limit: topK * 3 },
        ],
        query       : { fusion: 'rrf' },
        limit       : topK,
        with_payload: true,
        with_vector : [DENSE],
      } as any);

  
      const bm25ScoreMap = new Map<number, number>(
        bm25.search(query, topK * 3).map((r) => [r.id, r.score]),
      );
  
      return response.points.map((point) => {
        const payload     = asPayload(point.payload);
        const rawVec      = (point.vector as Record<string, unknown> | null)?.[DENSE];
        const denseVec    = Array.isArray(rawVec) ? (rawVec as number[]) : [];
        const vectorScore = denseVec.length ? this.cosineSim(queryVec, denseVec) : 0;
        const bm25Score   = bm25ScoreMap.get(point.id as number) ?? 0;
  
        return {
          text        : payload.text,
          metadata    : this.extractMetadata(payload),
          score       : point.score,
          vectorScore,
          bm25Score,
        };
      });
    }
 

  // ══════════════════════════════════════════════════════════════════════════
  //  rerank()
  // ══════════════════════════════════════════════════════════════════════════
  rerank(query: string, results: RetrievalResult[]): RetrievalResult[] {
    if (results.length === 0) return [];
    const queryTokens = new Set(this.tokenize(query));

    return results
      .map((r) => {
        const docTokens    = new Set(this.tokenize(r.text));
        const intersection = [...queryTokens].filter((t) => docTokens.has(t)).length;
        const overlap      =
          intersection / (queryTokens.size + docTokens.size - intersection + 1e-9);
        return { ...r, score: this.vectorWeight * r.score + this.bm25Weight * overlap };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ── fetchChunksParallel ───────────────────────────────────────────────────
  async fetchChunksParallel(
    ids            : number[],
    collectionName = this.defaultCollection,
  ): Promise<Array<{ text: string; metadata: ChunkMetadata }>> {
    if (ids.length === 0) return [];
    const response = await this.client.retrieve(collectionName, {
      ids,
      with_payload: true,
      with_vector : false,
    });
    return response.map((point) => {
      const payload = asPayload(point.payload);
      return { text: payload.text, metadata: this.extractMetadata(payload) };
    });
  }

  // Call once after a full corpus ingestion to build BM25 from all stored chunks
  async rebuildBM25(collectionName = this.defaultCollection): Promise<void> {
    await this.warmupBM25(collectionName);
  }

  async listCollections(): Promise<string[]> {
    const res = await this.client.getCollections();
    return res.collections.map((c) => c.name);
  }

  async deleteCollection(name: string): Promise<void> {
    await this.client.deleteCollection(name);
    this.bm25Map.delete(name);
    this.sizeMap.delete(name);
    this.logger.log(`Collection "${name}" deleted`);
  }

  get stats() {
    const size = this.sizeMap.get(this.defaultCollection) ?? 0;
    return { totalChunks: size, QdrantVectors: size };
  }

  
  private async ensureCollection(name: string): Promise<void> {
    
    let pointsCount = 0;
    let collectionFound = false;

    try {
      const info  = await this.client.getCollection(name);
      pointsCount = info.points_count ?? 0;
      collectionFound = true;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 404) throw err;
    }

    if (!collectionFound) {
      await this.client.createCollection(name, {
        vectors: {
          [DENSE]: {
            size    : this.embedding.dimension,
            distance: 'Cosine',
          },
        },
        sparse_vectors: {
          [SPARSE]: {},
        },
      });
      this.logger.log(`Created Qdrant collection "${name}" (dim=${this.embedding.dimension})`);
      this.sizeMap.set(name, 0);
    } else {
      this.sizeMap.set(name, pointsCount);
      this.logger.log(`Collection "${name}" already exists (${pointsCount} points)`);
    }
  }

  // ── Rebuild BM25 by scrolling all payloads from Qdrant ────────────────────
  private async warmupBM25(collectionName: string): Promise<void> {
    const size = this.sizeMap.get(collectionName) ?? 0;
    if (size === 0) return;

    const docs: Array<{ id: number; text: string }> = [];
    let   offset: string | number | null = null;

    do {
      const page = await this.client.scroll(collectionName, {
        limit       : SCROLL_PAGE,
        offset,
        with_payload: true,
        with_vector : false,
      });

      for (const point of page.points) {
        const payload = asPayload(point.payload);
        docs.push({ id: point.id as number, text: payload.text });
      }

      const next = page.next_page_offset;
      offset = (typeof next === 'string' || typeof next === 'number') ? next : null;
    } while (offset !== null);

    if (docs.length > 0) {
      this.getBM25(collectionName).addDocuments(docs);
      this.logger.log(`[${collectionName}] BM25 rebuilt from ${docs.length} payloads`);
    }
  }

  private getBM25(collectionName: string): BM25Index {
    if (!this.bm25Map.has(collectionName)) {
      this.bm25Map.set(collectionName, new BM25Index());
    }
    return this.bm25Map.get(collectionName)!;
  }

  private toSparseVector(
    text: string,
    bm25: BM25Index,
  ): { indices: number[]; values: number[] } {
    const tokens  = this.tokenize(text);
    const weights = new Map<number, number>();
    for (const token of tokens) {
      const idx = this.hashTerm(token);
      weights.set(idx, (weights.get(idx) ?? 0) + bm25.termWeight(token));
    }
    const entries = [...weights.entries()];
    return {
      indices: entries.map(([idx]) => idx),
      values : entries.map(([, val]) => val),
    };
  }

  private extractMetadata(payload: ChunkPayload): ChunkMetadata {
    return {
      sourceTitle  : payload.sourceTitle,
      sourceType   : payload.sourceType,
      section: payload.section,
      chunkIndex   : payload.chunkIndex,
      url          : payload.url,
    };
  }

  private cosineSim(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  private hashTerm(term: string): number {
    let h = 5381;
    for (let i = 0; i < term.length; i++) {
      h = ((h << 5) + h) ^ term.charCodeAt(i);
    }
    return Math.abs(h) % 1_048_576;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private async withRetry<T>(
    fn      : () => Promise<T>,
    attempts = 3,
    delayMs  = 500,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
      
        const cause    = (err as any)?.cause;
        const code     = cause?.code ?? (err as NodeJS.ErrnoException)?.code ?? '';
        const message  = (err as Error)?.message ?? '';
        const isRetryable =
          code === 'ECONNRESET'     ||
          code === 'ECONNREFUSED'   ||
          code === 'UND_ERR_SOCKET' ||   
          message.includes('fetch failed');
        if (!isRetryable || attempt === attempts) throw err;
        this.logger.warn(
          `Qdrant request failed (${code || message}), ` +
          `retrying in ${delayMs * attempt}ms (${attempt}/${attempts})...`
        );
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
    throw lastErr;
  }
}