import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { shortWhen } from '@/lib/chat';
import { shortName } from '@/lib/format';

/** The message text with what was searched for highlighted (case-insensitive). */
function Highlighted({ text, query }) {
  const q = query.trim();
  if (q.length < 2) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded bg-lime-200 px-0.5 text-zinc-900">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/**
 * Search every chat room you can read: type a word, tap a result to jump to
 * that message. `onPick(message)` gets { id, thread_id }.
 */
export function ChatSearch({ open, onOpenChange, nameOf, onPick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    // Any change outdates an answer still on its way, and the last error.
    const ask = ++latest.current;
    setError('');
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.chat
        .search(q)
        .then((rows) => ask === latest.current && setResults(rows))
        .catch((err) => ask === latest.current && (setResults(null), setError(err.message)));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Search the chat</DialogTitle>
        </DialogHeader>
        <label className="flex items-center gap-2 rounded-2xl border border-black/10 bg-zinc-50 px-3 focus-within:border-lime-400 focus-within:bg-white">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="An address, a Venmo handle, a field number…"
            aria-label="Search the chat"
            className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
          />
        </label>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-live="polite">
          {error && <p className="py-6 text-center text-sm text-red-600">{error}</p>}
          {!error && results?.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Nothing found.</p>}
          {!error && results === null && (
            <p className="py-6 text-center text-sm text-zinc-400">Searches Team Chat, every thread and your private chats.</p>
          )}
          <ul className="space-y-1.5">
            {(results || []).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    onPick(m);
                  }}
                  className="w-full rounded-2xl px-3 py-2.5 text-left transition hover:bg-zinc-100"
                >
                  <div className="flex items-baseline justify-between gap-2 text-[11px] font-bold">
                    <span className="truncate text-zinc-900">
                      {shortName(nameOf(m.user_id, m.author_name))}
                      <span className="font-semibold text-zinc-400"> · {m.thread_id ? m.thread_title || 'Thread' : 'Team Chat'}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-zinc-400">{shortWhen(m.created_date)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-sm text-zinc-700">
                    <Highlighted text={m.body} query={query} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
