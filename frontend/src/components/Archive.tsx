import { useState, useEffect } from 'react'

interface Document {
  source: string
  chunks: number
  pages: number
  type: 'pdf' | 'url' | 'text'
}

interface ArchiveProps {
  onUploadClick: () => void
  onDelete?: (source: string) => void
}

export default function Archive({ onUploadClick, onDelete }: ArchiveProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [filter, setFilter] = useState<'all' | 'pdf' | 'url' | 'text'>('all')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    fetch('http://localhost:8000/status')
      .then(res => res.json())
      .then(data => setDocuments(data.documents ?? []))
      .catch(err => console.error(err))
  }, [])

  const filtered = documents
    .filter(d => filter === 'all' || d.type === filter)
    .filter(d => d.source.toLowerCase().includes(search.toLowerCase()))

  const pdfCount = documents.filter(d => d.type === 'pdf').length
  const urlCount = documents.filter(d => d.type === 'url').length
  const textCount = documents.filter(d => d.type === 'text').length
  const totalChunks = documents.reduce((sum, d) => sum + d.chunks, 0)

  async function handleDelete(source: string) {
    setDeleting(source)
    try {
      const res = await fetch(
        `http://localhost:8000/ingest/source?source=${encodeURIComponent(source)}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.source !== source))
        onDelete?.(source)  // notify sidebar
      }
    } catch (err) {
      console.error(err)
    } finally {
      setDeleting(null)
    }
  }

  function openSource(doc: Document) {
    if (doc.type === 'url') {
      window.open(doc.source, '_blank')
    } else if (doc.type === 'pdf') {
      window.open(`http://localhost:8000/files/${encodeURIComponent(doc.source)}`, '_blank')
    }
  }

  function TypeIcon({ type }: { type: string }) {
    if (type === 'pdf') return (
      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
        <span className="material-symbols-outlined text-red-500">picture_as_pdf</span>
      </div>
    )
    if (type === 'url') return (
      <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center">
        <span className="material-symbols-outlined text-sky-500">public</span>
      </div>
    )
    return (
      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
        <span className="material-symbols-outlined text-slate-500">notes</span>
      </div>
    )
  }

  function ConfidenceBadge({ chunks }: { chunks: number }) {
    if (chunks >= 10) return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-sky-50 text-sky-600 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
        HIGH CONFIDENCE
      </span>
    )
    if (chunks >= 5) return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
        MED CONFIDENCE
      </span>
    )
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-red-50 text-red-500 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        LOW CONFIDENCE
      </span>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-6xl mx-auto px-10 py-12">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10">
          <div className="flex-1">
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2" style={{ fontFamily: 'Manrope' }}>
              Library Archive
            </h2>
            <p className="text-slate-500 text-base max-w-lg">
              Access the complete repository of ingested editorial intelligence. Manage citations and verify source integrity.
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archive..."
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Filter by:</span>
          {(['all', 'pdf', 'url', 'text'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all ${
                filter === f ? 'bg-black text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f === 'all' ? 'All Sources' : f}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-20 h-20 mb-6 bg-slate-50 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-slate-300">folder_open</span>
            </div>
            <h3 className="text-xl font-bold text-slate-300 mb-2" style={{ fontFamily: 'Manrope' }}>
              Archive is Empty
            </h3>
            <p className="text-slate-400 text-sm max-w-xs mb-6">
              Upload documents to populate your archive.
            </p>
            <button
              onClick={onUploadClick}
              className="bg-black text-white px-6 py-3 rounded-xl font-bold text-sm hover:opacity-80 transition-all"
            >
              Upload Document
            </button>
          </div>
        )}

        {/* Document Grid */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            {filtered.map((doc, i) => (
              <div
                key={i}
                className="bg-white border border-slate-100 rounded-xl p-6 hover:shadow-md transition-all duration-300 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between">
                  <TypeIcon type={doc.type} />
                  <ConfidenceBadge chunks={doc.chunks} />
                </div>

                <div className="flex-1">
                  <h3 className="text-sm font-bold text-slate-800 line-clamp-2 mb-1" style={{ fontFamily: 'Manrope' }}>
                    {doc.source}
                  </h3>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">database</span>
                      {doc.chunks} chunks
                    </span>
                    {doc.pages > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">article</span>
                        {doc.pages} pages
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer: type label + open + delete */}
                <div className="mt-auto pt-3 border-t border-slate-50 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                    {doc.type}
                  </span>
                  <div className="flex items-center gap-1">
                    {(doc.type === 'pdf' || doc.type === 'url') && (
                      <button
                        onClick={() => openSource(doc)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all"
                        title="Open file"
                      >
                        <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                        Open
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(doc.source)}
                      disabled={deleting === doc.source}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-400 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-40"
                      title={`Delete ${doc.source}`}
                    >
                      {deleting === doc.source
                        ? <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
                        : <span className="material-symbols-outlined text-[15px]">delete</span>
                      }
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Add more card */}
            <div
              onClick={onUploadClick}
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-all"
            >
              <span className="material-symbols-outlined text-3xl text-slate-300 mb-2">upload_file</span>
              <p className="text-sm font-bold text-slate-400" style={{ fontFamily: 'Manrope' }}>
                Expand the Archive
              </p>
              <p className="text-xs text-slate-300 mt-1">ADD NEW DOCUMENTS OR URLS</p>
            </div>
          </div>
        )}

        {/* Stats footer */}
        {documents.length > 0 && (
          <div className="border-t border-slate-100 pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <p className="text-xs font-bold text-sky-600 uppercase tracking-widest mb-1">
                Total Storage Utilization
              </p>
              <h3 className="text-4xl font-black text-slate-900" style={{ fontFamily: 'Manrope' }}>
                {documents.length} Documents
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                The digital vault contains {totalChunks} semantic chunks indexed for retrieval.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center px-6 py-4 bg-slate-50 rounded-xl">
                <div className="text-2xl font-black text-slate-800" style={{ fontFamily: 'Manrope' }}>
                  {documents.length > 0 ? Math.round((pdfCount / documents.length) * 100) : 0}%
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">PDFs</div>
              </div>
              <div className="text-center px-6 py-4 bg-slate-50 rounded-xl">
                <div className="text-2xl font-black text-slate-800" style={{ fontFamily: 'Manrope' }}>
                  {documents.length > 0 ? Math.round((urlCount / documents.length) * 100) : 0}%
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">URLs</div>
              </div>
              <div className="text-center px-6 py-4 bg-slate-50 rounded-xl">
                <div className="text-2xl font-black text-slate-800" style={{ fontFamily: 'Manrope' }}>
                  {documents.length > 0 ? Math.round((textCount / documents.length) * 100) : 0}%
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Text</div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}