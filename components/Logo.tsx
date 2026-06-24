type LogoProps = {
  className?: string
  compact?: boolean
}

export function Logo({ className = '', compact = false }: LogoProps) {
  return (
    <div className={`group inline-flex items-center gap-3 font-semibold tracking-[-0.01em] text-text-primary ${className}`}>
      <svg
        className={`${compact ? 'h-[22px] w-[22px]' : 'h-7 w-7'} text-arc drop-shadow-[0_0_8px_rgba(77,126,255,0.35)] transition duration-200 group-hover:drop-shadow-[0_0_16px_rgba(77,126,255,0.35)]`}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
      >
        <path d="M14 3 A 11 11 0 1 1 3 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="22" cy="14" r="3" fill="currentColor" />
      </svg>
      <span className={compact ? 'text-sm' : 'text-base'}>Arc Lepton</span>
    </div>
  )
}
