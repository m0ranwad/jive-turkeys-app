import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '@/api';
import { ProfileForm } from '@/components/ProfileForm';
import { signOut } from '@/lib/actions';
import { sameName } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const STEPS = [
  { eyebrow: 'Welcome', title: 'Everything in one place', body: 'Schedule, RSVPs, and stats in one place. Team Chat keeps the banter going.' },
  { eyebrow: 'Step 1', title: 'Keep your status current', body: 'Playing, Available to sub or Unavailable, on My Profile. Captains plan subs around it.' },
  { eyebrow: 'Step 2', title: 'RSVP every game', body: 'Tap IN, OUT, or MAYBE. Captains count on this to know if we need subs.' },
  { eyebrow: 'Step 3', title: 'After games', body: 'Check scores, stats, Player of the Match, and our record against every team.' },
  { eyebrow: 'Step 4', title: 'New to the complex?', body: 'Check the Field Rules tab. Indoor rules are different.' },
];

/**
 * New players go straight to their roster name and required details.
 * The introductory slides remain available on request under How to Use.
 */
export function Walkthrough({ open, needsProfile, profile, onClose }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Names on the roster nobody has picked yet; then the one this player picked
  // (undefined: not chosen yet, null: "I'm not on the list").
  const [names, setNames] = useState(null);
  const [pick, setPick] = useState(undefined);
  // "I'm not on the list", but the name they typed looks like one that is
  // ("Sam Ortiz" for "Sam O"), or like a player already on the site (a second
  // account, made by forgetting which email they used): their details, and the
  // names it looks like (`matches`) or the players (`accounts`).
  const [asking, setAsking] = useState(null);
  const [askError, setAskError] = useState('');
  const [players, setPlayers] = useState([]);
  // Their details again, after the name they typed turned out to be exactly someone else's (`taken`).
  const [retry, setRetry] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    if (!needsProfile) return;
    api.entities.TeamGuest.list('display_name')
      .then((rows) => setNames(rows.filter((g) => !g.removed && !g.linked_user_id)))
      .catch(() => setNames([]));
    api.entities.PlayerProfile.list()
      .then(setPlayers)
      .catch(() => setPlayers([]));
  }, [open, needsProfile]);

  if (!open) return null;

  const total = STEPS.length;
  const onProfileStep = needsProfile;
  const isLast = step === total - 1;

  const createProfile = async (values, chosen) => {
    setBusy(true);
    try {
      const me = await api.auth.me();
      await api.entities.PlayerProfile.create({ ...values, user_id: me.id, email: me.email, status: 'active' });
      if (chosen) {
        try {
          // Their roster status, dues payments and history become theirs.
          await api.users.claimGuest(chosen.id);
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

  const backToNames = () => {
    setPick(undefined);
    setAsking(null);
    setRetry(null);
  };

  // Someone on the team with exactly this name ("Josh" when there's already a Josh): teammates
  // couldn't tell them apart. The roster name being picked doesn't count; it becomes this player.
  const nameTakenBy = (name, chosen) => {
    const same = (other) => other.trim().toLowerCase() === name.trim().toLowerCase();
    return (
      players.find((p) => !p.removed && same(p.display_name))?.display_name ??
      (names || []).find((g) => g.id !== chosen?.id && same(g.display_name))?.display_name ??
      null
    );
  };

  const createOrRetry = async (values, chosen) => {
    const taken = nameTakenBy(values.display_name, chosen);
    if (!taken) return createProfile(values, chosen);
    setAsking(null);
    if (chosen) setPick(chosen);
    setRetry({ values, taken });
  };

  const submitProfile = async (values) => {
    const matches = pick ? [] : (names || []).filter((g) => sameName(values.display_name, g.display_name));
    const accounts = pick || matches.length ? [] : players.filter((p) => sameName(values.display_name, p.display_name));
    if (matches.length || accounts.length) {
      setAskError('');
      setAsking(matches.length ? { values, matches } : { values, accounts });
      return;
    }
    await createOrRetry(values, pick);
  };

  const answer = async (chosen) => {
    setAskError('');
    try {
      await createOrRetry(asking.values, chosen);
    } catch (err) {
      setAskError(err.message || "Couldn't save your profile.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="w-full max-w-md overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center justify-between px-6 pt-6">
          <span className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-lime-400 font-display text-[11px] font-black text-black">JT</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              {onProfileStep ? 'New player' : 'How to use'}
            </span>
          </span>
          {!onProfileStep && (
            <button
              onClick={() => onClose()}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 transition hover:text-zinc-900"
            >
              Skip
            </button>
          )}
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 pb-6 pt-5">
          {/* Each step fades and slides in (a CSS animation; no animation library to download). */}
          <div key={step} className="duration-200 ease-out animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none">
            {onProfileStep && names === null ? (
              <p className="py-10 text-center text-sm text-zinc-500">One moment…</p>
            ) : onProfileStep && names.length > 0 && pick === undefined ? (
              <div>
                <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight">Join the team</h2>
                <p className="mt-1.5 text-sm text-zinc-500">
                  Find your name. Your roster spot and payments will come with you.
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
                      <ChevronRight className="h-4 w-4 text-zinc-500" />
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
                <p className="mt-4 text-center text-xs text-zinc-500">
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
                    You're joining as <b className="text-zinc-900">{pick.display_name}</b>. Confirm your details.{' '}
                    <button type="button" onClick={backToNames} className="font-semibold text-zinc-700 underline underline-offset-2">
                      Not you?
                    </button>
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-zinc-500">
                    Name and gender are for coed headcounts. A phone number is optional; it lets captains tap to call
                    you. Everything else is in My Profile.
                    {names.length > 0 && (
                      <>
                        {' '}
                        <button type="button" onClick={backToNames} className="font-semibold text-zinc-700 underline underline-offset-2">
                          Back to the names
                        </button>
                      </>
                    )}
                  </p>
                )}
                {asking?.accounts ? (
                  <div className="mt-5 space-y-3 rounded-2xl bg-amber-50 p-4" data-testid="already-on-site">
                    <p className="text-sm font-bold text-amber-950">Already on the site?</p>
                    <p className="text-sm text-amber-900">
                      {asking.accounts.map((p) => p.display_name).join(' and ')}{' '}
                      {asking.accounts.length === 1 ? 'has' : 'have'} an account here already. If that's you, sign out
                      and sign in the way you did before (with Google, or the email you used), so your stats and dues
                      stay in one place.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={signOut}
                      className="h-12 w-full rounded-2xl bg-zinc-950 text-sm font-bold uppercase tracking-[0.1em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Sign out and use my other account
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => answer(null)}
                      className="h-11 w-full rounded-2xl border-2 border-zinc-200 bg-white text-sm font-bold text-zinc-700 transition hover:border-zinc-300 disabled:opacity-50"
                    >
                      No, that's someone else
                    </button>
                    {askError && <p className="text-xs font-semibold text-red-700">{askError}</p>}
                  </div>
                ) : asking ? (
                  <div className="mt-5 space-y-3 rounded-2xl bg-amber-50 p-4" data-testid="is-that-you">
                    <p className="text-sm font-bold text-amber-950">Is that you on the roster?</p>
                    <p className="text-sm text-amber-900">
                      Your captain put {asking.matches.map((g) => g.display_name).join(' and ')} on the roster. If that's
                      you, your spot and dues come with you, and you keep the name {asking.values.display_name}.
                    </p>
                    {asking.matches.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        disabled={busy}
                        onClick={() => answer(g)}
                        className="h-12 w-full rounded-2xl bg-zinc-950 text-sm font-bold uppercase tracking-[0.1em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
                      >
                        Yes, I'm {g.display_name}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => answer(null)}
                      className="h-11 w-full rounded-2xl border-2 border-zinc-200 bg-white text-sm font-bold text-zinc-700 transition hover:border-zinc-300 disabled:opacity-50"
                    >
                      No, that's someone else
                    </button>
                    {askError && <p className="text-xs font-semibold text-red-700">{askError}</p>}
                  </div>
                ) : (
                  <div className="mt-5">
                    {retry && (
                      <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-950" role="alert" data-testid="name-taken">
                        There's already a {retry.taken} on the team. Add your last name or an initial so teammates can tell
                        you apart.
                      </p>
                    )}
                    <ProfileForm
                      key={retry ? 'retry' : pick?.id || 'new'}
                      initial={
                        retry ? retry.values : pick ? { display_name: pick.display_name, gender: pick.gender, position: pick.position } : profile
                      }
                      onSubmit={submitProfile}
                      submitLabel="Start using the app"
                      busy={busy}
                      hidePosition
                      hideYearJoined
                    />
                  </div>
                )}
                <p className="mt-4 text-center text-xs text-zinc-500">
                  Wrong account?{' '}
                  <button type="button" onClick={signOut} className="font-semibold text-zinc-600 underline underline-offset-2">
                    Sign out
                  </button>
                </p>
              </div>
            ) : (
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-lime-700">{STEPS[step].eyebrow}</span>
                <h2 className="mt-2 font-display text-3xl font-extrabold uppercase leading-[1.05] tracking-tight">
                  {STEPS[step].title}
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">{STEPS[step].body}</p>
              </div>
            )}
          </div>
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
