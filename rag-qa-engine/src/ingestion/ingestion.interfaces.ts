// src/ingestion/ingestion.interfaces.ts

export interface ArticleSection {
  title: string;
  content: string;
}

export interface Article {
  id: number;
  title: string;
  url: string;
  introduction: string;
  sections: ArticleSection[];
}

// ── single chunk ───────────────────────────────
export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  sourceTitle: string;          
  sourceType: 'wikipedia';
  section: string;         
  chunkIndex: number;        
  url: string;
}

// ── A chunk after embedding ──────────────────────────────────────────────────
export interface EmbeddedChunk {
  text: string;
  vector: number[];
  metadata: ChunkMetadata;
}

// ── Retrieval result  ──────────────────────────────────
export interface RetrievalResult {
  text: string;
  metadata: ChunkMetadata;
  score: number;        
  vectorScore: number;  
  bm25Score: number;    
}