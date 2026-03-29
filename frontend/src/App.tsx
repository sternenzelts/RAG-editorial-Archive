import { useState, useRef, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ChatWindow from './components/ChatWindow'
import UrlImport from './components/UrlImport'
import PlainText from './components/PlainText'
import RecentAnalysis from './components/RecentAnalysis'
import Archive from './components/Archive'
import Workspace from './components/Workspace'

interface Message {
  role: 'user' | 'assistant'
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
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleSubmit = async () => {
    if (!question.trim()) return

    const userMsg: Message = { role: 'user', answer: question, citations: [], confidence: 0, conflicts: [] }
    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setIsLoading(true)

    try {
      const res = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()

      let answer = data.answer
      let citations = data.citations
      let confidence = data.confidence
      let conflicts = data.conflicts

      if (typeof answer === 'string') {
        const jsonMatch = answer.match(/\{[\s\S]*"answer"[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0])
            answer = parsed.answer ?? answer
            citations = parsed.citations ?? citations
            confidence = parsed.confidence ?? confidence
            conflicts = parsed.conflicts ?? conflicts
          } catch {
            // not valid JSON, use as-is
          }
        }
      }

      const assistantMsg: Message = {
        role: 'assistant',
        answer,
        citations,
        confidence,
        conflicts,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      console.error(err)
    } finally {
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
            <RecentAnalysis messages={messages} />
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