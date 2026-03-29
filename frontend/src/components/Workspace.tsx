import { useState, useEffect, useRef } from 'react'

const API = 'http://localhost:8000'

interface Collection {
  id: string
  name: string
  description: string
  sources: string[]
  status: string
  synthesis: string
  created_at: string
}

interface Synthesis {
  title: string
  summary: string
  insight: string
  metric_label: string
  metric_value: string
  metric_delta: string
  confidence: number
  cross_references: number
}

interface WorkspaceProps {
  onUploadClick?: () => void
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function sourceIcon(source: string) {
  if (source.startsWith('http')) return { icon: 'public', color: 'text-sky-500', bg: 'bg-sky-50' }
  if (source.endsWith('.pdf')) return { icon: 'picture_as_pdf', color: 'text-red-500', bg: 'bg-red-50' }
  return { icon: 'notes', color: 'text-slate-500', bg: 'bg-slate-100' }
}

// Highlight [source] references inline
function HighlightedText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <span>
      {parts.map((part, i) =>
        /^\[.+\]$/.test(part) ? (
          <span
            key={i}
            className="inline-flex items-center mx-0.5 px-2 py-0.5 rounded-md text-[13px] font-semibold bg-blue-50 text-blue-700 border border-blue-100"
            style={{ fontFamily: 'Manrope' }}
          >
            {part.replace(/[\[\]]/g, '')}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

export default function Workspace({ onUploadClick }: WorkspaceProps) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [allSources, setAllSources] = useState<string[]>([])
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null)
  const [editedSummary, setEditedSummary] = useState('')
  const [synthesizing, setIsSynthesizing] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [showAddDoc, setShowAddDoc] = useState(false)
  const [addDocSearch, setAddDocSearch] = useState('')
  const newNameRef = useRef<HTMLInputElement>(null)

  const activeCollection = collections.find(c => c.id === activeId) ?? null

  // Load collections + all ingested sources
  useEffect(() => {
    fetch(`${API}/workspace/collections`)
      .then(r => r.json())
      .then(d => {
        setCollections(d.collections ?? [])
        if (d.collections?.length > 0 && !activeId) setActiveId(d.collections[0].id)
      })
      .catch(console.error)

    fetch(`${API}/status`)
      .then(r => r.json())
      .then(d => setAllSources(d.sources ?? []))
      .catch(console.error)
  }, [])

  // Refresh available sources whenever the add-doc dropdown is opened
  useEffect(() => {
    if (!showAddDoc) return
    fetch(`${API}/status`)
      .then(r => r.json())
      .then(d => setAllSources(d.sources ?? []))
      .catch(console.error)
  }, [showAddDoc])

  // Load synthesis when active collection changes
  useEffect(() => {
    if (!activeCollection) { setSynthesis(null); setEditedSummary(''); return }
    if (activeCollection.synthesis) {
      try {
        const data = JSON.parse(activeCollection.synthesis)
        setSynthesis(data)
        setEditedSummary(data.summary ?? '')
      } catch {
        setSynthesis(null)
        setEditedSummary('')
      }
    } else {
      setSynthesis(null)
      setEditedSummary('')
    }
  }, [activeId, collections])

  async function createCollection() {
    if (!newName.trim()) return
    const res = await fetch(`${API}/workspace/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() })
    })
    const col: Collection = await res.json()
    setCollections(prev => [...prev, col])
    setActiveId(col.id)
    setNewName(''); setNewDesc(''); setShowNewForm(false)
  }

  async function deleteCollection(id: string) {
    await fetch(`${API}/workspace/collections/${id}`, { method: 'DELETE' })
    const remaining = collections.filter(c => c.id !== id)
    setCollections(remaining)
    setActiveId(remaining[0]?.id ?? null)
  }

  async function addSource(source: string) {
    if (!activeId) return
    await fetch(`${API}/workspace/collections/${activeId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source })
    })
    setCollections(prev => prev.map(c =>
      c.id === activeId ? { ...c, sources: [...c.sources, source] } : c
    ))
    setShowAddDoc(false)
    setAddDocSearch('')
  }

