'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function TerminalMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mb-4 mt-6 font-mono text-xl font-bold uppercase text-amber">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-5 font-mono text-base font-bold uppercase text-amber">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 font-mono text-sm font-bold uppercase text-cyan">{children}</h3>,
        p: ({ children }) => <p className="mb-3 font-mono text-xs leading-6 text-text-primary">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-amber">{children}</strong>,
        em: ({ children }) => <em className="text-text-secondary not-italic">{children}</em>,
        ul: ({ children }) => <ul className="mb-3 space-y-1 font-mono text-xs text-text-primary">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 space-y-1 font-mono text-xs text-text-primary">{children}</ol>,
        li: ({ children }) => <li className="pl-1 before:mr-2 before:text-amber before:content-['▸']">{children}</li>,
        code: ({ children }) => <code className="border border-border bg-bg-cell px-1 py-0.5 font-mono text-[11px] text-cyan">{children}</code>,
        pre: ({ children }) => <pre className="mb-4 overflow-x-auto border border-border bg-bg-cell p-3 font-mono text-[11px] text-text-primary">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="mb-4 border-l border-amber pl-3 font-mono text-xs text-text-secondary">{children}</blockquote>,
        table: ({ children }) => <table className="mb-4 w-full border-collapse font-mono text-[11px]">{children}</table>,
        th: ({ children }) => <th className="border border-border bg-bg-cell px-2 py-2 text-left font-bold uppercase text-amber">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-2 text-text-primary">{children}</td>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-cyan underline decoration-cyan/60 underline-offset-2">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
