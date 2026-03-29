interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  sources: string[]
  onClearAll: () => void
  onUploadClick: () => void
}

export default function Sidebar({ activeTab, onTabChange, sources, onClearAll, onUploadClick }: SidebarProps) {
  const navItems = [
    { id: 'documents', label: 'Documents', icon: 'description' },
    { id: 'archive', label: 'Archive', icon: 'inventory_2' },
    { id: 'workspace', label: 'Workspace', icon: '' },
    { id: 'url', label: 'URL Import', icon: 'link' },
    { id: 'plaintext', label: 'Plain Text', icon: 'notes' },
    { id: 'recent', label: 'Recent Analysis', icon: 'history' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <aside className="h-screen w-72 sticky left-0 bg-slate-100 flex flex-col px-6 pt-6 pb-4 shrink-0 overflow-hidden">
      <div className="mb-8">
        <h1 className="text-xl font-black text-slate-900">Library</h1>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mt-1">
          Editorial Intelligence
        </p>
      </div>

      <nav className="flex-1 flex flex-col gap-y-1 overflow-y-auto min-h-0">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all active:scale-[0.98] duration-150 w-full text-left
              ${activeTab === item.id
                ? 'bg-slate-200 text-slate-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-200/50'
              }`}
          >
            {item.icon && (
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            )}
            {item.label}
          </button>
        ))}

        {sources.length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
              Loaded Sources
            </span>
            <div className="space-y-1">
              {sources.map((source, i) => {
                const isUrl = source.startsWith('http')
                const isPdf = source.toLowerCase().endsWith('.pdf')
                const href = isUrl
                  ? source
                  : isPdf
                    ? `http://localhost:8000/files/${encodeURIComponent(source)}`
                    : null

                return (
                  <div
                    key={i}
                    onClick={() => href && window.open(href, '_blank')}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all group ${
                      href ? 'cursor-pointer hover:bg-slate-200/70' : 'cursor-default'
                    }`}
                    title={href ? `Open ${source}` : source}
                  >
                    <span className={`material-symbols-outlined text-[18px] shrink-0 ${
                      isUrl ? 'text-sky-400' : isPdf ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {isUrl ? 'public' : isPdf ? 'picture_as_pdf' : 'notes'}
                    </span>
                    <span className="text-xs font-medium text-slate-700 truncate flex-1">
                      {isUrl ? new URL(source).hostname : source}
                    </span>
                    {href && (
                      <span className="material-symbols-outlined text-[14px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        open_in_new
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom actions — pinned inside the gray sidebar */}
      <div className="shrink-0 flex flex-col gap-y-2 pt-4 mt-2 border-t border-slate-200">
        <button
          onClick={onUploadClick}
          className="w-full bg-black text-white py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-[0.98]"
        >
          <span className="material-symbols-outlined text-[18px]">upload_file</span>
          Upload Document
        </button>

        <button
          onClick={onClearAll}
          className="flex items-center gap-3 px-4 py-3 w-full text-slate-500 hover:bg-slate-200/70 hover:text-slate-700 transition-all rounded-lg text-sm font-medium"
        >
          <span className="material-symbols-outlined text-[20px]">delete_sweep</span>
          Clear All
        </button>
      </div>
    </aside>
  )
}