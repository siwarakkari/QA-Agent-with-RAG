// src/ingestion/ingestion.pipeline.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { IngestionService } from './ingestion.service';

async function bootstrap() {
  const logger = new Logger('IngestionPipeline');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  await app.init();

  const ingestion = app.get(IngestionService);

  // ── Run corpus ingestion ─────────────────────────────────────────────────
  const corpusPath = process.env.CORPUS_OUTPUT_JSON ?? 'wwii_corpus.json';
  await ingestion.ingestCorpus(corpusPath);


  await app.close();
}

bootstrap();
