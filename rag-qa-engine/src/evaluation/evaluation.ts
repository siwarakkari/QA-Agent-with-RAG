#!/usr/bin/env tsx
// src/evaluation/evaluate.ts
//
//  Entry point for  pnpm evaluate
//
//  Responsibilities (only):
//    1. Read config from env / defaults
//    2. Load test cases
//    3. Orchestrate EvaluatorService (one case at a time, with delay)
//    4. Print results table to terminal
//    5. Save JSON to src/evaluation/results/
//
//  All scoring logic  → metrics.service.ts
//  All prompt logic   → src/prompts/eval-judge.prompt.ts
//  All chat/SSE logic → evaluator.service.ts

import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { EvaluatorService, TestCase, EvalResult } from './evaluator.service';

@Injectable()
export class EvaluationRunner {
  private readonly apiUrl: string;
  private readonly groqApiKey: string;
  private readonly judgeModel: string;
  private readonly collection: string;
  private readonly delayMs: number;

  private readonly resultsDir = path.join(__dirname, 'results');
  private readonly testCasesPath = path.join(__dirname, 'test-cases.json');
  private readonly latestPath = path.join(this.resultsDir, 'latest-results.json');

  constructor(
    private configService: ConfigService,
    private metricsService: MetricsService,
    private evaluatorService: EvaluatorService,
  ) {
    // ── Config Retrieval ────────────────────────────────────────────────────────
    this.apiUrl = this.configService.get<string>('EVAL_API_URL', 'http://localhost:3002/chat');
    this.groqApiKey = this.configService.get<string>('GROQ_API_KEY', '');
    this.judgeModel = this.configService.get<string>('EVAL_JUDGE_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct');
    this.collection = this.configService.get<string>('EVAL_COLLECTION', 'wwii_corpus');
    
    // ConfigService.get returns strings by default from .env, so we parse here
    const delayRaw = this.configService.get<string>('EVAL_DELAY_MS', '600');
    this.delayMs = parseInt(delayRaw, 10);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  avg(nums: number[]): string {
    return nums.length
      ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)
      : 'N/A';
  }

  pad(s: string | number, len: number): string {
    return String(s).padEnd(len);
  }

  bar(score: number, max = 5): string {
    const filled = Math.round((score / max) * 8);
    return '█'.repeat(filled) + '░'.repeat(8 - filled);
  }

  printTable(results: EvalResult[]): void {
    const W = 100;
    console.log('\n' + '═'.repeat(W));
    console.log(' RESULTS TABLE');
    console.log('═'.repeat(W));
    console.log(
      this.pad('ID', 4) + this.pad('Category', 16) +
      this.pad('Relevance', 14) + this.pad('Grounded', 14) +
      this.pad('Cit.Acc (n)', 14) + 'this.Question',
    );
    console.log('─'.repeat(W));

    for (const r of results) {
      if (r.error) {
        console.log(`${this.pad(r.id, 4)}${this.pad(r.category, 16)}${'ERROR'.padEnd(42)}${this.pad(r.question.slice(0, 40), 40)}`);
        continue;
      }
      const { relevance, groundedness, citationAccuracy, citationCount } = r.scores;
      console.log(
        this.pad(r.id, 4) +
        this.pad(r.category, 16) +
        this.pad(`${relevance}/5 ${this.bar(relevance)}`, 14) +
        this.pad(`${groundedness}/5 ${this.bar(groundedness)}`, 14) +
        this.pad(`${citationAccuracy.toFixed(2)} (${citationCount})`, 14) +
        this.pad(r.question.slice(0, 40), 40),
      );
    }
  }

