import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'

interface Citation {
  chunk: number
  source: string
  page: number | null
  excerpt: string
}

interface Conflict {
  chunk_a: number
  chunk_b: number
  description: string
}

interface Message {
  role: 'user' | 'assistant' | 'error'
  answer: string
  citations: Citation[]
  confidence: number
  conflicts: Conflict[]
}

interface ChatWindowProps {
  messages: Message[]
  isLoading: boolean
  question: string
  onQuestionChange: (q: string) => void
  onSubmit: () => void
  onStop: () => void
  scrollToIndex?: number | null
  onScrolled?: () => void
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 0.8) return <span className="px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] font-bold rounded-full uppercase">High Confidence</span>
  if (score >= 0.5) return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full uppercase">Medium Confidence</span>
  return <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full uppercase">Low Confidence</span>
}

export default function ChatWindow({ messages, isLoading, question, onQuestionChange, onSubmit, onStop, scrollToIndex, onScrolled }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)
  const msgRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)

  // Auto-scroll to bottom on every new message or when loading starts
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: initialScrollDone.current ? 'smooth' : 'instant' })
    initialScrollDone.current = true
  }, [messages, isLoading])

  // Scroll to a specific message when coming from Recent Analysis
  useEffect(() => {
    if (scrollToIndex == null) return
    const el = msgRefs.current[scrollToIndex]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedIndex(scrollToIndex)
      onScrolled?.()
      // Remove highlight after animation
      setTimeout(() => setHighlightedIndex(null), 2000)
    }
  }, [scrollToIndex, onScrolled])

  return (
    <div className="flex flex-col h-full">
      {/* Chat History */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-24 py-12 space-y-12">

        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center pt-32">
            <span className="material-symbols-outlined text-5xl text-slate-200 mb-4">auto_stories</span>
            <h2 className="text-xl font-black text-slate-300 uppercase tracking-tight" style={{ fontFamily: 'Manrope' }}>
              The Archive Awaits
            </h2>
            <p className="text-sm text-slate-400 mt-2">Upload a document and ask anything.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            ref={el => { msgRefs.current[i] = el }}
            className={`space-y-8 rounded-2xl transition-all duration-700 ${
              highlightedIndex === i ? 'ring-2 ring-blue-300 ring-offset-4 bg-blue-50/40' : ''
            }`}
          >

            {/* User Question */}
            {msg.role === 'user' && (
              <div className="flex flex-col items-end gap-2">
                <div className="max-w-2xl bg-white p-6 rounded-xl shadow-sm">
                  <p className="text-slate-800 text-lg leading-relaxed">{msg.answer}</p>
                </div>
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-300 px-2">User Query</span>
              </div>
            )}

            {/* Error Message */}
            {msg.role === 'error' && (
              <div className="flex items-start gap-4 bg-red-50 border border-red-200 rounded-xl p-5 max-w-3xl">
                <span className="material-symbols-outlined text-red-400 mt-0.5 shrink-0">error</span>
                <div>
                  <p className="text-xs font-bold text-red-700 uppercase tracking-tight mb-1">Model Error</p>
                  <p className="text-sm text-red-600 leading-relaxed">{msg.answer}</p>
                </div>
              </div>
            )}

            {/* AI Answer */}
            {msg.role === 'assistant' && (
              <div className="relative pl-8 max-w-4xl">
                {/* Accent bar */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-200 rounded-full" />
                <div className="space-y-6">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Analysis Result</h3>

                  {/* Answer text with markdown */}
                  <div className="space-y-3 text-slate-800 text-base leading-relaxed
                    [&_strong]:font-semibold [&_strong]:text-slate-900
                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
                    [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
                    [&_li]:text-slate-700 [&_li]:leading-relaxed
                    [&_p]:text-slate-700 [&_p]:leading-relaxed
                    [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:text-xl
                    [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:text-lg
                    [&_h3]:font-semibold [&_h3]:text-slate-800">
                    <Markdown>
                      {msg.answer
                        .replace(/Confidence Score:.*?[\)\.]?\s*/gi, '')
                        .replace(/Confidence:.*?\n/gi, '')
                        .replace(/Citations:[\s\S]*$/gi, '')
                        .replace(/\[CHUNK \d+\]/gi, '')
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '[$1]')
                        .replace(/"?\s*,\s*"citations[\s\S]*$/gi, '')
                        .replace(/\*\*\[/g, '[')
                        .replace(/\]\*\*/g, ']')
                        .trim()
                      }
                    </Markdown>
                  </div>

                  {/* Citation Cards */}
                  {msg.citations.length > 0 && (
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      {Object.values(
                        msg.citations.reduce((acc: Record<string, any>, citation) => {
                          if (!acc[citation.source]) {
                            acc[citation.source] = { ...citation, excerpts: [citation.excerpt] }
                          } else {
                            if (!acc[citation.source].excerpts.includes(citation.excerpt)) {
                              acc[citation.source].excerpts.push(citation.excerpt)
                            }
                          }
                          return acc
                        }, {})
                      ).map((citation: any, j) => (
                        <div key={j} className="bg-white p-5 rounded-xl shadow-sm flex flex-col gap-3 hover:scale-[1.01] transition-all">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight block">Source</span>
                              <span className="text-sm font-bold text-slate-800">{citation.source}</span>
                            </div>
                            <ConfidenceBadge score={msg.confidence} />
                          </div>
                          <div className="bg-slate-50 p-3 rounded-lg space-y-2">
                            {citation.excerpts.map((excerpt: string, k: number) => (
                              <p key={k} className="text-xs italic text-slate-500 leading-relaxed border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                                "{excerpt}"
                              </p>
                            ))}
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-[10px] font-medium text-slate-400">
                              {citation.page ? `Page ${citation.page}` : 'No page'}
                            </span>
                            <span className="material-symbols-outlined text-sky-500 text-sm">open_in_new</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conflict Banner */}
                  {msg.conflicts.length > 0 && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg flex items-center gap-4">
                      <span className="material-symbols-outlined text-red-500">warning</span>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-red-800 uppercase tracking-tight">Logical Conflict Detected</p>
                        {msg.conflicts.map((c, k) => (
                          <p key={k} className="text-xs text-red-700 mt-1">{c.description}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Thinking State */}
        {isLoading && (
          <div className="flex flex-col items-start gap-6 pt-8">
            <div className="flex items-center gap-4">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <div className="absolute inset-0 bg-slate-100 rounded-full animate-pulse" />
                <span className="material-symbols-outlined text-slate-400 animate-pulse">hourglass_empty</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-800 font-bold text-sm" style={{ fontFamily: 'Manrope' }}>Model is thinking...</span>
                <span className="text-sky-600 text-[11px] font-semibold flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-sky-500" />
                  Cross-referencing document chunks
                </span>
              </div>
            </div>
            {/* Skeleton */}
            <div className="w-full max-w-3xl space-y-3 pl-14 opacity-40">
              <div className="h-4 bg-slate-200 rounded-full w-3/4 animate-pulse" />
              <div className="h-4 bg-slate-200 rounded-full w-5/6 animate-pulse" />
              <div className="h-4 bg-slate-200 rounded-full w-2/3 animate-pulse" />
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <div className="p-6 px-24 pb-10">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm p-2 flex items-center gap-2 focus-within:ring-2 ring-blue-100 transition-all">
            <button className="p-3 text-slate-300 hover:text-slate-600 transition-colors">
              <span className="material-symbols-outlined">attach_file</span>
            </button>
            <input
              type="text"
              value={question}
              onChange={(e) => onQuestionChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && onSubmit()}
              placeholder="Ask the archivist about your documents..."
              className="flex-1 border-none focus:ring-0 bg-transparent text-sm py-3 placeholder:text-slate-300"
              disabled={isLoading}
            />

            {/* Stop button — shown while loading */}
            {isLoading ? (
              <button
                onClick={onStop}
                title="Stop generation"
                className="bg-red-500 text-white w-12 h-12 rounded-xl flex items-center justify-center hover:bg-red-600 transition-all active:scale-95 animate-pulse"
              >
                <span className="material-symbols-outlined text-lg">stop</span>
              </button>
            ) : (
              <button
                onClick={onSubmit}
                className="bg-black text-white w-12 h-12 rounded-xl flex items-center justify-center hover:opacity-80 transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">arrow_upward</span>
              </button>
            )}
          </div>
          <p className="text-center text-[10px] text-slate-300 mt-4">
            AI-driven analysis can contain inaccuracies. Verify critical data with source documents.
          </p>
        </div>
      </div>
    </div>
  )
}