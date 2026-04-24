// src/retrieval/context-builder.service.ts

import { Injectable } from '@nestjs/common';
import { RetrievalResult } from '../ingestion/ingestion.interfaces';

export interface BuiltContext {

  contextBlock: string;

  chunkMap: Map<number, {
    id         : number;
    text       : string;
    sourceTitle: string;
    url        : string;
  }>;
}

@Injectable()
export class ContextBuilderService {
  // ── Build numbered context block from retrieval results ───────────────────
  build(results: RetrievalResult[]): BuiltContext {
    const chunkMap = new Map<number, {
      id: number; text: string; sourceTitle: string; url: string;
    }>();

    if (results.length === 0) {
      return { contextBlock: '', chunkMap };
    }

    const lines: string[] = [
      'CONTEXT CHUNKS — cite these using [N] markers',
    ];

    results.forEach((r, i) => {
      const num = i + 1; 
      lines.push(
        `[${num}] Source: ${r.metadata.sourceTitle}` +
        (r.metadata.section ? ` › ${r.metadata.section}` : ''),
      );
      lines.push(`URL: ${r.metadata.url}`);
      lines.push(r.text.trim());
      lines.push('');

      chunkMap.set(num, {
        id         : num,
        text       : r.text,
        sourceTitle: r.metadata.sourceTitle,
        url        : r.metadata.url,
      });
    });

    lines.push('Answer the user using ONLY the chunks above. Cite with [N].');

    return { contextBlock: lines.join('\n'), chunkMap };
  }

  // ── Flatten chunkMap to array (for citation extraction call) ─────────────
  flattenChunks(chunkMap: BuiltContext['chunkMap']): Array<{
    id: number; text: string; sourceTitle: string; url: string;
  }> {
    return [...chunkMap.values()];
  }
}