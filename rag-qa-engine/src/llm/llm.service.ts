// src/llm/llm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }       from '@nestjs/config';
import { createOpenAI }        from '@ai-sdk/openai';
import { streamText, generateObject, generateText } from 'ai';
import type { ModelMessage }   from 'ai';
import { CitationSchema, CitationDto } from '../chat/dto/citation.dto';
import { buildCitationPrompt }         from '../prompts/citation.prompt';

export interface StreamChatParams {
  systemPrompt: string;
  history     : ModelMessage[];
  userMessage : string;
}

@Injectable()
export class LlmService {
  private readonly logger    = new Logger(LlmService.name);
  private readonly groq      : ReturnType<typeof createOpenAI>;
  private readonly model     : string;
  private readonly maxTokens : number;

  constructor(private readonly config: ConfigService) {
    this.groq = createOpenAI({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey : this.config.getOrThrow<string>('GROQ_API_KEY'),
    });
    this.model     = this.config.get<string>('LLM_MODEL', 'meta-llama/llama-4-scout-17b-16e-instruct');
    this.maxTokens = this.config.get<number>('LLM_MAX_TOKENS', 1024);
  }


  streamChat(params: StreamChatParams): ReturnType<typeof streamText> {
    this.logger.log(`[LLM] streamChat | model=${this.model} | history=${params.history.length}`);
    
    const fullPrompt = this.buildChatPrompt(params);

    return streamText({
      model          : this.groq(this.model),
      prompt         : fullPrompt,
      maxOutputTokens: 1024,
    });
  }

  
    // Extracts structured citations from an answer based on provided context chunks.
   
  async extractCitations(params: {
    answer: string;
    chunks: Array<{ id: number; text: string; sourceTitle: string; url: string }>;
  }): Promise<CitationDto> {
    if (!params.chunks.length) {
      this.logger.warn('[LLM] extractCitations called with no chunks');
      return { citations: [] };
    }

    this.logger.log(`[LLM] extractCitations | chunks=${params.chunks.length}`);
    const prompt     = buildCitationPrompt(params);
    const maxRetries = this.config.get<number>('CITATION_MAX_RETRIES', 3);
    const baseDelay  = this.config.get<number>('CITATION_RETRY_DELAY_MS', 500);

    return this.withRetry(
      () => generateObject({
        model : this.groq(this.model),
        schema: CitationSchema,
        prompt,
      }).then(({ object }) => object),
      { maxRetries, baseDelay },
    );
  }

    //  Generates non-streamed text ( for query rewriting).
  
  async generateText(
    prompt: string
  ): Promise<string> {
    
    try {
      
      const { text } = await generateText({
        model : this.groq(this.model),
        prompt:prompt,
      });

      return text;
    } catch (err) {
      this.logger.error(`[LLM] generateText failed: ${(err as Error).message}`);
      throw err;
    }
  }

 
  private buildChatPrompt(params: StreamChatParams): string {
    const historyText = params.history
      .slice(-4)
      .map(m => `${m.role}: ${this.normalizeContent(m.content)}`)
      .join("\n");

    return `
SYSTEM:
${params.systemPrompt}

HISTORY:
${historyText}

USER:
${params.userMessage}
`;
  }


  
  private normalizeContent(content: unknown): string {
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text ?? '';
          return '';
        })
        .join('');
    }

    return '';
  }

  private async withRetry<T>(
    fn      : () => Promise<T>,
    options : { maxRetries: number; baseDelay: number },
    fallback: T = { citations: [] } as unknown as T,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as any)?.status ?? (err as any)?.statusCode;
        const code   = (err as any)?.cause?.code ?? (err as any)?.code ?? '';
        const name   = (err as any)?.name ?? '';

        if (status === 401 || status === 403 || status === 400) break;

        const retryable =
          status === 429 || status >= 500 ||
          ['ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(code) ||
          name === 'TypeValidationError' || name === 'JSONParseError';

        if (!retryable || attempt === options.maxRetries) break;

        const delay = status === 429
          ? (parseInt((err as any)?.headers?.['retry-after'] ?? '0', 10) * 1000) || options.baseDelay * attempt
          : options.baseDelay * Math.pow(2, attempt - 1);

        this.logger.warn(`[LLM] Attempt ${attempt}/${options.maxRetries} failed — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    this.logger.warn(`[LLM] All retries exhausted: ${lastErr}`);
    return fallback;
  }
}
