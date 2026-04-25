import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { EvaluationRunner } from './evaluation';

async function bootstrap() {
  const logger = new Logger('IngestionPipeline');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  await app.init();
  const runner = app.get(EvaluationRunner);
  
  try {
    await runner.run_evaluation();
    console.log('Evaluation completed successfully');
  } catch (err) {
    console.error('Evaluation failed', err);
  } finally {
    await app.close();
  }
}

bootstrap();