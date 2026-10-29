import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Hash, Lock, LogOut, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { BIG_BUTTON, DIALOG, DIALOG_TITLE, EYEBROW, FIELD_LABEL, PILL } from '@/lib/constants';
import { initials, shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

const NEW_KINDS = [
  {
    kind: 'new',
    icon: Hash,
    label: 'Thread for everyone',
    hint: 'The whole team can see and join it: carpools, pickup games, the fantasy league.',
  },
  {
    kind: 'private',
    icon: Lock,
    label: 'Private chat',
    hint: 'Just you and the teammates you pick. Nobody else sees it, captains included.',
  },
];

/** The room list's New button: a thread for the whole team, or a private chat. `onPick('new' | 'private')`. */
export function NewRoomDialog({ open, onOpenChange, onPick }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>Start a chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {NEW_KINDS.map(({ kind, icon: Icon, label, hint }) => (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              className="flex w-full items-center gap-3 rounded-2xl bg-zinc-50 px-3.5 py-3 text-left transition hover:bg-lime-100/70"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-zinc-600 ring-1 ring-black/5">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-zinc-900">{label}</span>
                <span className="block text-[11px] font-medium leading-snug text-zinc-500">{hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Start a thread (title plus an optional first message), or rename one (or a private chat). */
export function ThreadDialog({ open, onOpenChange, thread, onSave }) {
  const renaming = !!thread;
  const chat = thread?.visibility === 'private';
  const [title, setTitle] = useState('');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(thread?.title || '');
      setFirst('');
    }
    // Only when it opens, so a live update to the thread doesn't wipe what's typed.
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave({ title: title.trim(), first: first.trim() });
      onOpenChange(false);
    } catch {
      // onSave already said what went wrong; keep the dialog open to try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG, 'sm:max-w-md')}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{renaming ? (chat ? 'Rename chat' : 'Rename thread') : 'New thread'}</DialogTitle>
          {!renaming && (
            <p className="text-sm text-zinc-500">
              Everyone on the team can see and join it.
            </p>
          )}
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="thread-title" className={FIELD_LABEL}>{chat ? 'Name' : 'Topic'}</Label>
            <Input
              id="thread-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="⚽ Sunday pickup"
              autoFocus
              className="h-12 rounded-2xl text-base"
            />
          </div>
          {!renaming && (
            <div className="space-y-2">
              <Label htmlFor="thread-first" className={FIELD_LABEL}>First message (optional)</Label>
              <Textarea
                id="thread-first"
                rows={3}
                maxLength={2000}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="Kick it off…"
                className="rounded-2xl text-base"
              />
            </div>
          )}
          <div className="space-y-2">
            <Button type="submit" disabled={busy || !title.trim()} className={BIG_BUTTON}>
              {busy ? 'Saving…' : renaming ? 'Save' : 'Start thread'}
            </Button>
            <button type="button" onClick={() => onOpenChange(false)} className="min-h-11 w-full text-xs font-bold uppercase tracking-wider text-zinc-600">Cancel</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The same labels, buttons and badges as the Team and Dues popups.

/** Initials in a circle, colored like the Team page (women lime, men black). */
function Avatar({ person, small }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-extrabold uppercase',
        small ? 'h-9 w-9 text-[11px]' : 'h-10 w-10 text-xs',
        person.gender === 'F' ? 'bg-lime-400 text-black' : 'bg-zinc-900 text-lime-400',
      )}
    >
      {initials(person.name)}
    </span>
  );
}

/**
 * Teammates to tick: [{ id, name, gender, captain }]. A search box shows once
 * the list is long.
 *
 * The list is the only part of its window that scrolls: it shrinks to fit the
 * screen, so the title, search box and button stay put. It goes straight in a
 * shrinking flex column with gap-4 (no wrapper in between, or the list couldn't
 * shrink), which scrolls as a whole only on screens too short for even that.
 */
function PeoplePicker({ people, picked, onToggle }) {
  const [query, setQuery] = useState('');
  // A name or any word in it starting with what's typed: "sam", "okafor" and "sam ok" all find Sam Okafor.
  const shown = useMemo(() => {
    const q = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const name = p.name.toLocaleLowerCase();
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    });
  }, [people, query]);
  if (!people.length) {
    return <p className="rounded-2xl bg-zinc-50 px-3.5 py-3 text-sm text-zinc-500">Everyone on the site is already in it.</p>;
  }
  return (
    <>
      {people.length > 6 && (
        <div className="relative -mb-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a teammate"
            aria-label="Find a teammate"
            autoComplete="off"
            className="h-11 rounded-xl pl-10"
          />
        </div>
      )}
      {/* At least two names and a peek at the next show, so it's clear the list goes on. */}
      <div
        data-testid="people-list"
        className={cn(
          '-mx-1 space-y-1 overflow-y-auto overscroll-contain px-1 py-0.5',
          shown.length > 2 ? 'min-h-[9rem]' : 'shrink-0',
        )}
      >
        {shown.map((p) => {
          const on = picked.has(p.id);
          return (
            <label
              key={p.id}
              className={cn(
                // relative: keeps the hidden checkbox inside its row (otherwise it stretches the window).
                'relative flex cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2 transition',
                on ? 'bg-lime-100/70 ring-1 ring-lime-300' : 'hover:bg-zinc-50',
              )}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(p.id)} aria-label={p.name} />
              <Avatar person={p} small />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{p.name}</span>
              {p.captain && <span className={cn(PILL, 'bg-zinc-950 text-lime-400')}>Captain</span>}
              <span
                aria-hidden
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition',
                  on ? 'border-zinc-950 bg-zinc-950 text-lime-400' : 'border-zinc-200 bg-white',
                )}
              >
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
              </span>
            </label>
          );
        })}
        {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-zinc-500">Nobody by that name.</p>}
      </div>
    </>
  );
}

