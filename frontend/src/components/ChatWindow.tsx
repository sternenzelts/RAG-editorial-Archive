import { useEffect, useRef, useState, useCallback } from 'react'
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
  timestamp?: number
  streaming?: boolean
}

interface ChatWindowProps {
  messages: Message[]
  isLoading: boolean
  question: string
  sources: string[]
  darkMode: boolean
  onQuestionChange: (q: string) => void
  onSubmit: () => void
  onStop: () => void
  scrollToIndex?: number | null
  onScrolled?: () => void
}

// ── Confidence Bar ─────────────────────────────────────────────────────────────
function ConfidenceBar({ score, darkMode }: { score: number; darkMode: boolean }) {
  const pct = Math.round(score * 100)
  const color =
    score >= 0.8
      ? 'bg-emerald-500'
      : score >= 0.5
      ? 'bg-amber-400'
      : 'bg-rose-400'
  const label =
    score >= 0.8 ? 'High Confidence' : score >= 0.5 ? 'Medium Confidence' : 'Low Confidence'

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className={`flex-1 h-1.5 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${
        score >= 0.8
          ? 'text-emerald-500'
          : score >= 0.5
          ? 'text-amber-500'
          : 'text-rose-400'
      }`}>
        {label}
      </span>
    </div>
  )
}

