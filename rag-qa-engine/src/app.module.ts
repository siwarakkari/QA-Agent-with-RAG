// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WikipediaModule } from './data_collection/wikipedia/wikipedia.module';
import { CorpusModule } from './data_collection/corpus/corpus.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WikipediaModule,
    CorpusModule,
    IngestionModule,
    ChatModule,
  ],
})
export class AppModule { }


