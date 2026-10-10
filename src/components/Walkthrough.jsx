import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { api } from '@/api';
import { ProfileForm } from '@/components/ProfileForm';
import { signOut } from '@/lib/actions';
import { cn } from '@/lib/utils';

const STEPS = [
  { eyebrow: 'Welcome', title: 'Everything in one place', body: 'Schedule, RSVPs, and stats in one place. Team Chat keeps the banter going.' },
  { eyebrow: 'Step 1', title: 'Set up your profile', body: 'Name and gender, plus optional phone and the year you joined.' },
  { eyebrow: 'Step 2', title: 'RSVP every game', body: 'Tap IN, OUT, or MAYBE. Captains count on this to know if we need subs.' },
  { eyebrow: 'Step 3', title: 'After games', body: 'Check scores, stats, Player of the Match, and our record against every team.' },
  { eyebrow: 'Step 4', title: 'New to the complex?', body: 'Check the Field Rules tab. Indoor rules are different.' },
];

/**
 * "How to use" slides. A new player can't skip the last step: it creates their
 * profile, which is what puts them on the team.
 */
export function Walkthrough({ open, needsProfile, profile, onClose }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Names on the roster nobody has picked yet; then the one this player picked
  // (undefined: not chosen yet, null: "I'm not on the list").
  const [names, setNames] = useState(null);
  const [pick, setPick] = useState(undefined);

  useEffect(() => {
    if (!open || !needsProfile) return;
    api.entities.TeamGuest.list('display_name')
      .then((rows) => setNames(rows.filter((g) => !g.removed && !g.linked_user_id)))
      .catch(() => setNames([]));
  }, [open, needsProfile]);

  if (!open) return null;

  const total = STEPS.length + (needsProfile ? 1 : 0);
  const onProfileStep = needsProfile && step === STEPS.length;
  const isLast = step === total - 1;

  const createProfile = async (values) => {
    setBusy(true);
    try {
      const me = await api.auth.me();
      await api.entities.PlayerProfile.create({ ...values, user_id: me.id, email: me.email, status: 'active' });
      if (pick) {
        try {
          // Their roster status, dues payments and history become theirs.
          await api.users.claimGuest(pick.id);
        } catch {
          // Someone picked it first: they're still on the team, and a captain can link them.
        }
      }
      onClose();
      // Every page holds its own copy of the roster; start fresh with the new profile.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="w-full max-w-md overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center justify-between px-6 pt-6">
          <span className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-lime-400 font-display text-[11px] font-black text-black">JT</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
              {onProfileStep ? 'New player' : 'How to use'}
            </span>
          </span>
          {!onProfileStep && (
            <button
              onClick={() => (needsProfile ? setStep(STEPS.length) : onClose())}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-zinc-900"
            >
              Skip
            </button>
          )}
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 pb-6 pt-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {onProfileStep && names === null ? (
                <p className="py-10 text-center text-sm text-zinc-400">One moment…</p>
              ) : onProfileStep && names.length > 0 && pick === undefined ? (
                <div>
                  <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight">Join the team</h2>
                  <p className="mt-1.5 text-sm text-zinc-500">
                    Find your name. Your captain already put you on the roster, so your spot and your dues are waiting
                    for you.
                  </p>
                  <div className="mt-4 grid gap-2">
                    {names.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPick(g)}
                        className="flex items-center justify-between rounded-2xl border-2 border-dashed border-zinc-300 px-4 py-3 text-left text-sm font-bold transition hover:border-zinc-900"
                      >
                        {g.display_name}
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPick(null)}
                    className="mt-4 w-full text-center text-sm font-semibold text-zinc-500 underline underline-offset-2"
                  >
                    I'm not on the list
                  </button>
                  <p className="mt-4 text-center text-xs text-zinc-400">
                    Wrong account?{' '}
                    <button type="button" onClick={signOut} className="font-semibold text-zinc-600 underline underline-offset-2">
                      Sign out
                    </button>
                  </p>
                </div>
              ) : onProfileStep ? (
                <div>
                  <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight">Join the team</h2>
                  {pick ? (
                    <p className="mt-1.5 text-sm text-zinc-500">
                      You're joining as <b className="text-zinc-900">{pick.display_name}</b>. Check your details: your roster
                      spot and dues come with you.{' '}
                      <button type="button" onClick={() => setPick(undefined)} className="font-semibold text-zinc-700 underline underline-offset-2">
                        Not you?
                      </button>
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm text-zinc-500">
                      Set up your profile to get on the roster and into game headcounts. Name and gender are required.
                      Everything else is optional, and you can pick your position later on the Team tab.
                      {names.length > 0 && (
                        <>
                          {' '}
                          <button type="button" onClick={() => setPick(undefined)} className="font-semibold text-zinc-700 underline underline-offset-2">
                            Back to the names
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  <div className="mt-5">
                    <ProfileForm
                      key={pick?.id || 'new'}
                      initial={pick ? { display_name: pick.display_name, gender: pick.gender, position: pick.position } : profile}
                      onSubmit={createProfile}
                      submitLabel="Start using the app"
                      busy={busy}
                      hidePosition
                    />
                  </div>
                  <p className="mt-4 text-center text-xs text-zinc-400">
                    Wrong account?{' '}
                    <button type="button" onClick={signOut} className="font-semibold text-zinc-600 underline underline-offset-2">
                      Sign out
                    </button>
                  </p>
                </div>
              ) : (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-lime-600">{STEPS[step].eyebrow}</span>
                  <h2 className="mt-2 font-display text-3xl font-extrabold uppercase leading-[1.05] tracking-tight">
                    {STEPS[step].title}
                  </h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">{STEPS[step].body}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {!onProfileStep && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: total }).map((_, i) => (
                <span
                  key={i}
                  className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-lime-400' : 'w-1.5 bg-zinc-200')}
                />
              ))}
            </div>
            <button
              onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white transition hover:bg-zinc-800"
            >
              {isLast ? 'Got it' : 'Next'}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
