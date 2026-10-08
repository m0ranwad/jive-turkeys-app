import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { saveTeamSettings } from '@/lib/actions';
import { CARD, DEFAULT_SETTINGS } from '@/lib/constants';

const toLines = (list) => (list || []).join('\n');
const fromLines = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

function EditRulesDialog({ open, onOpenChange, settings, onSave }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      rules_intro: settings?.rules_intro || '',
      quick_hits_text: toLines(settings?.quick_hits),
      bullets_text: toLines(settings?.rules_bullets),
      rules_footer: settings?.rules_footer || '',
    });
  }, [open, settings]);

  if (!open || !form) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        rules_intro: form.rules_intro,
        quick_hits: fromLines(form.quick_hits_text),
        rules_bullets: fromLines(form.bullets_text),
        rules_footer: form.rules_footer,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Edit field rules</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Page headline</Label>
            <Input value={form.rules_intro} onChange={(e) => set({ rules_intro: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Quick hits (one per line)</Label>
            <Textarea rows={6} value={form.quick_hits_text} onChange={(e) => set({ quick_hits_text: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Full rules (one rule per line)</Label>
            <Textarea rows={16} value={form.bullets_text} onChange={(e) => set({ bullets_text: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Footer</Label>
            <Textarea rows={2} value={form.rules_footer} onChange={(e) => set({ rules_footer: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save rules'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RulesPage() {
  const { settings, isCaptain, loading, reload } = useTeam();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  if (loading) return <PageSpinner />;
  const s = settings || DEFAULT_SETTINGS;
  const quickHits = s.quick_hits || [];
  const bullets = s.rules_bullets || [];

  return (
    <div className="space-y-5">
      <PageHeader title="Field Rules" subtitle={`${s.venue_name || DEFAULT_SETTINGS.venue_name}.`}>
        {isCaptain && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit rules
          </button>
        )}
      </PageHeader>

      <section className="overflow-hidden rounded-3xl bg-lime-400 text-black">
        <div className="px-5 pb-5 pt-4">
          <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.18em]">Quick hits</h2>
          <ul className="mt-3 space-y-2">
            {quickHits.map((hit, i) => (
              <li key={i} className="flex gap-2.5 text-sm font-semibold leading-snug">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-black" />
                {hit}
              </li>
            ))}
            {quickHits.length === 0 && <li className="text-sm font-medium text-black/60">No quick hits yet.</li>}
          </ul>
        </div>
      </section>

      <section className={CARD}>
        {s.rules_intro && (
          <h2 className="font-display text-base font-extrabold uppercase tracking-[0.1em]">{s.rules_intro}</h2>
        )}
        <ul className="mt-3 space-y-3">
          {bullets.map((rule, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-zinc-600">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400" />
              {rule}
            </li>
          ))}
          {bullets.length === 0 && <li className="text-sm text-zinc-400">No rules posted yet.</li>}
        </ul>
        {s.rules_footer && (
          <p className="mt-4 border-t border-zinc-100 pt-3 text-xs font-medium italic leading-relaxed text-zinc-500">
            {s.rules_footer}
          </p>
        )}
      </section>

      <EditRulesDialog
        open={editing}
        onOpenChange={setEditing}
        settings={s}
        onSave={async (patch) => {
          await saveTeamSettings(patch);
          await reload();
          toast({ title: 'Rules updated' });
        }}
      />
    </div>
  );
}
