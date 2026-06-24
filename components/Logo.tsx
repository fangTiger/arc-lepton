type LogoProps = {
  className?: string
  compact?: boolean
}

export function Logo({ className = '', compact = false }: LogoProps) {
  return (
    <div
      className={`inline-flex items-center font-mono font-bold uppercase tracking-[0.05em] text-amber ${
        compact ? 'text-xs' : 'text-sm'
      } ${className}`}
    >
      ARC│LEPTON
    </div>
  )
}
