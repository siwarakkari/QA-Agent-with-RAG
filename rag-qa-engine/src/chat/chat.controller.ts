// src/chat/chat.controller.ts
import {
  Controller, Post, Get, Body, Res, Param, HttpCode, Delete,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ChatService }       from './chat.service';
import { MemoryService }     from '../memory/memory.service';
import { ChatRequest }       from './dto/chat-request.dto';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService  : ChatService,
    private readonly memoryService: MemoryService,
  ) {}

  // POST /chat
  // Streams the LLM answer via UI message stream (streamProtocol: 'data').
  // useChat on the client reads this natively.
  @Post()
  // @HttpCode(200)
  async chat(
    @Body() dto  : ChatRequest,
    @Res()  reply: FastifyReply,
  ): Promise<void> {
    await this.chatService.chat(dto, reply);
  }

  // DELETE /chat/session/:id
  // Clears conversation history for a session.
  @Delete('session/:id')
  deleteSession(@Param('id') id: string): { deleted: boolean; sessionId: string } {
    this.memoryService.deleteSession(id);
    return { deleted: true, sessionId: id };
  }
}