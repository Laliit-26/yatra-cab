import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { X } from 'lucide-react';
import { IconButton } from './Button.jsx';

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  // Rendered into <body>, not in place. An ancestor with a transform — which
  // every page carrying `animate-fade-in` has, since the animation's final
  // keyframe persists — becomes the containing block for position:fixed, and
  // the dialog then centres on that element instead of the viewport, clipping
  // its header off-screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      {/* The panel — not just its body — is capped, otherwise header + body +
          footer can exceed the viewport and the title scrolls off the top. */}
      <div className={cn('relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-pop animate-scale-in', sizes[size], className)}>
        {(title || onClose) && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-100 p-5">
            <div>
              {title && <h3 className="text-lg font-semibold text-ink-900">{title}</h3>}
              {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
            </div>
            {onClose && <IconButton icon={X} label="Close" onClick={onClose} />}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 p-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