  async function removeSource(source: string) {
    if (!activeId) return
    await fetch(`${API}/workspace/collections/${activeId}/documents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source })
    })
    setCollections(prev => prev.map(c =>
      c.id === activeId ? { ...c, sources: c.sources.filter(s => s !== source) } : c
    ))
  }

  async function runSynthesis() {
    if (!activeId) return
    setIsSynthesizing(true)
    try {
      const res = await fetch(`${API}/workspace/collections/${activeId}/synthesize`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        alert(err.detail ?? 'Synthesis failed')
        return
      }
      const data = await res.json()
      setSynthesis(data.synthesis)
      setEditedSummary(data.synthesis.summary ?? '')
      // refresh collections to pick up saved synthesis
      const r2 = await fetch(`${API}/workspace/collections`)
      const d2 = await r2.json()
      setCollections(d2.collections ?? [])
    } finally {
      setIsSynthesizing(false)
    }
  }

  async function finalize() {
    if (!activeId) return
    await fetch(`${API}/workspace/collections/${activeId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: activeCollection?.status === 'finalized' ? 'drafting' : 'finalized' })
    })
    setCollections(prev => prev.map(c =>
      c.id === activeId
        ? { ...c, status: c.status === 'finalized' ? 'drafting' : 'finalized' }
        : c
    ))
  }

  async function saveSummaryEdit() {
    if (!activeId || !synthesis) return
    const updated = { ...synthesis, summary: editedSummary }
    await fetch(`${API}/workspace/collections/${activeId}/synthesis`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synthesis: JSON.stringify(updated) })
    })
    setSynthesis(updated)
  }

  const availableSources = allSources.filter(
    s => activeCollection && !activeCollection.sources.includes(s) &&
      s.toLowerCase().includes(addDocSearch.toLowerCase())
  )

  const confidencePct = synthesis ? Math.round(synthesis.confidence * 100) : 0

  return (
    <div className="flex h-full overflow-hidden bg-white">

      {/* ── Collections Panel ─────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-slate-100 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-6 pb-4 flex items-center justify-between border-b border-slate-100">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Collections</span>
          <button
            onClick={() => { setShowNewForm(true); setTimeout(() => newNameRef.current?.focus(), 50) }}
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-all"
            title="New Collection"
          >
            <span className="material-symbols-outlined text-[18px] text-slate-500">add</span>
          </button>
        </div>

        {/* New Collection Form */}
        {showNewForm && (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <input
              ref={newNameRef}
              placeholder="Collection name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createCollection()}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 mb-2"
            />
            <input
              placeholder="Description (optional)"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createCollection()}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 mb-2"
            />
            <div className="flex gap-2">
              <button
                onClick={createCollection}
                className="flex-1 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:opacity-80 transition-all"
              >Create</button>
              <button
                onClick={() => { setShowNewForm(false); setNewName(''); setNewDesc('') }}
                className="flex-1 py-1.5 rounded-lg bg-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-300 transition-all"
              >Cancel</button>
            </div>
          </div>
        )}

        {/* Collections List */}
        <div className="flex-1 overflow-y-auto py-2">
          {collections.length === 0 && !showNewForm && (
            <div className="flex flex-col items-center justify-center h-40 text-center px-4">
              <span className="material-symbols-outlined text-3xl text-slate-200 mb-2">folder_open</span>
              <p className="text-xs text-slate-400 font-medium">No collections yet.<br />Click + to create one.</p>
            </div>
          )}
          {collections.map(col => (
            <div
              key={col.id}
              onClick={() => setActiveId(col.id)}
              className={`mx-3 my-1 rounded-xl px-4 py-3 cursor-pointer group transition-all duration-150 ${
                col.id === activeId
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`material-symbols-outlined text-[18px] shrink-0 ${col.id === activeId ? 'text-slate-300' : 'text-slate-400'}`}>
                    folder
                  </span>
                  <span className="text-sm font-semibold truncate" style={{ fontFamily: 'Manrope' }}>
                    {col.name}
                  </span>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteCollection(col.id) }}
                  className={`ml-2 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity ${col.id === activeId ? 'text-slate-400 hover:text-red-300' : 'text-slate-300 hover:text-red-400'}`}
                  title="Delete collection"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              <div className={`flex items-center gap-1.5 mt-1 ml-7 text-xs ${col.id === activeId ? 'text-slate-400' : 'text-slate-400'}`}>
                {col.id === activeId && (
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                )}
                <span>{col.sources.length} Document{col.sources.length !== 1 ? 's' : ''}</span>
                {col.id === activeId && <span>• Active</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Collection Assets */}
        {activeCollection && (
          <div className="border-t border-slate-100 flex flex-col overflow-hidden" style={{ maxHeight: '40%' }}>
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Collection Assets</span>
              <button
                onClick={() => setShowAddDoc(v => !v)}
                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-all"
                title="Add document"
              >
                <span className="material-symbols-outlined text-[15px] text-slate-500">add</span>
              </button>
            </div>

            {/* Add doc dropdown */}
            {showAddDoc && (
              <div className="mx-3 mb-2 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden z-10">
                <div className="p-2 border-b border-slate-100">
                  <input
                    autoFocus
                    placeholder="Search sources…"
                    value={addDocSearch}
                    onChange={e => setAddDocSearch(e.target.value)}
                    className="w-full text-xs px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100 focus:outline-none"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {availableSources.length === 0
                    ? <p className="text-[11px] text-slate-400 text-center py-4">No more sources to add</p>
                    : availableSources.map(s => {
                      const { icon, color } = sourceIcon(s)
                      return (
                        <button
                          key={s}
                          onClick={() => addSource(s)}
                          className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs text-slate-700 truncate"
                        >
                          <span className={`material-symbols-outlined text-[15px] ${color}`}>{icon}</span>
                          <span className="truncate">{s.split('/').pop()}</span>
                        </button>
                      )
                    })
                  }
                </div>
              </div>
            )}

            <div className="overflow-y-auto flex-1 px-3 pb-3 space-y-1">
              {activeCollection.sources.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-4 px-2">
                  No documents. Click + to add ingested sources.
                </p>
              )}
              {activeCollection.sources.map((s, i) => {
                const { icon, color, bg } = sourceIcon(s)
                return (
                  <div key={i} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 group">
                    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                      <span className={`material-symbols-outlined text-[16px] ${color}`}>{icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{s.split('/').pop()}</p>
                      <p className="text-[10px] text-slate-400">Added to collection</p>
                    </div>
                    <button
                      onClick={() => removeSource(s)}
                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all"
                    >
                      <span className="material-symbols-outlined text-[15px]">close</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Analysis Synthesis Panel ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* No collection selected */}
        {!activeCollection && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <span className="material-symbols-outlined text-5xl text-slate-200 mb-4">workspaces</span>
            <h2 className="text-xl font-black text-slate-300 uppercase tracking-tight mb-2" style={{ fontFamily: 'Manrope' }}>
              No Collection Selected
            </h2>
            <p className="text-sm text-slate-400 max-w-xs">
              Create a collection on the left, add your ingested documents, then click <strong>AI Assist</strong> to synthesize.
            </p>
          </div>
        )}

        {activeCollection && (
          <>
            {/* Top bar */}
            <div className="px-8 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <p className="text-xs text-slate-400 font-medium">
                <span className="text-slate-300">Project Workspace</span>
                <span className="mx-1.5 text-slate-200">/</span>
                <span className="text-slate-600 font-semibold">{activeCollection.name}</span>
              </p>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
                  <span className="material-symbols-outlined text-[16px]">share</span>
                  Share
                </button>
                <button
                  onClick={finalize}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    activeCollection.status === 'finalized'
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'bg-black text-white hover:opacity-80'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {activeCollection.status === 'finalized' ? 'check_circle' : 'flag'}
                  </span>
                  {activeCollection.status === 'finalized' ? 'Finalized' : 'Finalize'}
                </button>
              </div>
            </div>

            {/* Synthesis content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-8 py-8">

                {/* Status */}
                <div className="flex items-center gap-3 mb-6">
                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest border ${
                    activeCollection.status === 'finalized'
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {activeCollection.status === 'finalized' ? '✓ Finalized' : 'Active Workspace'}
                  </span>
                  <span className={`text-xs font-semibold flex items-center gap-1 ${
                    activeCollection.status === 'finalized' ? 'text-teal-500' : 'text-slate-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      activeCollection.status === 'finalized' ? 'bg-teal-400' : 'bg-amber-400'
                    }`} />
                    {activeCollection.status === 'finalized' ? 'Analysis Complete' : 'Drafting Analysis'}
                  </span>

                  {/* AI Assist */}
                  <button
                    onClick={runSynthesis}
                    disabled={synthesizing || activeCollection.sources.length === 0}
                    className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:opacity-80 disabled:opacity-40 transition-all"
                  >
                    {synthesizing
                      ? <><span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Synthesizing…</>
                      : <><span className="material-symbols-outlined text-[16px]">auto_awesome</span> AI Assist</>
                    }
                  </button>
                </div>

                {/* Title */}
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-slate-300 text-[22px]">analytics</span>
                  <h2 className="text-lg font-bold text-slate-700 uppercase tracking-wider" style={{ fontFamily: 'Manrope' }}>
                    Analysis Synthesis
                  </h2>
                </div>

                {!synthesis && (
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center py-20 text-center">
                    <span className="material-symbols-outlined text-4xl text-slate-200 mb-4">auto_awesome</span>
                    <p className="text-slate-400 font-semibold mb-1" style={{ fontFamily: 'Manrope' }}>
                      No synthesis yet
                    </p>
                    <p className="text-xs text-slate-300 max-w-xs mb-6">
                      {activeCollection.sources.length === 0
                        ? 'Add documents to this collection first, then click AI Assist.'
                        : 'Click AI Assist above to generate an executive synthesis from your collection.'}
                    </p>
                    {activeCollection.sources.length > 0 && (
                      <button
                        onClick={runSynthesis}
                        disabled={synthesizing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:opacity-80 transition-all disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                        Generate Synthesis
                      </button>
                    )}
                  </div>
                )}

                {synthesis && (
                  <div className="space-y-6">
                    {/* Title block */}
                    <div>
                      <h3 className="text-2xl font-extrabold text-slate-900 leading-tight mb-1" style={{ fontFamily: 'Manrope' }}>
                        {synthesis.title}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Drafted by The Archivist AI · {timeAgo(activeCollection.created_at)}
                      </p>
                    </div>

                    {/* Editable summary */}
                    <div>
                      <p className="text-sm text-slate-500 leading-relaxed mb-2">
                        <HighlightedText text={synthesis.summary} />
                      </p>
                      <details className="group">
                        <summary className="text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-600 transition-colors select-none list-none flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
                          Edit summary
                        </summary>
                        <div className="mt-2">
                          <textarea
                            value={editedSummary}
                            onChange={e => setEditedSummary(e.target.value)}
                            rows={4}
                            className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
                          />
                          <button
                            onClick={saveSummaryEdit}
                            className="mt-2 px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:opacity-80 transition-all"
                          >Save Edit</button>
                        </div>
                      </details>
                    </div>

                    {/* Synthetic Insight callout */}
                    {synthesis.insight && (
                      <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-5 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-teal-500 text-[18px]">lightbulb</span>
                          <span className="text-[11px] font-black text-teal-600 uppercase tracking-widest">Synthetic Insight</span>
                        </div>
                        <p className="text-sm text-teal-800 italic leading-relaxed">
                          "{synthesis.insight}"
                        </p>
                      </div>
                    )}

                    {/* Key Metrics row */}
                    <div className="grid grid-cols-2 gap-4">
                      {synthesis.metric_value && (
                        <div className="rounded-xl border border-slate-100 bg-white px-5 py-4">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            {synthesis.metric_label || 'Key Metric'}
                          </p>
                          <p className="text-2xl font-black text-slate-900" style={{ fontFamily: 'Manrope' }}>
                            {synthesis.metric_value}
                          </p>
                          {synthesis.metric_delta && (
                            <p className="text-xs font-semibold text-teal-600 mt-1">
                              {synthesis.metric_delta}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="rounded-xl border border-slate-100 bg-white px-5 py-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                          Confidence Level
                        </p>
                        <p className={`text-2xl font-black ${
                          confidencePct >= 80 ? 'text-teal-600' : confidencePct >= 50 ? 'text-amber-500' : 'text-red-500'
                        }`} style={{ fontFamily: 'Manrope' }}>
                          {confidencePct >= 80 ? 'High' : confidencePct >= 50 ? 'Medium' : 'Low'} ({confidencePct}%)
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Based on {synthesis.cross_references} cross-reference{synthesis.cross_references !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                )}


              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
