'use client';

import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Citation {
  id         : number;
  sourceTitle: string;
  excerpt    : string;
}



// ── Helpers ───────────────────────────────────────────────────────────────────

// Render inline [N] citation markers as superscript spans
function renderWithCitations(text: string) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      return (
        <sup key={i} className="ml-1.5 text-black font-mono text-xs cursor-pointer hover:text-indigo-300">
          [{match[1]}]
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Citation Panel ─────────────────────────────────────────────────────────────

function CitationPanel({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <p className="text-xl font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
        Sources
      </p>
      <div className="space-y-2">
        {citations.map(c => (
          <div key={c.id} className="flex gap-2 text-xs">
            <span className="text-indigo-400 font-mono shrink-0">[{c.id}]</span>
            <div>
              <span className="text-[var(--text)] font-medium">{c.sourceTitle}</span>
              <p className="text-[var(--muted)] mt-0.5 leading-relaxed line-clamp-2">
                {c.excerpt}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * Extracts text from a stream of JSON chunks or returns the raw string if already parsed.
 * This handles the 'data: {"type":"text-delta","delta":"..."}' format.
 */
function parseStreamContent(rawContent: string, isUser: boolean): string {
  if (isUser) return rawContent;

  // If the content looks like raw stream data
  if (rawContent.includes('data: {')) {
    const lines = rawContent.split('\n');
    let fullText = '';

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try {
          const jsonStr = trimmed.replace('data:', '').trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'text-delta' && parsed.delta) {
            fullText += parsed.delta;
          }
        } catch (e) {
          // Ignore partial or malformed JSON during streaming
        }
      }
    });
    return fullText;
  }

  return rawContent;
}
// ── Message Bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  role,
  content,
  citations,
  isStreaming,
}: {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  isStreaming?: boolean;
}) {
  const isUser = role === 'user';
  
  // Clean the content before rendering
  const displayContent = parseStreamContent(content, isUser);

  // If we are currently parsing a stream and haven't gotten text yet, 
  // don't show the empty/raw container
  if (!isUser && !displayContent && isStreaming) {
     return (
        <div className="flex justify-start mb-4">
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mr-2 mt-0.5">AI</div>
          <div className="bg-[var(--surface)] px-4 py-3 rounded-2xl rounded-tl-sm border border-[var(--border)]">
            <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse align-text-bottom rounded-sm" />
          </div>
        </div>
     );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mr-2 mt-0.5">
          AI
        </div>
      )}
      
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-indigo-600 text-white rounded-tr-sm'
            : 'bg-[var(--surface)] text-[var(--text)] rounded-tl-sm border border-[var(--border)]'
        }`}
      >
        <div className="whitespace-pre-wrap">
          {isUser ? displayContent : renderWithCitations(displayContent)}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-1 animate-pulse align-text-bottom rounded-sm" />
          )}
        </div>
        
        {!isUser && citations && citations.length > 0 && (
          <CitationPanel citations={citations} />
        )}
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold shrink-0 ml-2 mt-0.5">
          U
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    setMounted(true);
    setSessionId(`session-${Date.now()}`);
  }, []);

  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);

  // Map: messageId → citations extracted from data-citations chunks
  const [citationsMap, setCitationsMap] = useState<Record<string, Citation[]>>({});
  console.log('Response received:');


 
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    data,
  } = useChat({
    api: 'http://localhost:3002/chat',
    streamProtocol: 'text',
    body: {
      sessionId,
    },
    onResponse: (response) => {
      console.log('Response received:', response.status, response.statusText);
    },
    onError: (err) => {
      console.error('Chat error details:', err);
    },
  });

  // Process data chunks (citations) when the 'data' array updates
useEffect(() => {
  // Find the last assistant message
  const lastAssistant = messages.findLast((m) => m.role === 'assistant');
  if (!lastAssistant || !lastAssistant.content) return;

  // Look for the citations JSON inside the message content
  // We use a regex to find the specific "data-citations" type
  const citationMatch = lastAssistant.content.match(/data:\s*({.*"type":"data-citations".*})/);

  if (citationMatch && citationMatch[1]) {
    try {
      const parsed = JSON.parse(citationMatch[1]);
      const citations = parsed.data?.citations;

      if (citations && Array.isArray(citations)) {
        // Only update if the citations for this message haven't been stored yet
        // or if the count has changed (to avoid infinite re-renders)
        setCitationsMap((prev) => {
          const existing = prev[lastAssistant.id];
          if (JSON.stringify(existing) === JSON.stringify(citations)) {
            return prev;
          }
          return {
            ...prev,
            [lastAssistant.id]: citations,
          };
        });
      }
    } catch (e) {
      console.error("Failed to parse citations from stream:", e);
    }
  }
}, [messages]); 

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">

      {/* Header */}
      <header className="shrink-0 border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
          <span className="text-white text-sm font-bold">W</span>
        </div>
        <div>
          <h1 className="font-semibold text-[var(--text)]">WWII Knowledge Base</h1>
          <p className="text-xs text-[var(--muted)]">
            RAG-powered historian · Session: {mounted ? sessionId.slice(-8) : '...'}
          </p>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto chat-scroll px-4 py-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-2xl">
              📚
            </div>
            <p className="text-[var(--muted)] text-sm max-w-xs">
              Ask anything about World War II — battles, leaders, operations, events.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {['What caused WWII?','Tell me about D-Day','Who was Erwin Rommel?'].map(q => (
                <button
                  key={q}
                  onClick={() => {
                    handleInputChange({ target: { value: q } } as any);
                    setTimeout(() => inputRef.current?.form?.requestSubmit(), 100);
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-indigo-500 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isLast      = idx === messages.length - 1;
          const isStreaming  = isLoading && isLast && msg.role === 'assistant';
          const citations    = citationsMap[msg.id];

          return (
            <MessageBubble
              key={msg.id}
              role={msg.role as 'user' | 'assistant'}
              content={msg.content}
              citations={msg.role === 'assistant' ? (citations ?? []) : undefined}
              isStreaming={isStreaming}
            />
          );
        })}

        {error && (
          <div className="mx-auto max-w-sm bg-red-900/30 border border-red-800 text-red-300 text-xs rounded-xl px-4 py-3 text-center">
            Error: {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <footer className="shrink-0 border-t border-[var(--border)] px-4 py-4">
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 items-end bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3 focus-within:border-indigo-500 transition-colors"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about World War II…"
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--muted)] outline-none resize-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="shrink-0 w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            {isLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </form>
        <p className="text-center text-[10px] text-[var(--muted)] mt-2">
          Answers grounded in Wikipedia WWII corpus · Citations shown inline
        </p>
      </footer>
    </div>
  );
}
