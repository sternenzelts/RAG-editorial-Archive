interface TopBarProps {
  activeTab: string
  chunksLoaded: number
  onTabChange: (tab: string) => void
}

export default function TopBar({ activeTab, chunksLoaded, onTabChange }: TopBarProps) {
  const tabTitles: Record<string, string> = {
    documents: 'Analysis',
    archive: 'Archive',
    url: 'URL Import',
    plaintext: 'Plain Text',
    recent: 'Recent Analysis',
    settings: 'Settings',
  }

  return (
    <header className="w-full sticky top-0 z-10 bg-slate-50 border-b border-slate-100 flex justify-between items-center px-8 py-3">
      <div className="flex items-center gap-6">
        <span className="text-lg font-black tracking-tighter text-slate-900 uppercase" style={{ fontFamily: 'Manrope' }}>
          The Digital Archivist
        </span>
        {chunksLoaded > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-3 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight">
                Status: {chunksLoaded} Chunks Loaded
              </span>
            </div>
          </div>
        )}
      </div>
      <nav className="flex items-center gap-6">
        {[
          { label: 'Analysis', tab: 'documents' },
          { label: 'Archive', tab: 'archive' },
          { label: 'Workspace', tab: 'workspace' },
        ].map((item) => (
          
          <a key={item.label}
            href="#"
            onClick={(e) => { e.preventDefault(); onTabChange(item.tab) }}
            className={`text-sm font-bold tracking-tight transition-colors
              ${activeTab === item.tab
                ? 'text-slate-900 border-b-2 border-slate-900 pb-1'
                : 'text-slate-400 hover:text-slate-700'
              }`}
            style={{ fontFamily: 'Manrope' }}
          >
            {item.label}
          </a>
        ))}
        <button className="text-slate-900 hover:opacity-70 transition-opacity ml-2">
          <span className="material-symbols-outlined">database</span>
        </button>
      </nav>
    </header>
  )
}