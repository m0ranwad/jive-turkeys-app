import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext({ toast: () => {} });

const DURATION_MS = 4000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    ({ title, description }) => {
      const id = ++nextId.current;
      // Newest first, one at a time on mobile like the original shadcn toaster.
      setToasts((list) => [{ id, title, description }, ...list].slice(0, 3));
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed top-0 z-[100] flex max-h-screen w-full flex-col p-4 sm:bottom-0 sm:right-0 sm:top-auto md:max-w-[420px]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto relative mb-2 flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border bg-background p-6 pr-8 text-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-full sm:slide-in-from-bottom-full"
          >
            <div className="grid gap-1">
              {t.title && <div className="text-sm font-semibold">{t.title}</div>}
              {t.description && <div className="text-sm opacity-90">{t.description}</div>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 transition hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
