const shortcuts = ['[C] CONNECT', '[S] SIGN', '[R] RESEARCH', '[H] HISTORY', '[?] HELP']

export function BottomBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] flex h-8 items-center overflow-hidden border-t border-border bg-bg-base px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-text-secondary md:px-4">
      <div className="flex min-w-max items-center gap-2">
        {shortcuts.map((shortcut, index) => (
          <span key={shortcut} className="inline-flex items-center gap-2">
            <span className={index < 2 ? 'text-amber' : 'text-text-secondary'}>{shortcut}</span>
            {index < shortcuts.length - 1 ? <span className="text-text-muted">·</span> : null}
          </span>
        ))}
      </div>
    </div>
  )
}