// What holds a PeoplePicker. The edge padding keeps focus rings from being cut off.
const PICKER_COLUMN = '-mx-1 -mb-1 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-1 pb-1';

const toggle = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** What the add button says: "Add Sam O." or "Add 3 people". */
const addLabel = (picked, people) => {
  if (!picked.size) return 'Pick who to add';
  if (picked.size > 1) return `Add ${picked.size} people`;
  const one = people.find((p) => picked.has(p.id));
  return `Add ${one ? shortName(one.name) : '1 person'}`;
};

/**
 * Start a private chat: pick teammates, optionally name it (otherwise it's
 * everyone's names), optionally say something. `preselected`: the teammate
 * whose Message button brought you here.
 */
export function PrivateChatDialog({ open, onOpenChange, people, preselected, onSave }) {
  const [title, setTitle] = useState('');
  const [first, setFirst] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setFirst('');
      // Only someone in the list, so a pick can always be seen and taken off.
      setPicked(new Set(people.some((p) => p.id === preselected) ? [preselected] : []));
    }
    // Only when it opens, so the roster updating doesn't wipe what's picked.
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    if (!picked.size) return;
    setBusy(true);
    try {
      await onSave({ title: title.trim(), userIds: [...picked], first: first.trim() });
      onOpenChange(false);
    } catch {
      // onSave already said what went wrong; keep the dialog open to try again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No keyboard popping up over the list on phones. */}
      <DialogContent className={cn(DIALOG, 'flex flex-col')} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>New private chat</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 flex items-start gap-2 text-sm text-zinc-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Only the teammates you pick can see it. Captains can't either, unless you add them.
        </p>
        <form onSubmit={save} className={PICKER_COLUMN}>
          <span className={cn(EYEBROW, '-mb-2.5 flex items-center justify-between text-zinc-500')}>
            With
            {picked.size > 0 && <span className="text-zinc-950">{picked.size} picked</span>}
          </span>
          <PeoplePicker people={people} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
          <div className="space-y-1.5">
            <Label htmlFor="private-title" className={FIELD_LABEL}>
              Name (optional)
            </Label>
            <Input
              id="private-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder="🚗 Ride to Thursday's game"
              className="h-11 rounded-xl"
            />
            <p className="text-[11px] font-medium text-zinc-500">Leave it blank to name it after the people in it.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="private-first" className={FIELD_LABEL}>
              First message (optional)
            </Label>
            <Textarea
              id="private-first"
              rows={2}
              maxLength={2000}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="Say hi…"
              className="rounded-xl text-base"
            />
          </div>
          <Button type="submit" disabled={busy || !picked.size} className={BIG_BUTTON}>
            {busy ? 'Starting…' : 'Start chat'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Only the two of you can see it." */
function whoCanSee(n) {
  if (n === 1) return 'Only you can see it.';
  if (n === 2) return 'Only the two of you can see it.';
  return `Only these ${n} people can see it.`;
}

/**
 * Who's in a private chat. Anyone in it can add teammates (not while it's
 * closed) or leave; its starter can take people out.
 * `members`: [{ id, thread_id, user_id }] rows, or null when they didn't load;
 * `personOf(userId)`: { name, gender, captain }; `people`: everyone who could be added.
 */
export function PeopleDialog({ open, onOpenChange, thread, members, me, personOf, people, onAdd, onRemove, onLeave }) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAdding(false);
      setPicked(new Set());
    }
  }, [open]);

  if (!thread) return null;
  if (!members) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={DIALOG}>
          <DialogHeader className="text-left">
            <DialogTitle className={DIALOG_TITLE}>People in this chat</DialogTitle>
          </DialogHeader>
          <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
            Couldn't load who's in this chat. Check your signal, then close this and try again.
          </p>
        </DialogContent>
      </Dialog>
    );
  }
  const starter = thread.created_by === me;
  const inIt = new Set(members.map((m) => m.user_id));
  const addable = people.filter((p) => !inIt.has(p.id));
  const sorted = members
    .map((m) => ({ ...m, person: personOf(m.user_id) }))
    .sort((a, b) => (b.user_id === me) - (a.user_id === me) || a.person.name.localeCompare(b.person.name));

  const add = async () => {
    setBusy(true);
    try {
      await onAdd([...picked]);
      setAdding(false);
      setPicked(new Set());
    } catch {
      // onAdd already said what went wrong.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG, 'flex flex-col')} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>People in this chat</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 flex items-center gap-2 text-sm text-zinc-500">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {whoCanSee(members.length)}
        </p>

        {/* Out of the way while adding, so the names to pick from fit the screen. */}
        {!adding && (
          <ul aria-label="People in this chat" className="divide-y divide-zinc-100">
            {sorted.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <Avatar person={m.person} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">{m.person.name}</span>
                  {(m.user_id === me || m.user_id === thread.created_by || m.person.captain) && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {m.user_id === me && <span className={cn(PILL, 'bg-zinc-100 text-zinc-600')}>You</span>}
                      {m.user_id === thread.created_by && <span className={cn(PILL, 'bg-lime-400 text-black')}>Started it</span>}
                      {m.person.captain && <span className={cn(PILL, 'bg-zinc-950 text-lime-400')}>Captain</span>}
                    </span>
                  )}
                </div>
                {starter && m.user_id !== me && (
                  <button
                    type="button"
                    onClick={() => onRemove(m)}
                    aria-label={`Remove ${m.person.name}`}
                    className="shrink-0 rounded-full px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-red-700 underline-offset-2 transition hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {thread.archived ? (
          <p className="rounded-2xl bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-500">This chat is closed, so nobody can be added.</p>
        ) : adding ? (
          <div className={cn(PICKER_COLUMN, 'border-t border-zinc-100 pt-4')}>
            <span className={cn(EYEBROW, '-mb-1 block text-zinc-500')}>Add people</span>
            <PeoplePicker people={addable} picked={picked} onToggle={(id) => setPicked((set) => toggle(set, id))} />
            {addable.length > 0 && (
              <>
                <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                  They'll see the whole chat, earlier messages included.
                </p>
                <Button onClick={add} disabled={busy || !picked.size} className={BIG_BUTTON}>
                  {busy ? 'Adding…' : addLabel(picked, addable)}
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="block w-full text-center text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:text-zinc-900"
            >
              Cancel
            </button>
          </div>
        ) : (
          <Button onClick={() => setAdding(true)} className={BIG_BUTTON}>
            <UserPlus /> Add people
          </Button>
        )}

        {!adding && (
          <div className="border-t border-zinc-100 pt-4">
            <button
              type="button"
              onClick={onLeave}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 underline-offset-2 hover:underline"
            >
              <LogOut className="h-3.5 w-3.5" /> Leave chat
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Yes/no for removing a message or thread. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, busyLabel = 'Deleting…', onConfirm }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // onConfirm already said what went wrong.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG, 'sm:max-w-sm')} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-600">{body}</p>
        <div className="space-y-2">
          <Button variant="destructive" onClick={confirm} disabled={busy} className={BIG_BUTTON}>
            {busy ? busyLabel : confirmLabel}
          </Button>
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className="min-h-11 w-full text-xs font-bold uppercase tracking-wider text-zinc-600">Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Room actions on a phone use the same roomy window as the other chat controls. */
export function RoomMenuDialog({ open, onOpenChange, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG, 'sm:max-w-sm')} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left"><DialogTitle className={DIALOG_TITLE}>Chat options</DialogTitle></DialogHeader>
        <div className="space-y-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
