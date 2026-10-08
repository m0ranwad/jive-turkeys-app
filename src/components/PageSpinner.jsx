import { LoaderCircle } from 'lucide-react';

export function PageSpinner() {
  return (
    <div className="flex justify-center py-24">
      <LoaderCircle className="h-6 w-6 animate-spin text-zinc-300" />
    </div>
  );
}

export function CaptainsOnly({ children }) {
  return (
    <div className="rounded-3xl border border-black/5 bg-white p-8 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="font-display text-lg font-extrabold uppercase tracking-tight">Captains only</p>
      <p className="mt-2 text-sm text-zinc-500">{children}</p>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-medium text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