// ── Suggestion Chips ───────────────────────────────────────────────────────────
function SuggestionChips({
  sources,
  darkMode,
  onSelect,
}: {
  sources: string[]
  darkMode: boolean
  onSelect: (q: string) => void
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    if (!sources.length) return
    fetch('http://localhost:8000/suggest')
      .then(r => r.json())
      .then(data => setSuggestions(data.suggestions ?? []))
      .catch(() => {})
  }, [sources])

  if (!suggestions.length) return null

  return (
    <div className="flex flex-col items-center gap-3 mt-6 mb-2">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
        Try asking…
      </span>
      <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
        {suggestions.map((q, i) => (
          <button
            key={i}
            onClick={() => onSelect(q)}
            className={`px-4 py-2 rounded-full text-xs font-medium border transition-all hover:scale-[1.03] active:scale-95
              ${darkMode
                ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:border-slate-500'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm'
              }`}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ChatWindow ────────────────────────────────────────────────────────────
export default function ChatWindow({
  messages,
  isLoading,
  question,
  sources,
  darkMode,
  onQuestionChange,
  onSubmit,
  onStop,
  scrollToIndex,
  onScrolled,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)
  const msgRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

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
      setTimeout(() => setHighlightedIndex(null), 2000)
    }
  }, [scrollToIndex, onScrolled])

  const dm = darkMode

  return (
    <div className={`flex flex-col h-full ${dm ? 'bg-slate-900' : 'bg-slate-50'}`}>
      {/* Chat History */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 md:px-24 py-12 space-y-12">

        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center pt-20">
            <span className={`material-symbols-outlined text-5xl mb-4 ${dm ? 'text-slate-700' : 'text-slate-200'}`}>
              auto_stories
            </span>
            <h2 className={`text-xl font-black uppercase tracking-tight ${dm ? 'text-slate-600' : 'text-slate-300'}`}
              style={{ fontFamily: 'Manrope' }}>
              The Archive Awaits
            </h2>
            <p className={`text-sm mt-2 ${dm ? 'text-slate-500' : 'text-slate-400'}`}>
              Upload a document and ask anything.
            </p>
            {sources.length > 0 && (
              <SuggestionChips
                sources={sources}
                darkMode={dm}
                onSelect={onQuestionChange}
              />
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            ref={el => { msgRefs.current[i] = el }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            className={`space-y-8 rounded-2xl transition-all duration-700 ${
              highlightedIndex === i
                ? dm
                  ? 'ring-2 ring-blue-800 ring-offset-4 ring-offset-slate-900 bg-blue-950/30'
                  : 'ring-2 ring-blue-300 ring-offset-4 bg-blue-50/40'
                : ''
            }`}
          >

            {/* User Question */}
            {msg.role === 'user' && (
              <div className="flex flex-col items-end gap-2">
                <div className={`max-w-2xl p-6 rounded-xl shadow-sm ${dm ? 'bg-slate-800' : 'bg-white'}`}>
                  <p className={`text-lg leading-relaxed ${dm ? 'text-slate-100' : 'text-slate-800'}`}>{msg.answer}</p>
                </div>
                <div className="flex items-center gap-2">
                  {hoveredIndex === i && msg.timestamp && (
                    <span className={`text-[10px] ${dm ? 'text-slate-600' : 'text-slate-300'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold tracking-widest uppercase px-2 ${dm ? 'text-slate-600' : 'text-slate-300'}`}>
                    User Query
                  </span>
                </div>
              </div>
            )}

            {/* Error Message */}
            {msg.role === 'error' && (
              <div className={`flex items-start gap-4 border rounded-xl p-5 max-w-3xl ${
                dm ? 'bg-red-950/40 border-red-900' : 'bg-red-50 border-red-200'
              }`}>
                <span className="material-symbols-outlined text-red-400 mt-0.5 shrink-0">error</span>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-tight mb-1 ${dm ? 'text-red-400' : 'text-red-700'}`}>
                    Model Error
                  </p>
                  <p className={`text-sm leading-relaxed ${dm ? 'text-red-300' : 'text-red-600'}`}>{msg.answer}</p>
                </div>
              </div>
            )}

            {/* AI Answer */}
            {msg.role === 'assistant' && (
              <div className="relative pl-8 max-w-4xl">
                {/* Accent bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full ${
                  dm ? 'bg-blue-800' : 'bg-blue-200'
                }`} />
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-xs font-bold uppercase tracking-widest ${dm ? 'text-slate-500' : 'text-slate-400'}`}>
                      Analysis Result
                    </h3>
                    <div className="flex items-center gap-3">
                      {hoveredIndex === i && msg.timestamp && (
                        <span className={`text-[10px] ${dm ? 'text-slate-600' : 'text-slate-400'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {!msg.streaming && (
                        <ConfidenceBar score={msg.confidence} darkMode={dm} />
                      )}
                    </div>
                  </div>

                  {/* Answer text */}
                  <div className={`space-y-3 text-base leading-relaxed
                    [&_strong]:font-semibold
                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
                    [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
                    [&_p]:leading-relaxed
                    [&_h1]:font-bold [&_h1]:text-xl
                    [&_h2]:font-bold [&_h2]:text-lg
                    [&_h3]:font-semibold
                    ${dm
                      ? '[&_strong]:text-slate-200 [&_li]:text-slate-300 [&_p]:text-slate-300 [&_h1]:text-slate-100 [&_h2]:text-slate-100 [&_h3]:text-slate-200 text-slate-300'
                      : '[&_strong]:text-slate-900 [&_li]:text-slate-700 [&_p]:text-slate-700 [&_h1]:text-slate-900 [&_h2]:text-slate-900 [&_h3]:text-slate-800 text-slate-800'
                    }`}>
                    <Markdown>
                      {(msg.streaming ? msg.answer : msg.answer
                        .replace(/Confidence Score:.*?[\)\.]?\s*/gi, '')
                        .replace(/Confidence:.*?\n/gi, '')
                        .replace(/Citations:[\s\S]*$/gi, '')
                        .replace(/\[CHUNK \d+\]/gi, '')
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '[$1]')
                        .replace(/"?\s*,\s*"citations[\s\S]*$/gi, '')
                        .replace(/\*\*\[/g, '[')
                        .replace(/\]\*\*/g, ']')
                        .trim()
                      ) + (msg.streaming ? '▍' : '')}
                    </Markdown>
                  </div>

                  {/* Citation Cards — only after streaming finishes */}
                  {!msg.streaming && msg.citations.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
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
                        <div key={j} className={`p-5 rounded-xl flex flex-col gap-3 hover:scale-[1.01] transition-all border ${
                          dm
                            ? 'bg-slate-800 border-slate-700 shadow-slate-900/50 shadow-md'
                            : 'bg-white border-transparent shadow-sm'
                        }`}>
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <span className={`text-[10px] font-bold uppercase tracking-tight block ${dm ? 'text-slate-500' : 'text-slate-400'}`}>Source</span>
                              <span className={`text-sm font-bold ${dm ? 'text-slate-200' : 'text-slate-800'}`}>{citation.source}</span>
                            </div>
                          </div>
                          <div className={`p-3 rounded-lg space-y-2 ${dm ? 'bg-slate-900/60' : 'bg-slate-50'}`}>
                            {citation.excerpts.map((excerpt: string, k: number) => (
                              <p key={k} className={`text-xs italic leading-relaxed border-b last:border-0 pb-2 last:pb-0 ${
                                dm ? 'text-slate-400 border-slate-700' : 'text-slate-500 border-slate-100'
                              }`}>
                                "{excerpt}"
                              </p>
                            ))}
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className={`text-[10px] font-medium ${dm ? 'text-slate-500' : 'text-slate-400'}`}>
                              {citation.page ? `Page ${citation.page}` : 'No page'}
                            </span>
                            <span className="material-symbols-outlined text-sky-500 text-sm">open_in_new</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conflict Banner */}
                  {!msg.streaming && msg.conflicts.length > 0 && (
                    <div className={`border-l-4 border-red-500 p-4 rounded-lg flex items-center gap-4 ${
                      dm ? 'bg-red-950/30' : 'bg-red-50'
                    }`}>
                      <span className="material-symbols-outlined text-red-500">warning</span>
                      <div className="flex-1">
                        <p className={`text-xs font-bold uppercase tracking-tight ${dm ? 'text-red-400' : 'text-red-800'}`}>
                          Logical Conflict Detected
                        </p>
                        {msg.conflicts.map((c, k) => (
                          <p key={k} className={`text-xs mt-1 ${dm ? 'text-red-300' : 'text-red-700'}`}>{c.description}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Skeleton while loading but no streaming yet */}
        {isLoading && !messages.some(m => m.streaming) && (
          <div className="flex flex-col items-start gap-6 pt-8">
            <div className="flex items-center gap-4">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <div className={`absolute inset-0 rounded-full animate-pulse ${dm ? 'bg-slate-700' : 'bg-slate-100'}`} />
                <span className={`material-symbols-outlined animate-pulse ${dm ? 'text-slate-500' : 'text-slate-400'}`}>
                  hourglass_empty
                </span>
              </div>
              <div className="flex flex-col">
                <span className={`font-bold text-sm ${dm ? 'text-slate-300' : 'text-slate-800'}`} style={{ fontFamily: 'Manrope' }}>
                  Model is thinking…
                </span>
                <span className={`text-[11px] font-semibold flex items-center gap-1 ${dm ? 'text-sky-500' : 'text-sky-600'}`}>
                  <span className="w-1 h-1 rounded-full bg-sky-500" />
                  Cross-referencing document chunks
                </span>
              </div>
            </div>
            <div className="w-full max-w-3xl space-y-3 pl-14 opacity-40">
              <div className={`h-4 rounded-full w-3/4 animate-pulse ${dm ? 'bg-slate-700' : 'bg-slate-200'}`} />
              <div className={`h-4 rounded-full w-5/6 animate-pulse ${dm ? 'bg-slate-700' : 'bg-slate-200'}`} />
              <div className={`h-4 rounded-full w-2/3 animate-pulse ${dm ? 'bg-slate-700' : 'bg-slate-200'}`} />
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <div className={`p-6 px-6 md:px-24 pb-10 border-t ${dm ? 'border-slate-800' : 'border-slate-100'}`}>
        <div className="max-w-4xl mx-auto">
          <div className={`rounded-xl p-2 flex items-center gap-2 transition-all focus-within:ring-2 ring-blue-400/30 ${
            dm
              ? 'bg-slate-800 shadow-slate-900/50 shadow-lg'
              : 'bg-white shadow-sm'
          }`}>
            <button className={`p-3 transition-colors ${dm ? 'text-slate-600 hover:text-slate-400' : 'text-slate-300 hover:text-slate-600'}`}>
              <span className="material-symbols-outlined">attach_file</span>
            </button>
            <input
              type="text"
              value={question}
              onChange={(e) => onQuestionChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && onSubmit()}
              placeholder="Ask the archivist about your documents…"
              className={`flex-1 border-none focus:ring-0 bg-transparent text-sm py-3 ${
                dm
                  ? 'text-slate-200 placeholder:text-slate-600'
                  : 'text-slate-800 placeholder:text-slate-300'
              }`}
              disabled={isLoading}
            />

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
          <p className={`text-center text-[10px] mt-4 ${dm ? 'text-slate-700' : 'text-slate-300'}`}>
            AI-driven analysis can contain inaccuracies. Verify critical data with source documents.
          </p>
        </div>
      </div>
    </div>
  )
}