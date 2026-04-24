// src/chat/chat.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { UI_MESSAGE_STREAM_HEADERS } from 'ai';

import { MemoryService } from '../memory/memory.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ContextBuilderService } from '../retrieval/context-builder.service';
import { LlmService } from '../llm/llm.service';
import { buildSystemPrompt } from '../prompts/system.prompt';
import { ChatRequest } from './dto/chat-request.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly defaultCollection: string;

  constructor(
    private readonly config: ConfigService,
    private readonly memory: MemoryService,
    private readonly retrieval: RetrievalService,
    private readonly ctxBuilder: ContextBuilderService,
    private readonly llm: LlmService,
  ) {
    this.defaultCollection = this.config.get<string>('QDRANT_DEFAULT_COLLECTION', 'wwii_corpus');
  }

  /**
   * Main chat entry point. Orchestrates the RAG pipeline and streams the response.
   * 
   * Pipeline:
   * 1. Resolve session & load history
   * 2. Retrieve context (Query Rewrite -> Hybrid Search -> Rerank)
   * 3. Call LLM stream
   * 4. Manually pipe LLM stream to Fastify response (SSE)
   * 5. Append citations to the same stream before closing
   */
  async chat(dto: ChatRequest, reply: FastifyReply): Promise<void> {
    const collectionName = dto.collectionName ?? this.defaultCollection;

    // ── 1. Extract latest user message ────────────────────────────────────────
    if (!dto.messages?.length) throw new Error('messages array is empty');
    const lastMsg = dto.messages[dto.messages.length - 1];
    const message = typeof lastMsg.content === 'string' ? lastMsg.content.trim() : '';
    if (!message) throw new Error('Latest message content is empty');

    // ── 2. Session + history ──────────────────────────────────────────────────
    const sessionId = this.memory.resolveSession(dto.sessionId);
    const history = this.memory.getHistory(sessionId);
    this.logger.log(`[${sessionId}] Incoming message: "${message}"`);

    // ── 3. Retrieve context ───────────────────────────────────────────────────
    const retrieved = await this.retrieval.retrieve({
      query: message,
      history,
      collectionName,
    });

    if (retrieved.wasRewritten) {
      this.logger.log(`[${sessionId}] Query rewritten to: "${retrieved.finalQuery}"`);
    }

    // ── 4. Prepare LLM Prompts ────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({ collectionName, userName: dto.userName });

    const userMessageWithContext = retrieved.contextBlock
      ? `CONTEXT:\n${retrieved.contextBlock}\n\nQuestion: ${retrieved.finalQuery}`
      : retrieved.finalQuery;
    this.logger.log(`[${sessionId}] Final query: "${userMessageWithContext}"`);

    // Convert memory history to LLM ModelMessage format
    const coreHistory = history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }));

    // ── 5. Initiate LLM Stream ───────────────────────────────────────────────
    const result = this.llm.streamChat({
      systemPrompt,
      history: coreHistory,
      userMessage: userMessageWithContext,
    });

    // ── 6. Prepare Fastify Response (SSE) ─────────────────────────────────────
    const rawResponse = reply.raw;

    // ADD THESE LINES MANUALLY HERE:
    rawResponse.setHeader('Access-Control-Allow-Origin', '*');
    rawResponse.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    rawResponse.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
    rawResponse.writeHead(200, UI_MESSAGE_STREAM_HEADERS);

    // ── 7. Pipe Stream to Response ────────────────────────────────────────────
    const uiStream = result.toUIMessageStream();

    try {
      for await (const chunk of uiStream) {
        rawResponse.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (err) {
      this.logger.error(`[${sessionId}] Stream encountered an error: ${(err as Error).message}`);
      rawResponse.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream interrupted' })}\n\n`);
      rawResponse.write('data: [DONE]\n\n');
      rawResponse.end();
      return;
    }

    // ── 8. Collect full answer and persist ────────────────────────────────────
    const fullAnswer = await result.text;

    this.memory.addUserMessage(sessionId, message);
    this.memory.addAssistantMessage(sessionId, fullAnswer);
    this.logger.log(`[${sessionId}] Assistant response complete (${fullAnswer.length} chars)`);

    // ── 9. Extract and append citations ───────────────────────────────────────
    try {
      const citations = await this.llm.extractCitations({
        answer: fullAnswer,
        chunks: this.ctxBuilder.flattenChunks(retrieved.chunkMap),
      });

      if (citations.citations.length > 0) {
        this.logger.log(
          `[${sessionId}] Citations extracted: ` +
          citations.citations.map(c => `[${c.id}] ${c.sourceTitle}`).join(', '),
        );
      }

      // Write citations as a custom SSE data chunk
      rawResponse.write(`data: ${JSON.stringify({ type: 'data-citations', data: citations })}\n\n`);
    } catch (err) {
      this.logger.warn(`[${sessionId}] Citation extraction failed: ${(err as Error).message}`);
      rawResponse.write(`data: ${JSON.stringify({ type: 'data-citations', data: { citations: [] } })}\n\n`);
    }

    // ── 10. Close Stream ──────────────────────────────────────────────────────
    rawResponse.write('data: [DONE]\n\n');
    rawResponse.end();
  }
}
