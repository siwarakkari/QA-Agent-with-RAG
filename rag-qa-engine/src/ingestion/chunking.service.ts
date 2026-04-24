// src/ingestion/chunking.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Article,
  ArticleSection,
  Chunk,
  ChunkMetadata,
} from './ingestion.interfaces';

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  // A paragraph smaller than this (in words) is kept as one unit
  private readonly paragraphThreshold: number;

  constructor(private readonly config: ConfigService) {
    this.paragraphThreshold = this.config.get<number>(
      'CHUNK_PARAGRAPH_THRESHOLD',
      80,
    );
  }

  chunkArticle(article: Article): Chunk[] {
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    // 1. Introduction / summary
    if (article.introduction?.trim()) {
      const introChunks = this.chunkText(article.introduction);
      for (const text of introChunks) {
        chunks.push({
          text,
          metadata: {
            sourceTitle  : article.title,
            sourceType   : 'wikipedia',
            section : 'Introduction',
            chunkIndex   : chunkIndex++,
            url          : article.url,
          },
        });
      }
    }

    // 2. Walk all sections recursively
    for (const section of article.sections) {
      chunkIndex = this.chunkSection(
        section,
        article,
        chunks,
        chunkIndex,
      );
    }

    this.logger.log(
      `"${article.title}" → ${chunks.length} chunks`,
    );
    return chunks;
  }

  // ── Recurse through section tree ─────────────────────────────────────────
  private chunkSection(
    section: ArticleSection,
    article: Article,
    chunks: Chunk[],
    chunkIndex: number,
  ): number {

    if (section.content?.trim()) {
      const metadata: ChunkMetadata = {
        sourceTitle  : article.title,
        sourceType   : 'wikipedia',
        section : section.title,
        chunkIndex,   
        url          : article.url,
      };

      const textChunks = this.chunkText(section.content);
      for (const text of textChunks) {
        chunks.push({ text, metadata: { ...metadata, chunkIndex: chunkIndex++ } });
      }
    }

    return chunkIndex;
  }

  // ── chunking logic ───────────────────────────────────────────────────

  private chunkText(text: string): string[] {
    const chunks: string[] = [];

    // Split into paragraphs (blank lines)
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, ' ').trim())
      .filter((p) => p.length > 0);

    for (const para of paragraphs) {
      const wordCount = para.split(/\s+/).length;

      if (wordCount <= this.paragraphThreshold) {
        // Small paragraph — keep as a single chunk
        chunks.push(para);
      } else {
        // Large paragraph — split into sentences
        const sentences = this.splitSentences(para);
        chunks.push(...sentences.filter((s) => s.trim().length > 0));
      }
    }

    return chunks;
  }

  // ── Sentence splitter ─────────────────────────────────────────────────────
  private splitSentences(text: string): string[] {
    const sanitized = text
      .replace(/\b(Mr|Mrs|Dr|Prof|Sr|Jr|vs|etc|approx|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./gi, '$1<DOT>')
      .replace(/([A-Z])\./g, '$1<DOT>'); 

    const raw = sanitized
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.replace(/<DOT>/g, '.').trim())
      .filter((s) => s.length > 0);

    return raw;
  }
}