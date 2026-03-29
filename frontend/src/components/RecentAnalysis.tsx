import { useState } from 'react'

interface AnalysisEntry {
  id: string
  title: string
  summary: string
  sources: string[]
  timestamp: string
  date: 'today' | 'yesterday' | 'older'
}

interface RecentAnalysisProps {
  messages: { role: string; answer: string; citations: any[] }[]
}

export default function RecentAnalysis({ messages }: RecentAnalysisProps) {
  const [filter, setFilter] = useState('')
  const [deletedIds, setDeletedIds] = useState<string[]>([])

  const entries: AnalysisEntry[] = messages
    .reduce<AnalysisEntry[]>((acc, msg, i) => {
      if (msg.role !== 'assistant') return acc

      const userMsg = messages[i - 1]
      const sources = [...new Set(msg.citations.map((c: any) => c.source))]

      acc.push({
        id: String(i),
        title: userMsg?.answer?.slice(0, 60) ?? 'Analysis',
        summary: msg.answer
          .replace(/\*\*/g, '')
          .replace(/\[.*?\]/g, '')
          .slice(0, 180) + '...',
        sources,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        date: 'today' as const
      })

      return acc
    }, [])
    .reverse()

  const filtered = entries
    .filter(e => !deletedIds.includes(e.id))
    .filter(e =>
      e.title.toLowerCase().includes(filter.toLowerCase()) ||
      e.summary.toLowerCase().includes(filter.toLowerCase())
    )

  const todayEntries = filtered.filter(e => e.date === 'today')
  const yesterdayEntries = filtered.filter(e => e.date === 'yesterday')

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-5xl mx-auto px-10 py-12">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2" style={{ fontFamily: 'Manrope' }}>
              Recent Analysis
            </h2>
            <p className="text-slate-500 font-medium">Review and resume your editorial investigations.</p>
          </div>
          <div className="relative w-full md:w-80">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter history..."
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-20 h-20 mb-6 bg-slate-50 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-slate-300">history</span>
            </div>
            <h3 className="text-xl font-bold text-slate-300 mb-2" style={{ fontFamily: 'Manrope' }}>
              The Archive is Silent
            </h3>
            <p className="text-slate-400 text-sm max-w-xs">
              Start a new analysis to populate your editorial history.
            </p>
          </div>
        )}

        {/* Today */}
        {todayEntries.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 shrink-0">Today</span>
              <div className="h-px w-full bg-slate-100" />
            </div>
            <div className="space-y-4">
              {todayEntries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onDelete={() => setDeletedIds(prev => [...prev, entry.id])}
                />
              ))}
            </div>
          </section>
        )}

        {/* Yesterday */}
        {yesterdayEntries.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-4 mb-6">
              <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 shrink-0">Yesterday</span>
              <div className="h-px w-full bg-slate-100" />
            </div>
            <div className="space-y-4">
              {yesterdayEntries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onDelete={() => setDeletedIds(prev => [...prev, entry.id])}
                />
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

function EntryCard({ entry, onDelete }: { entry: AnalysisEntry; onDelete: () => void }) {
  return (
    <div className="group flex flex-col md:flex-row gap-6 p-6 bg-white rounded-xl border border-slate-100 hover:shadow-md transition-all duration-300 relative">
      {/* Accent bar */}
      <div className="absolute left-0 top-6 bottom-6 w-1 bg-blue-200 rounded-r-full" />

      <div className="flex-1 pl-2">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-bold text-slate-800 capitalize" style={{ fontFamily: 'Manrope' }}>
            {entry.title}
          </h3>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 ml-4">
            {entry.timestamp}
          </span>
        </div>
        <p className="text-sm text-slate-500 leading-relaxed mb-4 line-clamp-2">
          {entry.summary}
        </p>
        {entry.sources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {entry.sources.map((source, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 px-2 py-1 rounded-full">
                <span className="material-symbols-outlined text-[12px]">description</span>
                {source}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex md:flex-col items-center justify-center gap-2 md:border-l border-slate-100 md:pl-6">
        <button
          className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"
          title="Reopen"
        >
          <span className="material-symbols-outlined text-[20px]">open_in_new</span>
        </button>
        <button
          className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors"
          title="Export PDF"
        >
          <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
          title="Delete"
        >
          <span className="material-symbols-outlined text-[20px]">delete</span>
        </button>
      </div>
    </div>
  )
}