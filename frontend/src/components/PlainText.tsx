import { useState } from 'react'

interface PlainTextProps {
  onIngest: (source: string, chunks: number) => void
  onClose: () => void
}

export default function PlainText({ onIngest, onClose }: PlainTextProps) {
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState<number | null>(null)

  const handleProcess = async () => {
    if (!text.trim()) return
    setIsLoading(true)
    setSuccess(null)

    try {
      const formData = new FormData()
      formData.append('text', text)
      formData.append('source', source || 'pasted text')

      const res = await fetch('http://localhost:8000/ingest/text', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      setSuccess(data.chunks_added)
      onIngest(source || 'pasted text', data.chunks_added)
      setText('')
      setSource('')
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
  const estimatedChunks = Math.ceil(wordCount / 500)

  return (
    <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] flex items-center justify-center p-6 z-20">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight" style={{ fontFamily: 'Manrope' }}>
                Plain Text Ingestion
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                Paste raw academic journals, transcriptions, or editorial notes for semantic analysis.
              </p>
            </div>
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-slate-500">notes</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1">
          <div className="grid grid-cols-12 gap-8">

            {/* Left — Input */}
            <div className="col-span-7 space-y-5">
              {/* Source name */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Custom Source Name
                </label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="e.g., Q3 Editorial Review - Vol. 14"
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-800 placeholder:text-slate-300 focus:ring-2 focus:ring-blue-100 transition-all text-sm"
                />
              </div>

              {/* Text area */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Raw Content
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your text here for processing..."
                  rows={14}
                  className="w-full bg-slate-50 border-none rounded-xl p-4 text-slate-800 placeholder:text-slate-300 focus:ring-2 focus:ring-blue-100 transition-all text-sm leading-relaxed resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">
                  {wordCount} words · ~{estimatedChunks} chunks
                </span>
                <button
                  onClick={handleProcess}
                  disabled={isLoading || !text.trim()}
                  className="bg-black text-white px-8 py-3 rounded-xl font-bold text-sm hover:opacity-80 transition-all active:scale-95 disabled:opacity-40 flex items-center gap-2"
                >
                  {isLoading ? 'Processing...' : 'Process Text'}
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                </button>
              </div>

              {/* Success message */}
              {success !== null && (
                <div className="bg-sky-50 border-l-4 border-sky-500 p-4 rounded-lg flex items-center gap-3">
                  <span className="material-symbols-outlined text-sky-500">check_circle</span>
                  <p className="text-sm font-semibold text-sky-700">
                    Successfully ingested — {success} chunks added to memory!
                  </p>
                </div>
              )}
            </div>

            {/* Right — Preview */}
            <div className="col-span-5 bg-slate-50 rounded-xl p-6 flex flex-col sticky top-0">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-blue-200 rounded-full" />
                  <h3 className="text-base font-bold tracking-tight text-slate-800" style={{ fontFamily: 'Manrope' }}>
                    Editorial Preview
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-3 py-1 rounded-full">
                  LIVE SIMULATION
                </span>
              </div>

              {text.trim() ? (
                <div className="space-y-3 flex-1">
                  {text.trim().split(/\s+/).slice(0, 500).join(' ').match(/.{1,200}/g)?.slice(0, 2).map((block, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border-l-4 border-blue-200 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          CHUNK {i + 1} / SEMANTIC BLOCK
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                          PREVIEW
                        </span>
                      </div>
                      <p className="text-xs italic text-slate-500 leading-relaxed">
                        "{block}..."
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl p-8">
                  <span className="material-symbols-outlined text-4xl text-slate-200 mb-3">pending</span>
                  <p className="text-sm font-medium text-slate-400 max-w-[180px]">
                    Enter text on the left to see structural analysis
                  </p>
                </div>
              )}

              {/* Meta */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Estimated Tokens
                  </div>
                  <div className="text-lg font-black text-slate-800" style={{ fontFamily: 'Manrope' }}>
                    {Math.round(wordCount * 1.3)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Target Clusters
                  </div>
                  <div className="text-lg font-black text-slate-800" style={{ fontFamily: 'Manrope' }}>
                    {wordCount > 0 ? estimatedChunks : 'Auto'}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 bg-slate-50 flex items-center justify-between border-t border-slate-100">
          <p className="text-[11px] text-slate-400 max-w-sm">
            * Text is chunked into semantic blocks for efficient retrieval and analysis.
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