import { cn } from '../lib/cn.js';

const base =
  'w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-400 ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-ink-50';

export function Label({ children, htmlFor, hint }) {
  return (
    // flex-wrap, so in a narrow column the hint moves to its own line rather
    // than forcing the label to wrap mid-phrase ("Number of / coupons").
    <label htmlFor={htmlFor} className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm font-medium leading-tight text-ink-700">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-ink-400">{hint}</span>}
    </label>
  );
}

export function Field({ label, hint, error, children, className }) {
  return (
    <div className={className}>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Input({ className, invalid, ...props }) {
  return <input className={cn(base, 'h-11', invalid && 'border-danger focus:ring-danger/25', className)} {...props} />;
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(base, 'py-2.5 min-h-[88px] resize-y', className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(base, 'h-11 appearance-none bg-no-repeat pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.75rem center',
      }}
      {...props}
    >
      {children}
    </select>
  );
}
