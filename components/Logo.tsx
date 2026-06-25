import { PRODUCT_NAME } from '@/lib/brand'

type LogoProps = {
  className?: string
  compact?: boolean
}

export function Logo({ className = '', compact = false }: LogoProps) {
  return (
    <a
      href="/"
      className={`inline-flex items-center font-mono font-bold uppercase tracking-[0.05em] text-amber transition-colors hover:text-cyan ${
        compact ? 'text-xs' : 'text-sm'
      } ${className}`}
    >
      {PRODUCT_NAME}
    </a>
  )
}
