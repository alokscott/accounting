export default function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-1">{subtitle}</p>}
      </div>
      {children && (
        // No `justify-end`: the parent's justify-between already pushes this block
        // to the right on desktop, while items pack left-to-right and wrap tidily
        // (avoids the staggered look multi-line justify-end produces).
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  )
}
