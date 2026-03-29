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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('rag_messages', JSON.stringify(messages))
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
      // Use the server-sanitized filename so sidebar matches what's stored
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

  const unwrapAnswer = useCallback((ans: string, cit: any[], conf: number, con: any[]): [string, any[], number, any[]] => {
    if (typeof ans !== 'string') return [ans, cit, conf, con]
    const trimmed = ans.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.answer === 'string') {
          return unwrapAnswer(parsed.answer, parsed.citations ?? cit, parsed.confidence ?? conf, parsed.conflicts ?? con)
        }
      } catch { /* not JSON */ }
    }
    const jsonMatch = trimmed.match(/\{[\s\S]*"answer"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed && typeof parsed.answer === 'string') {
          return unwrapAnswer(parsed.answer, parsed.citations ?? cit, parsed.confidence ?? conf, parsed.conflicts ?? con)
        }
      } catch { /* not valid JSON */ }
    }
    const trailingJson = ans.match(/^([\s\S]*?)"\s*,\s*"(?:citations|confidence|conflicts)/)
    if (trailingJson) return [trailingJson[1].replace(/^"/, '').trim(), cit, conf, con]
    return [ans, cit, conf, con]
  }, [])

  const pushError = useCallback((message: string) => {
    const errMsg: Message = { role: 'error', answer: message, citations: [], confidence: 0, conflicts: [] }
    setMessages(prev => [...prev, errMsg])
  }, [])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
  }, [])

  const handleSubmit = async () => {
    if (!question.trim() || isLoading) return

    const userMsg: Message = { role: 'user', answer: question, citations: [], confidence: 0, conflicts: [] }
    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setIsLoading(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const detail = errBody?.detail ?? ''
        if (detail.toLowerCase().includes('out of memory') || detail.toLowerCase().includes('oom')) {
          pushError('⚠️ Out of memory — the model ran out of RAM. Try closing other apps or switching to a smaller model.')
        } else if (res.status === 404 || detail.toLowerCase().includes('model')) {
          pushError('⚠️ Model not found — make sure you\'ve pulled the model first: ollama pull qwen3.5:4b')
        } else {
          pushError(`⚠️ Server error (${res.status}): ${detail || 'Unknown error from backend.'}`)
        }
        return
      }

      const data = await res.json()
      let answer = data.answer
      let citations = data.citations
      let confidence = data.confidence
      let conflicts = data.conflicts

      ;[answer, citations, confidence, conflicts] = unwrapAnswer(answer, citations, confidence, conflicts)

      const assistantMsg: Message = { role: 'assistant', answer, citations, confidence, conflicts }
      setMessages(prev => [...prev, assistantMsg])

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User stopped — don't show error
        return
      }
      if (err instanceof TypeError && err.message.includes('fetch')) {
        pushError('⚠️ Cannot connect to the model server — make sure the backend is running on port 8000.')
      } else {
        pushError('⚠️ Unexpected error: ' + (err?.message ?? String(err)))
      }
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  const handleClearAll = async () => {
    await fetch('http://localhost:8000/clear', { method: 'DELETE' })
    setSources([])
    setChunksLoaded(0)
    setMessages([])
    localStorage.removeItem('rag_messages')
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
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
        onClearAll={handleClearAll}
        onUploadClick={() => fileInputRef.current?.click()}
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
          {activeTab === 'workspace' && (
            <Workspace onUploadClick={() => fileInputRef.current?.click()} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App