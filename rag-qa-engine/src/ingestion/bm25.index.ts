// src/ingestion/bm25.index.ts

export interface BM25Doc {
  id  : number;
  text: string;
}

export interface BM25Result {
  id   : number;
  score: number;
}

export class BM25Index {
  private readonly k1 = 1.5;
  private readonly b  = 0.75;

  private docs : BM25Doc[]               = [];
  private df    = new Map<string, number>();
  private idf   = new Map<string, number>();
  private avgdl = 0;

  // ── Index documents ───────────────────────────────────────────────────────
  addDocuments(docs: BM25Doc[]): void {
    this.docs  = docs;
    this.avgdl = docs.reduce((s, d) => s + this.tokenize(d.text).length, 0) / docs.length;

    this.df.clear();
    for (const doc of docs) {
      const unique = new Set(this.tokenize(doc.text));
      for (const term of unique) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.idf.clear();
    const N = docs.length;
    for (const [term, freq] of this.df) {
      this.idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }
  }

  // ── Score all documents for a query, return top-k ────────────────────────
  search(query: string, k: number): BM25Result[] {
    if (this.docs.length === 0) return [];

    const queryTerms = this.tokenize(query);
    const scores: BM25Result[] = this.docs.map((doc, id) => ({
      id,
      score: this.scoreDoc(doc.text, queryTerms),
    }));

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  termWeight(term: string): number {
    return this.idf.get(term) ?? Math.log(1.5);
  }

  // ── BM25 score for one document ───────────────────────────────────────────
  private scoreDoc(text: string, queryTerms: string[]): number {
    const tokens = this.tokenize(text);
    const len    = tokens.length;

    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f   = tf.get(term) ?? 0;
      const idf = this.idf.get(term) ?? 0;
      score += idf * (f * (this.k1 + 1)) /
               (f + this.k1 * (1 - this.b + this.b * (len / this.avgdl)));
    }
    return score;
  }

  // ── Tokenizer ─────────────────────────────────────────────────────────────
  private readonly stopwords = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'by','from','is','was','are','were','be','been','has','have','had',
    'it','its','this','that','these','those','as','so','if','not','no',
  ]);

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !this.stopwords.has(t));
  }
}