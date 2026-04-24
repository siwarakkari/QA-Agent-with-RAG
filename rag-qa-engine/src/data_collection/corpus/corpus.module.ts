// src/corpus/corpus.module.ts
import { Module } from '@nestjs/common';
import { WikipediaModule } from '../wikipedia/wikipedia.module';
import { CorpusService } from './corpus.service';

@Module({
  imports: [WikipediaModule],
  providers: [CorpusService],
  exports: [CorpusService],
})
export class CorpusModule {}
 