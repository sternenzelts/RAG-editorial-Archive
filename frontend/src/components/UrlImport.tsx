import { useState } from 'react'

interface IngestedUrl {
  url: string
  status: 'completed' | 'ingesting' | 'error'
  chunks: number
}

interface UrlImportProps {
  onIngest: (source: string, chunks: number) => void
  onClose: () => void
}

export default function UrlImport({ onIngest, onClose }: UrlImportProps) {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [ingested, setIngested] = useState<IngestedUrl[]>([])

  const handleAdd = async () => {
    if (!url.trim()) return
    setIsLoading(true)

    const newEntry: IngestedUrl = { url, status: 'ingesting', chunks: 0 }
    setIngested(prev => [newEntry, ...prev])
    setUrl('')

    try {
      const formData = new FormData()
      formData.append('url', newEntry.url)

      const res = await fetch('http://localhost:8000/ingest/url', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      setIngested(prev => prev.map(item =>
        item.url === newEntry.url
          ? { ...item, status: 'completed', chunks: data.chunks_added }
          : item
      ))
      onIngest(newEntry.url, data.chunks_added)
    } catch (err) {
      setIngested(prev => prev.map(item =>
        item.url === newEntry.url ? { ...item, status: 'error' } : item
      ))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] flex items-center justify-center p-6 z-20">
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-8 pt-8 pb-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight" style={{ fontFamily: 'Manrope' }}>
                URL Import
              </h2>
              <p className="text-slate-500 text-sm mt-1">Feed the archivist new source material from the web.</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-slate-500">public</span>
            </div>
          </div>
        </div>
        <div className="p-8 space-y-8 overflow-y-auto flex-1">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Source Location
            </label>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-300">link</span>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="Paste any webpage link and ingest it"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border-none rounded-xl text-slate-800 placeholder:text-slate-300 focus:ring-2 focus:ring-blue-100 transition-all text-base"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={isLoading || !url.trim()}
                className="bg-black text-white px-6 py-4 rounded-xl font-bold text-sm hover:opacity-80 transition-all active:scale-95 disabled:opacity-40 shrink-0"
              >
                {isLoading ? 'Adding...' : 'Add to Memory'}
              </button>
            </div>
          </div>
          {ingested.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800" style={{ fontFamily: 'Manrope' }}>
                  Recently Ingested
                </h3>
                <span className="text-xs font-bold px-3 py-1 bg-sky-100 text-sky-700 rounded-full">
                  {ingested.length} Sources Analyzed
                </span>
              </div>
              <div className="space-y-3">
                {ingested.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-all">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-sm">
                        <span className="material-symbols-outlined text-slate-400 text-[20px]">article</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate" style={{ fontFamily: 'Manrope' }}>
                          {item.url}
                        </p>
                        {item.chunks > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">{item.chunks} chunks indexed</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 ml-4">
                      {item.status === 'completed' && (
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-sky-50 text-sky-700 rounded-full text-[10px] font-bold uppercase">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                          Completed
                        </span>
                      )}
                      {item.status === 'ingesting' && (
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-200 text-slate-500 rounded-full text-[10px] font-bold uppercase animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          Ingesting
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-500 rounded-full text-[10px] font-bold uppercase">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          Failed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ingested.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-symbols-outlined text-5xl text-slate-200 mb-4">public</span>
              <h3 className="text-lg font-bold text-slate-300 uppercase tracking-tight" style={{ fontFamily: 'Manrope' }}>
                No URLs Yet
              </h3>
              <p className="text-sm text-slate-400 mt-2">Paste a link above to get started.</p>
            </div>
          )}
        </div>
        <div className="px-8 py-5 bg-slate-50 flex items-center justify-between border-t border-slate-100">
          <p className="text-[11px] text-slate-400 max-w-sm">
            * The Digital Archivist only ingests public, scrape-accessible content for research purposes.
          </p>
          <button
            onClick={onClose}
            className="text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-2"
            style={{ fontFamily: 'Manrope' }}
          >
            Close Tool
            <span className="material-symbols-outlined text-sm">keyboard_return</span>
          </button>
        </div>
      </div>
    </div>
  )
}