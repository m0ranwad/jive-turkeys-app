import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { useTeam } from '@/hooks/useTeam';
import { initials, shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

const HISTORY = 200;

export function ChatPage() {
  const { user, profile, loading } = useTeam();
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.entities.Message.list('-created_date', HISTORY).then((rows) => {
      if (cancelled) return;
      // Merge in anything that arrived live while history was loading.
      setMessages((live) => [...rows.reverse(), ...live.filter((m) => !rows.some((r) => r.id === m.id))]);
      setLoadingMessages(false);
    });
    const unsubscribe = api.entities.Message.subscribe((message) =>
      setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message])),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !user) return;
    setSending(true);
    setDraft('');
    try {
      const created = await api.entities.Message.create({
        user_id: user.id,
        author_name: profile?.display_name || user.full_name || 'Player',
        body,
      });
      setMessages((list) => (list.some((m) => m.id === created.id) ? list : [...list, created]));
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  if (loading || loadingMessages) return <PageSpinner />;

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 7rem)' }}>
      <div className="mb-3">
        <PageHeader title="Team Chat" subtitle="One shared room for the whole squad. Keep it classy." />
      </div>
      <div
        ref={scroller}
        className="flex-1 space-y-3 overflow-y-auto rounded-3xl border border-black/5 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        style={{ maxHeight: 'calc(100vh - 18rem)' }}
      >
        {messages.length === 0 && (
          <div className="grid place-items-center py-16 text-center">
            <p className="text-sm font-semibold text-zinc-400">No messages yet — break the ice.</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.user_id === user?.id;
          return (
            <div key={m.id} className={cn('flex items-end gap-2.5', mine && 'flex-row-reverse')}>
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold uppercase',
                  mine ? 'bg-zinc-950 text-lime-400' : 'bg-lime-400 text-black',
                )}
              >
                {initials(m.author_name)}
              </span>
              <div className={cn('max-w-[78%] rounded-2xl px-3.5 py-2.5', mine ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-800')}>
                {!mine && (
                  <div className="mb-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                    {shortName(m.author_name)}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words text-sm font-medium leading-snug">{m.body}</div>
                <div className={cn('mt-1 text-[10px] font-semibold uppercase tracking-wide', mine ? 'text-white/40' : 'text-zinc-400')}>
                  {new Date(m.created_date).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the team…"
          maxLength={500}
          className="h-12 flex-1 rounded-full border border-black/10 bg-white px-5 text-sm font-medium outline-none transition focus:border-lime-400 focus:ring-2 focus:ring-lime-200"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-950 text-lime-400 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
