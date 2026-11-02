import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { api } from '@/api';
import { cn } from '@/lib/utils';

// Wait this long after typing stops before searching, so each word isn't a search.
const TYPING_PAUSE = 350;
const LOAD_FAILED = "Couldn't load GIFs. Check your signal and try again.";

/**
 * The GIF search (the GIF button in the message box): what's trending until you
 * type, then GIFs for your words. Tapping one sends it right away (`onPick`).
 * Searches go through the site's server to KLIPY (api.chat.gifs()); previews show
 * pretend GIFs. docs/chat.md section 8. With `maxHeight` (the room above the
 * message box), only the GIFs shrink, so the search box always shows.
 */
export function GifPicker({ onPick, onClose, maxHeight, className }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'loading', gifs: [], more: false, page: 1, ready: true });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  const load = async (q, page) => {
    const ask = ++latest.current;
    setState((s) => ({ ...s, status: page > 1 ? 'more' : 'loading' }));
    try {
      const result = await api.chat.gifs(q, { page });
      if (ask !== latest.current) return;
      setState((s) => ({
        status: 'done',
        ready: result.ready !== false,
        gifs: page > 1 ? [...s.gifs, ...result.gifs.filter((g) => !s.gifs.some((x) => x.id === g.id))] : result.gifs,
        more: !!result.more,
        page,
      }));
    } catch {
      if (ask !== latest.current) return;
      setState((s) => ({ ...s, status: 'error' }));
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => load(query.trim(), 1), query.trim() ? TYPING_PAUSE : 0);
    return () => clearTimeout(timer);
  }, [query, attempt]);

  const words = query.trim();
  const { status, gifs, ready } = state;

  return (
    <div
      role="region"
      aria-label="GIF search"
      style={maxHeight == null ? undefined : { maxHeight }}
      className={cn('flex flex-col rounded-2xl border border-black/5 bg-white p-2 shadow-lg', className)}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-black/10 bg-zinc-50 px-3 focus-within:border-lime-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-lime-200">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            maxLength={50}
            enterKeyHint="search"
            className="h-10 min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-zinc-500 md:text-sm"
          />
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF search"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* One height whatever it shows, so the search box doesn't move while you type. */}
      <div className="mt-2 h-64 min-h-0 overflow-y-auto overscroll-contain sm:h-72" aria-busy={status === 'loading'}>
        {status === 'loading' && !gifs.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm font-semibold text-zinc-500">
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" /> Loading GIFs…
          </p>
        ) : status === 'error' && !gifs.length ? (
          <div className="py-6 text-center">
            <p className="text-sm font-semibold text-zinc-600">{LOAD_FAILED}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2 min-h-11 rounded-full px-4 text-xs font-bold text-lime-700 hover:bg-lime-50"
            >
              Try again
            </button>
          </div>
        ) : !ready ? (
          <p className="px-4 py-8 text-center text-sm font-semibold text-zinc-600">GIF search isn't turned on yet.</p>
        ) : !gifs.length ? (
          <p className="px-4 py-8 text-center text-sm font-semibold text-zinc-600">
            {words ? `No GIFs for "${words}".` : 'No GIFs right now.'}
          </p>
        ) : (
          <>
            {!words && <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">Trending</p>}
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {gifs.map((gif) => (
                <li key={gif.id}>
                  <button
                    type="button"
                    onClick={() => onPick(gif)}
                    aria-label={`Send GIF: ${gif.title || 'untitled'}`}
                    className="block w-full overflow-hidden rounded-xl bg-zinc-100 outline-none transition focus-visible:ring-2 focus-visible:ring-lime-400 active:scale-95"
                  >
                    <img
                      src={gif.preview?.url || gif.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-24 w-full object-cover sm:h-28"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {state.more && (
              <button
                type="button"
                onClick={() => load(words, state.page + 1)}
                disabled={status === 'more'}
                className="mt-2 min-h-11 w-full rounded-full text-xs font-bold text-lime-700 hover:bg-lime-50 disabled:opacity-60"
              >
                {status === 'more' ? 'Loading…' : 'More GIFs'}
              </button>
            )}
            {status === 'error' && <p className="mt-2 text-center text-xs font-semibold text-red-700">{LOAD_FAILED}</p>}
          </>
        )}
      </div>
      <p className="mt-1.5 shrink-0 text-right text-[11px] font-semibold text-zinc-500">Powered by KLIPY</p>
    </div>
  );
}
