import { useState, useRef, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ChatWindow from './components/ChatWindow'
import UrlImport from './components/UrlImport'
import PlainText from './components/PlainText'
import RecentAnalysis from './components/RecentAnalysis'
import Archive from './components/Archive'
import Workspace from './components/Workspace'

interface Message {
  role: 'user' | 'assistant' | 'error'
  answer: string
  citations: any[]
  confidence: number
  conflicts: any[]
  timestamp?: number
  streaming?: boolean
}

function App() {
  const [activeTab, setActiveTab] = useState('documents')
  const [sources, setSources] = useState<string[]>([])
  const [chunksLoaded, setChunksLoaded] = useState(0)
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('rag_messages')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [question, setQuestion] = useState('')
  const [scrollToIndex, setScrollToIndex] = useState<number | null>(null)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('rag_dark_mode') === 'true'
    } catch {
      return false
    }
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Apply / remove dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    try {
      localStorage.setItem('rag_dark_mode', String(darkMode))
    } catch {}
  }, [darkMode])

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    // Don't persist mid-stream messages
    const toSave = messages.filter(m => !m.streaming)
    try {
      localStorage.setItem('rag_messages', JSON.stringify(toSave))
    } catch {
      // ignore storage errors
    }
  }, [messages])

  useEffect(() => {
    fetch('http://localhost:8000/status')
      .then(res => res.json())
      .then(data => {
        setSources(data.sources)
        setChunksLoaded(data.chunks_stored)
      })
      .catch(err => console.error(err))
  }, [])

  const handleUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('http://localhost:8000/ingest/pdf', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      setSources(prev => [...prev, data.filename ?? file.name])
      setChunksLoaded(prev => prev + data.chunks_added)
    } catch (err) {
      console.error(err)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  const pushError = useCallback((message: string) => {
    const errMsg: Message = {
      role: 'error',
      answer: message,
      citations: [],
      confidence: 0,
      conflicts: [],
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, errMsg])
  }, [])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
    // Finalise any streaming message
    setMessages(prev =>
      prev.map(m => m.streaming ? { ...m, streaming: false } : m)
    )
  }, [])

  // ── Streaming submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!question.trim() || isLoading) return

    const userMsg: Message = {
      role: 'user',
      answer: question,
      citations: [],
      confidence: 0,
      conflicts: [],
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setIsLoading(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    // Placeholder streaming assistant message
    const streamingMsg: Message = {
      role: 'assistant',
      answer: '',
      citations: [],
      confidence: 0,
      conflicts: [],
      timestamp: Date.now(),
      streaming: true,
    }
    setMessages(prev => [...prev, streamingMsg])

    try {
      const res = await fetch('http://localhost:8000/query/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const detail = errBody?.detail ?? ''
        setMessages(prev => prev.filter(m => !m.streaming))
        if (detail.toLowerCase().includes('out of memory') || detail.toLowerCase().includes('oom')) {
          pushError('⚠️ Out of memory — the model ran out of RAM. Try closing other apps or switching to a smaller model.')
        } else if (res.status === 404 || detail.toLowerCase().includes('model')) {
          pushError("⚠️ Model not found — make sure you've pulled the model first: ollama pull qwen3.5:4b")
        } else {
          pushError(`⚠️ Server error (${res.status}): ${detail || 'Unknown error from backend.'}`)
        }
        return
      }

      // Consume the SSE stream
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const updateStreamingMessage = (updater: (prev: string) => string) => {
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.streaming)
          if (idx === -1) return prev
          const updated = [...prev]
          updated[idx] = { ...updated[idx], answer: updater(updated[idx].answer) }
          return updated
        })
      }

      const finaliseStreamingMessage = (data: any) => {
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.streaming)
          if (idx === -1) return prev
          const updated = [...prev]
          updated[idx] = {
            ...updated[idx],
            answer: data.answer || updated[idx].answer,
            citations: data.citations ?? [],
            confidence: data.confidence ?? 0,
            conflicts: data.conflicts ?? [],
            streaming: false,
          }
          return updated
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: done')) continue
          if (line.startsWith('event: end_tokens')) continue
          if (line.startsWith('event: error')) continue

          if (line.startsWith('data: ')) {
            const raw = line.slice(6)

            // Check if this is the done event payload (JSON with answer/citations)
            if (raw.startsWith('{')) {
              try {
                const parsed = JSON.parse(raw)
                if ('citations' in parsed || 'answer' in parsed) {
                  finaliseStreamingMessage(parsed)
                  continue
                }
              } catch {}
            }

            // Regular token — unescape newlines we escaped on the server
            const token = raw.replace(/\\n/g, '\n')
            if (token) {
              updateStreamingMessage(prev => prev + token)
            }
          }

          // Handle named events in the NEXT data line by checking prev line context
          // (SSE named events come as "event: X\ndata: Y")
        }
      }

      // Handle the done event which may be buffered separately
      if (buffer.includes('event: done')) {
        const dataMatch = buffer.match(/event: done\ndata: (.+)/)
        if (dataMatch) {
          try {
            finaliseStreamingMessage(JSON.parse(dataMatch[1]))
          } catch {}
        }
      }

    } catch (err: any) {
      setMessages(prev => prev.filter(m => !m.streaming))
      if (err?.name === 'AbortError') return
      if (err instanceof TypeError && err.message.includes('fetch')) {
        pushError('⚠️ Cannot connect to the model server — make sure the backend is running on port 8000.')
      } else {
        pushError('⚠️ Unexpected error: ' + (err?.message ?? String(err)))
      }
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
      // Safety: ensure no stuck streaming message
      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
    }
  }

  const handleClearAll = async () => {
    await fetch('http://localhost:8000/clear', { method: 'DELETE' })
    setSources([])
    setChunksLoaded(0)
    setMessages([])
    localStorage.removeItem('rag_messages')
  }

  const dm = darkMode

  return (
    <div className={`flex min-h-screen ${dm ? 'bg-slate-950' : 'bg-slate-50'}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sources={sources}
        darkMode={darkMode}
        onClearAll={handleClearAll}
        onUploadClick={() => fileInputRef.current?.click()}
        onToggleDarkMode={() => setDarkMode(d => !d)}
      />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <TopBar
          activeTab={activeTab}
          chunksLoaded={chunksLoaded}
          onTabChange={setActiveTab}
        />
        <main className="flex-1 overflow-hidden relative">
          {activeTab === 'documents' && (
            <ChatWindow
              messages={messages}
              isLoading={isLoading}
              question={question}
              sources={sources}
              darkMode={darkMode}
              onQuestionChange={setQuestion}
              onSubmit={handleSubmit}
              onStop={handleStop}
              scrollToIndex={scrollToIndex}
              onScrolled={() => setScrollToIndex(null)}
            />
          )}
          {activeTab === 'archive' && (
            <Archive
              onUploadClick={() => fileInputRef.current?.click()}
              onDelete={(source) => setSources(prev => prev.filter(s => s !== source))}
            />
          )}
          {activeTab === 'url' && (
            <div className="relative flex-1 h-full">
              <UrlImport
                onIngest={(source, chunks) => {
                  setSources(prev => [...prev, source])
                  setChunksLoaded(prev => prev + chunks)
                }}
                onClose={() => setActiveTab('documents')}
              />
            </div>
          )}
          {activeTab === 'plaintext' && (
            <div className="relative flex-1 h-full">
              <PlainText
                onIngest={(source, chunks) => {
                  setSources(prev => [...prev, source])
                  setChunksLoaded(prev => prev + chunks)
                }}
                onClose={() => setActiveTab('documents')}
              />
            </div>
          )}
          {activeTab === 'recent' && (
            <RecentAnalysis
              messages={messages}
              onOpenInChat={(msgIndex) => {
                setScrollToIndex(msgIndex)
                setActiveTab('documents')
              }}
            />
          )}
          {/* Workspace stays mounted (hidden when not active) so synthesis
              fetches survive tab switches */}
          <div style={{ display: activeTab === 'workspace' ? 'contents' : 'none' }}>
            <Workspace onUploadClick={() => fileInputRef.current?.click()} />
          </div>
        </main>
      </div>
    </div>
  )
}

export default App