  printSummary(results: EvalResult[]): void {
    const ok         = results.filter((r) => !r.error);
    const categories = ['factual', 'multi_document', 'followup', 'out_of_scope'] as const;

    console.log('\n' + '═'.repeat(62));
    console.log(' SUMMARY BY CATEGORY');
    console.log('═'.repeat(62));
    console.log(this.pad('Category', 18) + this.pad('Avg Relevance', 16) + this.pad('Avg Grounded', 16) + 'Avg Cit.Acc');
    console.log('─'.repeat(62));

    for (const cat of categories) {
      const group = ok.filter((r) => r.category === cat);
      if (!group.length) continue;
      console.log(
        this.pad(cat, 18) +
        this.pad(this.avg(group.map((r) => r.scores.relevance)), 16) +
        this.pad(this.avg(group.map((r) => r.scores.groundedness)), 16) +
        this.avg(group.map((r) => r.scores.citationAccuracy)),
      );
    }

    console.log('─'.repeat(62));
    console.log(
      this.pad('OVERALL', 18) +
      this.pad(this.avg(ok.map((r) => r.scores.relevance)), 16) +
      this.pad(this.avg(ok.map((r) => r.scores.groundedness)), 16) +
      this.avg(ok.map((r) => r.scores.citationAccuracy)),
    );
    console.log('═'.repeat(62));
  }

  printReasons(results: EvalResult[]): void {
    console.log('\n' + '═'.repeat(80));
    console.log(' JUDGE REASONING ');
    console.log('═'.repeat(80));

    const lowScores = results.filter(
      (r) => !r.error && (r.scores.relevance < 4 || r.scores.groundedness < 4),
    );

    if (!lowScores.length) {
      console.log(' All responses scored 4 or above. ');
      return;
    }

    for (const r of lowScores) {
      console.log(`\n[${r.id}] ${r.question}`);
      console.log(`  Relevance   ${r.scores.relevance}/5 — ${r.scores.relevanceReason}`);
      console.log(`  Groundedness ${r.scores.groundedness}/5 — ${r.scores.groundednessReason}`);
    }
  }

// ── Main ──────────────────────────────────────────────────────────────────────
  async run_evaluation(): Promise<void> {
    console.log('RAG PIPELINE EVALUATION HARNESS ');

    if (!this.groqApiKey) {
      console.error('  GROQ_API_KEY is not set.\n');
      process.exit(1);
    }

    const testCases: TestCase[] = JSON.parse(fs.readFileSync(this.testCasesPath, 'utf-8'));
    console.log(` ${testCases.length} test cases  |  API: ${this.apiUrl}  |  Collection: ${this.collection}\n`);

    const metrics   = new MetricsService(this.groqApiKey,  this.judgeModel);
    const evaluator = new EvaluatorService(this.apiUrl, this.collection, metrics);
    const results   : EvalResult[] = [];

    for (const tc of testCases) {
      process.stdout.write(
        `[${String(tc.id).padStart(2)}/${testCases.length}] ${tc.category.padEnd(14)} ` +
        `"${tc.question.slice(0, 48)}…" `,
      );

      const result = await evaluator.runCase(tc);
      results.push(result);

      if (result.error) {
        console.log(` ${result.error.slice(0, 60)}`);
      } else {
        const { relevance, groundedness, citationAccuracy, durationMs } = {
          ...result.scores, durationMs: result.durationMs,
        };
        console.log(` R:${relevance} G:${groundedness} C:${citationAccuracy.toFixed(2)}  (${durationMs}ms)`);
      }

      // Rate-limit buffer between calls
      if (tc !== testCases[testCases.length - 1]) {
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
    }

    // ── Print tables ──────────────────────────────────────────────────────────
    this.printTable(results);
    this.printSummary(results);
    this.printReasons(results);

    // ── Save results ──────────────────────────────────────────────────────────
    fs.mkdirSync(this.resultsDir, { recursive: true });

    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(this.resultsDir, `results-${timestamp}.json`);

    const ok      = results.filter((r) => !r.error);
    const payload = {
      timestamp,
      config : { apiUrl: this.apiUrl, collection: this.collection, judgeModel: this.judgeModel },
      summary: {
        totalCases          : results.length,
        successfulCases     : ok.length,
        avgRelevance        : this.avg(ok.map((r) => r.scores.relevance)),
        avgGroundedness     : this.avg(ok.map((r) => r.scores.groundedness)),
        avgCitationAccuracy : this.avg(ok.map((r) => r.scores.citationAccuracy)),
      },
      results,
    };

    // Write timestamped + always overwrite latest
    fs.writeFileSync(outputPath,  JSON.stringify(payload, null, 2));
    fs.writeFileSync(this.latestPath, JSON.stringify(payload, null, 2));

    console.log(`\n Saved to ${outputPath}`);
    console.log(`  Updated  ${this.latestPath}\n`);
  }
}
