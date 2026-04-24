// src/corpus/corpus.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WikipediaService, WikiArticle } from '../wikipedia/wikipedia.service';
import * as fs from 'fs';

// ─── Seed articles  ───────────────
const SEED_TITLES = [
  'World War II', 'Causes of World War II', 'Aftermath of World War II',
  'European theatre of World War II', 'Pacific War',
  'Eastern Front (World War II)', 'Western Front (World War II)',
  'Battle of Stalingrad', 'Battle of Normandy', 'Battle of Britain',
  'Battle of the Bulge', 'Battle of Midway', 'Battle of Berlin',
  'Operation Overlord', 'Operation Barbarossa',
  'Adolf Hitler', 'Winston Churchill', 'Franklin D. Roosevelt',
  'Joseph Stalin', 'Dwight D. Eisenhower', 'Erwin Rommel',
  'Axis powers', 'Allies of World War II', 'Nazi Germany', 'Empire of Japan',
  'The Holocaust', 'Atomic bombings of Hiroshima and Nagasaki',
  'Dunkirk evacuation', 'Manhattan Project', 'Nuremberg trials',
  'Lend-Lease', 'Blitzkrieg', 'D-Day',
];

// ─── Search queries for auto-discovery ────────────────────
const SEARCH_QUERIES = [
  'World War II major battles',
  'World War II military operations',
  'World War II leaders commanders',
  'Holocaust Nazi concentration camps',
  'Pacific War Japan United States',
];

// ─── Keywords to filter relevant linked articles ──────────
const RELEVANCE_KEYWORDS = [
  'world war', 'wwii', 'ww2', 'nazi', 'allied', 'axis',
  'battle of', 'operation ', 'invasion of', 'siege of',
  'holocaust', 'third reich', 'blitzkrieg', 'pacific war',
  'eastern front', 'western front', 'normandy', 'stalingrad',
  'hiroshima', 'manhattan project', 'dunkirk',
];

@Injectable()
export class CorpusService {
  private readonly logger = new Logger(CorpusService.name);
  private readonly target: number;
  private readonly delayMs: number;
  private readonly outputJson: string;

  constructor(private readonly config: ConfigService, private readonly wikipedia: WikipediaService) {
    this.target = this.config.get('CORPUS_TARGET_ARTICLES', 10);
    this.delayMs = this.config.get('CORPUS_DELAY_MS', 500);
    this.outputJson = this.config.get('CORPUS_OUTPUT_JSON', 'wwii_corpus.json');
  }

  async buildCorpus() {
    this.logger.log(`Corpus build starting (target: ${this.target})`);

    const titles = await this.collectTitles();
    const articles: WikiArticle[] = [];

    for (let i = 0; i < titles.length; i++) {
      this.logger.log(`[${i + 1}/${titles.length}] Fetching: ${titles[i]}`);
      const article = await this.wikipedia.fetchArticle(titles[i]);
      if (article) articles.push(article);
      await this.delay();
    }

    fs.writeFileSync(this.outputJson, JSON.stringify(articles, null, 2), 'utf-8');
    this.logger.log(`Corpus saved to ${this.outputJson}`);
    return articles;
  }

  private async collectTitles(): Promise<string[]> {
    const seen = new Set<string>(SEED_TITLES);
    const titles = [...SEED_TITLES];

    for (const query of SEARCH_QUERIES) {
      if (titles.length >= this.target) break;
      const results = await this.wikipedia.search(query, 10);
      for (const t of results) {
        if (!seen.has(t) && this.isRelevant(t)) {
          titles.push(t);
          seen.add(t);
        }
      }
      await this.delay();
    }
    return titles.slice(0, this.target);
  }

  private isRelevant = (t: string) => RELEVANCE_KEYWORDS.some(kw => t.toLowerCase().includes(kw));

  private delay = () => new Promise(r => setTimeout(r, this.delayMs));
}