interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  sources: string[]
  darkMode: boolean
  onClearAll: () => void
  onUploadClick: () => void
  onToggleDarkMode: () => void
}

export default function Sidebar({
  activeTab,
  onTabChange,
  sources,
  darkMode,
  onClearAll,
  onUploadClick,
  onToggleDarkMode,
}: SidebarProps) {
  const navItems = [
    { id: 'documents', label: 'Documents', icon: 'description' },
    { id: 'archive', label: 'Archive', icon: 'inventory_2' },
    { id: 'workspace', label: 'Workspace', icon: 'space_dashboard' },
    { id: 'url', label: 'URL Import', icon: 'link' },
    { id: 'plaintext', label: 'Plain Text', icon: 'notes' },
    { id: 'recent', label: 'Recent Analysis', icon: 'history' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]

  const dm = darkMode

  return (
    <aside className={`h-screen w-72 sticky left-0 flex flex-col px-6 pt-6 pb-4 shrink-0 overflow-hidden transition-colors duration-300 ${
      dm ? 'bg-slate-900 border-r border-slate-800' : 'bg-slate-100'
    }`}>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className={`text-xl font-black ${dm ? 'text-white' : 'text-slate-900'}`}>Library</h1>
          <p className={`text-xs font-medium uppercase tracking-widest mt-1 ${dm ? 'text-slate-500' : 'text-slate-500'}`}>
            Editorial Intelligence
          </p>
        </div>
        {/* Dark mode toggle */}
        <button
          id="dark-mode-toggle"
          onClick={onToggleDarkMode}
          title={dm ? 'Switch to light mode' : 'Switch to dark mode'}
          className={`mt-1 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110 active:scale-90 ${
            dm
              ? 'bg-slate-800 text-amber-400 hover:bg-slate-700'
              : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {dm ? 'light_mode' : 'dark_mode'}
          </span>
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-y-1 overflow-y-auto min-h-0">
        {navItems.map((item) => (
          <button
            key={item.id}
            id={`nav-${item.id}`}
            onClick={() => onTabChange(item.id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all active:scale-[0.98] duration-150 w-full text-left
              ${activeTab === item.id
                ? dm
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'bg-slate-200 text-slate-900 font-semibold'
                : dm
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
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
          <div className={`mt-6 pt-6 border-t ${dm ? 'border-slate-800' : 'border-slate-200'}`}>
            <span className={`text-[10px] font-bold uppercase tracking-widest block mb-3 ${dm ? 'text-slate-600' : 'text-slate-400'}`}>
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
                      href
                        ? dm
                          ? 'cursor-pointer hover:bg-slate-800'
                          : 'cursor-pointer hover:bg-slate-200/70'
                        : 'cursor-default'
                    }`}
                    title={href ? `Open ${source}` : source}
                  >
                    <span className={`material-symbols-outlined text-[18px] shrink-0 ${
                      isUrl ? 'text-sky-400' : isPdf ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {isUrl ? 'public' : isPdf ? 'picture_as_pdf' : 'notes'}
                    </span>
                    <span className={`text-xs font-medium truncate flex-1 ${dm ? 'text-slate-400' : 'text-slate-700'}`}>
                      {isUrl ? new URL(source).hostname : source}
                    </span>
                    {href && (
                      <span className={`material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${dm ? 'text-slate-600' : 'text-slate-300'}`}>
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

      {/* Bottom actions */}
      <div className={`shrink-0 flex flex-col gap-y-2 pt-4 mt-2 border-t ${dm ? 'border-slate-800' : 'border-slate-200'}`}>
        <button
          id="upload-document-btn"
          onClick={onUploadClick}
          className="w-full bg-black text-white py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-[0.98]"
        >
          <span className="material-symbols-outlined text-[18px]">upload_file</span>
          Upload Document
        </button>

        <button
          id="clear-all-btn"
          onClick={onClearAll}
          className={`flex items-center gap-3 px-4 py-3 w-full transition-all rounded-lg text-sm font-medium ${
            dm
              ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-700'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">delete_sweep</span>
          Clear All
        </button>
      </div>
    </aside>
  )
}