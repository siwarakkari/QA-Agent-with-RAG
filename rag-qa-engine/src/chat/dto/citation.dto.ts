// src/chat/dto/citation.dto.ts
import { z } from 'zod';

export const CitationSchema = z.object({
  citations: z.array(
    z.object({
      id         : z.number().int().positive(),
      sourceTitle: z.string(),
      excerpt    : z.string().max(200),
    }),
  ),
});

export type CitationDto = z.infer<typeof CitationSchema>;