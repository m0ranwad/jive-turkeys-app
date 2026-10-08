import { useRef, useState } from 'react';
import { LoaderCircle, Plus, Upload, X } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { venueText } from '@/lib/format';
import { parseScheduleFile } from '@/lib/schedule-import';
import { cn } from '@/lib/utils';
import { SessionPicker } from './SessionPicker';

const isDuplicate = (row, games) =>
  games.some(
    (g) => g.date === row.date && (g.opponent || '').trim().toLowerCase() === (row.opponent || '').trim().toLowerCase(),
  );

export function ImportScheduleDialog({ open, onOpenChange, settings, existingGames, onDone }) {
  const [step, setStep] = useState('pick');
  const [year, setYear] = useState(new Date().getFullYear());
  const [session, setSession] = useState(1);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);

  const reset = () => {
    setStep('pick');
    setRows([]);
    setMessage('');
    setBusy(false);
  };
  const handleOpenChange = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const readFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const games = await parseScheduleFile(file, Number(year));
      if (!games.length) {
        setMessage("Couldn't find any games in that file. Try another file, or add rows manually.");
      }
      setRows(games.map((g, i) => ({ key: `${Date.now()}-${i}`, ...g })));
      setStep('preview');
    } catch {
      setMessage("That file couldn't be read. Try an .xlsx or .csv export of the schedule.");
      setStep('preview');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const updateRow = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setRows((list) => list.filter((r) => r.key !== key));
  const addRow = () =>
    setRows((list) => [...list, { key: `manual-${Date.now()}`, date: '', time: '', field_number: '', opponent: '' }]);

  const ready = rows.filter((r) => r.date && r.opponent.trim());
  const duplicates = ready.filter((r) => isDuplicate(r, existingGames)).length;

  const confirm = async () => {
    setBusy(true);
    try {
      await api.entities.Game.bulkCreate(
        ready.map((r) => ({
          season_year: Number(year),
          session: Number(session),
          date: r.date,
          time: r.time,
          field_number: r.field_number,
          opponent: r.opponent.trim(),
          location: venueText(settings),
          jersey: 'primary',
        })),
      );
      await onDone(ready.length);
      handleOpenChange(false);
    } catch (err) {
      setMessage(err.message || "Couldn't save those games.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Import schedule</DialogTitle>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Season year</Label>
                <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Session</Label>
                <SessionPicker value={session} onChange={setSession} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 transition hover:border-lime-400 hover:bg-lime-50/40"
            >
              {busy ? (
                <LoaderCircle className="h-7 w-7 animate-spin text-zinc-400" />
              ) : (
                <Upload className="h-7 w-7 text-zinc-400" />
              )}
              <span className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
                {busy ? 'Reading schedule…' : 'Upload .xlsx or .csv'}
              </span>
              <span className="max-w-xs text-center text-xs font-medium text-zinc-500">
                We'll pull out date, time, field number and opponent — even if the columns are named differently.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
            {message && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{message}</p>}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-600">
                {ready.length} row{ready.length === 1 ? '' : 's'} ready for {year} · Session {session}
              </p>
              {duplicates > 0 && (
                <span className="rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-black">
                  {duplicates} possible duplicate{duplicates === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {message && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">{message}</p>}
            <div className="space-y-3">
              {rows.map((row) => {
                const dupe = row.date && row.opponent && isDuplicate(row, existingGames);
                const incomplete = !row.date || !row.opponent.trim();
                return (
                  <div
                    key={row.key}
                    className={cn(
                      'rounded-2xl border-2 p-3',
                      incomplete ? 'border-red-200 bg-red-50/40' : dupe ? 'border-amber-300 bg-amber-50/50' : 'border-zinc-100 bg-white',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                        {dupe ? 'Possible duplicate' : incomplete ? 'Needs fixing' : 'Ready'}
                      </span>
                      <button
                        onClick={() => removeRow(row.key)}
                        className="text-zinc-400 transition hover:text-red-600"
                        aria-label="Remove row"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} />
                      <Input type="time" value={row.time} onChange={(e) => updateRow(row.key, { time: e.target.value })} />
                      <Input
                        value={row.opponent}
                        placeholder="Opponent"
                        onChange={(e) => updateRow(row.key, { opponent: e.target.value })}
                      />
                      <Input
                        value={row.field_number}
                        placeholder="Field #"
                        onChange={(e) => updateRow(row.key, { field_number: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" onClick={addRow} className="w-full">
              <Plus className="mr-1.5 h-4 w-4" /> Add a row
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'preview' && (
            <Button variant="outline" onClick={reset}>
              Choose another file
            </Button>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {step === 'preview' && (
            <Button onClick={confirm} disabled={busy || ready.length === 0}>
              {busy ? 'Saving…' : `Confirm ${ready.length} game${ready.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
