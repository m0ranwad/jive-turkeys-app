import { useEffect, useState } from 'react';
import { MapPin, Pencil } from 'lucide-react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { CardsExplainer, GameDayChecklist, ThreeLineDiagram } from '@/components/rules/RuleVisuals';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { saveTeamSettings } from '@/lib/actions';
import { CARD, DEFAULT_SETTINGS } from '@/lib/constants';
import { mapsUrl } from '@/lib/format';
import { groupRules, isCardsRule, isThreeLineRule } from '@/lib/rules';
import { cn } from '@/lib/utils';

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
            <p className="text-xs text-zinc-500">
              To start a section, type its name on its own line ending with a colon, like “Coed rules:”.
            </p>
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

/** Which rules get a picture under them: the first one about cards and the first about the three-line rule. */
function pictureSpots(sections) {
  const spots = {};
  const place = (test, kind) => {
    for (const [si, section] of sections.entries()) {
      const ri = section.rules.findIndex(test);
      if (ri >= 0) {
        spots[`${si}-${ri}`] = kind;
        return;
      }
    }
  };
  place(isCardsRule, 'cards');
  place(isThreeLineRule, 'three-line');
  return spots;
}

function RuleList({ rules, sectionIndex, spots, dark }) {
  return (
    <ul className="space-y-3">
      {rules.map((rule, i) => {
        const picture = spots[`${sectionIndex}-${i}`];
        return (
          <li key={i} className={cn('flex gap-2.5 text-sm leading-relaxed', dark ? 'text-zinc-200' : 'text-zinc-600')}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400" />
            <div className="min-w-0 flex-1">
              {rule}
              {picture === 'cards' && <CardsExplainer />}
              {picture === 'three-line' && <ThreeLineDiagram />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const sectionId = (i) => `rules-section-${i}`;

export function RulesPage() {
  const { settings, isCaptain, loading, reload } = useTeam();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);

  if (loading) return <PageSpinner />;
  const s = settings || DEFAULT_SETTINGS;
  const venueName = s.venue_name || DEFAULT_SETTINGS.venue_name;
  const quickHits = s.quick_hits || [];
  const sections = groupRules(s.rules_bullets || []);
  const titled = sections.map((section, i) => ({ ...section, i })).filter((section) => section.title);
  const spots = pictureSpots(sections);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <PageHeader title="Field Rules" subtitle={`${venueName}.`}>
          {isCaptain && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit rules
            </button>
          )}
        </PageHeader>

        <a
          href={mapsUrl([venueName, s.venue_address].filter(Boolean).join(', '))}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-2xl border border-black/5 bg-white px-3.5 py-3 text-xs font-semibold text-zinc-600 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:bg-zinc-50"
        >
          <MapPin className="h-4 w-4 shrink-0 text-lime-600" />
          <span className="min-w-0 flex-1 truncate">{s.venue_address || venueName}</span>
          <span className="shrink-0 font-bold uppercase tracking-[0.1em] text-zinc-900">Directions</span>
        </a>
      </div>

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

      <GameDayChecklist settings={s} />

      <section className={CARD}>
        {s.rules_intro && (
          <h2 className="font-display text-base font-extrabold uppercase tracking-[0.1em]">{s.rules_intro}</h2>
        )}
        {titled.length >= 2 && (
          <nav aria-label="Rule sections" className="mt-3 flex flex-wrap gap-1.5">
            {titled.map((section) => (
              <button
                key={section.i}
                type="button"
                onClick={() =>
                  document.getElementById(sectionId(section.i))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                className={cn(
                  'rounded-full px-3 py-1.5 text-[11px] font-bold transition',
                  section.coed
                    ? 'bg-zinc-950 text-lime-400 hover:bg-zinc-800'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
                )}
              >
                {section.title}
              </button>
            ))}
          </nav>
        )}
        <div className="mt-4 space-y-6">
          {sections.map((section, i) => (
            <div
              key={i}
              id={sectionId(i)}
              role={section.title ? 'region' : undefined}
              aria-label={section.title || undefined}
              className={cn('scroll-mt-24', section.coed && 'rounded-2xl bg-zinc-950 p-4')}
            >
              {section.title && (
                <h3
                  className={cn(
                    'mb-3 flex items-center gap-2 font-display text-[13px] font-extrabold uppercase tracking-[0.14em]',
                    section.coed ? 'text-lime-400' : 'text-zinc-900',
                  )}
                >
                  {!section.coed && <span className="h-3.5 w-1 shrink-0 rounded-full bg-lime-400" />}
                  {section.title}
                </h3>
              )}
              <RuleList rules={section.rules} sectionIndex={i} spots={spots} dark={section.coed} />
            </div>
          ))}
          {sections.length === 0 && <p className="text-sm text-zinc-400">No rules posted yet.</p>}
        </div>
        {s.rules_footer && (
          <p className="mt-5 border-t border-zinc-100 pt-3 text-xs font-medium italic leading-relaxed text-zinc-500">
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
