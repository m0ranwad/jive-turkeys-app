import { useEffect, useState } from 'react';
import { api } from '@/api';
import { DIALOG, DIALOG_TITLE, EYEBROW } from '@/components/dues/DuesParts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { POSITIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const SECTION = 'space-y-2 border-t border-zinc-100 pt-4';
const FIELD_LABEL = 'text-xs font-semibold text-zinc-500';
const BIG_BUTTON = 'h-12 w-full rounded-2xl text-sm font-bold uppercase tracking-[0.1em]';
const SELECT = 'h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-zinc-900';

/** Name, man / woman (for the coed counts) and position. */
function GuestFields({ form, setForm }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="guest-name" className={FIELD_LABEL}>
          Name
        </Label>
        <Input
          id="guest-name"
          value={form.display_name}
          onChange={(e) => set({ display_name: e.target.value })}
          placeholder="First and last name"
          maxLength={60}
          autoComplete="off"
          className="h-11 rounded-xl"
        />
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Man or woman">
        {[
          { v: 'M', l: 'Man' },
          { v: 'F', l: 'Woman' },
        ].map((opt) => (
          <button
            key={opt.v}
            type="button"
            aria-pressed={form.gender === opt.v}
            onClick={() => set({ gender: form.gender === opt.v ? null : opt.v })}
            className={cn(
              'rounded-2xl border-2 py-2.5 text-xs font-bold uppercase tracking-[0.06em] transition',
              form.gender === opt.v ? 'border-black bg-lime-400 text-black' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300',
            )}
          >
            {opt.l}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="guest-position" className={FIELD_LABEL}>
          Position
        </Label>
        <select id="guest-position" value={form.position || ''} onChange={(e) => set({ position: e.target.value || null })} className={SELECT}>
          <option value="">Floater</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Captains: add a teammate who isn't on the app (or bring back one who was
 * removed), or, with `guest`, edit one: details, moving them to the account
 * they joined with, or taking them off the team. Those last two ask first.
 */
export function GuestDialog({ open, onOpenChange, guest, guests, appPlayers, meId, onChanged }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ display_name: '', gender: null, position: null });
  const [linkTo, setLinkTo] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ display_name: guest?.display_name || '', gender: guest?.gender ?? null, position: guest?.position ?? null });
      setLinkTo('');
      setConfirm(null);
    }
    // Only when it opens, so a reload behind it doesn't wipe what's typed.
  }, [open]);

  const run = async (work, done, description) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      onOpenChange(false);
      toast({ title: done, description });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const fields = { display_name: form.display_name.trim(), gender: form.gender, position: form.position };
  const removed = (guests || []).filter((g) => g.removed && !g.linked_user_id);
  const linkName = appPlayers.find((p) => p.user_id === linkTo)?.display_name;

  const confirmBox = (text, label, action) => (
    <div className="space-y-3 rounded-2xl bg-red-50 p-4" role="alert">
      <p className="text-sm text-red-900">{text}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setConfirm(null)} className="h-11 rounded-xl bg-white font-bold">
          Cancel
        </Button>
        <Button variant="destructive" onClick={action} disabled={busy} className="h-11 rounded-xl font-bold">
          {label}
        </Button>
      </div>
    </div>
  );

  if (!guest) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={DIALOG}>
          <DialogHeader className="text-left">
            <DialogTitle className={DIALOG_TITLE}>Add teammate not on the app</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-zinc-500">
            For teammates who won't use the app. They're on the roster with everyone else, count in the dues while
            Active, and anyone can mark them paid.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!fields.display_name) return;
              run(
                () => api.entities.TeamGuest.create({ ...fields, status: 'active', removed: false, created_by: meId }),
                `${fields.display_name} added to the team`,
              );
            }}
            className="space-y-4"
          >
            <GuestFields form={form} setForm={setForm} />
            <Button type="submit" disabled={busy || !fields.display_name} className={BIG_BUTTON}>
              Add to the team
            </Button>
          </form>
          {removed.length > 0 && (
            <div className={SECTION}>
              <span className={cn(EYEBROW, 'block text-zinc-400')}>Removed earlier</span>
              {removed.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{g.display_name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(() => api.entities.TeamGuest.update(g.id, { removed: false, status: 'active' }), `${g.display_name} added back`)
                    }
                    className="rounded-full font-bold"
                  >
                    Add back
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{guest.display_name}</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-zinc-500">Not on the app. Their roster status is on their card.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!fields.display_name) return;
            run(() => api.entities.TeamGuest.update(guest.id, fields), 'Saved');
          }}
          className="space-y-4"
        >
          <GuestFields form={form} setForm={setForm} />
          <Button type="submit" disabled={busy || !fields.display_name} className={BIG_BUTTON}>
            Save
          </Button>
        </form>

        <div className={SECTION}>
          <Label htmlFor="guest-link" className={FIELD_LABEL}>
            Joined the app?
          </Label>
          <div className="flex gap-2">
            <select
              id="guest-link"
              value={linkTo}
              onChange={(e) => {
                setLinkTo(e.target.value);
                setConfirm(null);
              }}
              className={cn(SELECT, 'min-w-0 flex-1')}
            >
              <option value="">Pick their account</option>
              {appPlayers.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setConfirm('link')} disabled={busy || !linkTo} className="h-11 rounded-xl font-bold">
              Move
            </Button>
          </div>
          {confirm === 'link' &&
            confirmBox(
              `${guest.display_name}'s dues payments and history move to ${linkName}'s account, and ${guest.display_name} leaves the roster.`,
              'Move them',
              () =>
                run(() => api.users.linkGuest(guest.id, linkTo), `${guest.display_name} moved to ${linkName}'s account`),
            )}
        </div>

        <div className={SECTION}>
          {confirm !== 'remove' ? (
            <button type="button" onClick={() => setConfirm('remove')} className="text-xs font-bold text-red-700 underline underline-offset-2">
              Remove from the team
            </button>
          ) : (
            confirmBox(
              `${guest.display_name} comes off the roster and out of the dues split, so everyone else's share goes up. Their payments stay in the history, and you can add them back.`,
              'Remove',
              () => run(() => api.entities.TeamGuest.update(guest.id, { removed: true }), `${guest.display_name} removed from the team`),
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
