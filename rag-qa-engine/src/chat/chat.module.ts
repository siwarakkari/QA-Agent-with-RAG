// src/chat/chat.module.ts
import { Module }          from '@nestjs/common';
import { ChatController }  from './chat.controller';
import { ChatService }     from './chat.service';
import { CitationStore }   from './citation.store';
import { MemoryModule }    from '../memory/memory.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { LlmModule }       from '../llm/llm.module';

@Module({
  imports    : [MemoryModule, RetrievalModule, LlmModule],
  controllers: [ChatController],
  providers  : [ChatService, CitationStore],
})
export class ChatModule {}