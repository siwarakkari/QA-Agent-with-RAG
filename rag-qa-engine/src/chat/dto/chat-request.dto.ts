// src/chat/dto/chat-request.dto.ts
// import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

// export class ChatRequestDto {
//   @IsString()
//   @IsNotEmpty()
//   @MaxLength(2000)
//   message!: string;

//   @IsString()
//   @IsOptional()
//   sessionId?: string;

//   @IsString()
//   @IsOptional()
//   collectionName?: string;

//   @IsString()
//   @IsOptional()
//   userName?: string;
// }

// src/chat/dto/chat-request.dto.ts
export class ChatRequest {
  messages: { role: string; content: string }[];
  sessionId: string;
  userName?: string;
  collectionName?: string;
}

// import { z } from 'zod';

// export const ChatRequestSchema = z.object({
//   messages: z.array(
//     z.object({
//       role: z.string(),
//       content: z.string().optional().default(''),
//       parts: z.array(z.any()).optional(),
//     }).passthrough() // Allow other SDK fields like 'id', 'annotations', etc.
//   ).min(1),

//   sessionId: z.string(),
//   userName: z.string().optional(),
//   collectionName: z.string().optional(),
// });

// export type ChatRequest = z.infer<typeof ChatRequestSchema>;