import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CorpusService } from './corpus/corpus.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const corpusService = app.get(CorpusService);

  try {
    await corpusService.buildCorpus();
  } catch (error) {
    console.error('Data collection pipeline failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
