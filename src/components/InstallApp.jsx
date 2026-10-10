import { useEffect, useState } from 'react';
import { EllipsisVertical, Share, Smartphone, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { canPromptInstall, isInstalled, onInstallChange, phoneKind, promptInstall } from '@/lib/install';

const DISMISSED_KEY = 'jt_install_card_dismissed';

function readDismissed() {
  try {
    return !!localStorage.getItem(DISMISSED_KEY);
  } catch {
    return false;
  }
}

/** Whether this is a phone browser that could add the site to its Home Screen. */
export function useInstall() {
  const [state, setState] = useState(() => ({ kind: phoneKind(), installed: isInstalled(), canPrompt: canPromptInstall() }));
  useEffect(
    () => onInstallChange(() => setState({ kind: phoneKind(), installed: isInstalled(), canPrompt: canPromptInstall() })),
    [],
  );
  return { ...state, offer: !!state.kind && !state.installed };
}

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime-400 text-xs font-black text-black">{n}</span>
      <span className="pt-0.5 text-sm leading-relaxed text-zinc-700">{children}</span>
    </li>
  );
}

const Inline = ({ icon: Icon }) => <Icon className="mx-0.5 inline h-4 w-4 -translate-y-px text-zinc-900" aria-hidden="true" />;

/** Step-by-step "Add to Home Screen" for iPhone and Android. */
export function InstallGuide({ open, onOpenChange }) {
  const { kind, canPrompt } = useInstall();

  const install = async () => {
    if (await promptInstall()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">
            Add to your Home Screen
          </DialogTitle>
          <p className="text-sm text-zinc-500">
            Jive Turkeys gets an icon next to your apps and opens full screen, without the browser bars.
          </p>
        </DialogHeader>

        {kind === 'ios' && (
          <>
            <ol className="space-y-3">
              <Step n={1}>
                Tap the <b>Share</b> button <Inline icon={Share} /> at the bottom of Safari (in Chrome it's at the top right).
              </Step>
              <Step n={2}>
                Scroll down and tap <b>Add to Home Screen</b> <Inline icon={SquarePlus} />.
              </Step>
              <Step n={3}>
                Tap <b>Add</b>.
              </Step>
            </ol>
            <p className="rounded-2xl bg-zinc-50 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-500">
              Then open Jive Turkeys from your Home Screen and sign in once more. iPhones keep the Home Screen app's sign-in
              separate from Safari's.
            </p>
          </>
        )}

        {kind === 'android' &&
          (canPrompt ? (
            <Button onClick={install} className="h-11 w-full font-semibold">
              <Smartphone /> Install Jive Turkeys
            </Button>
          ) : (
            <ol className="space-y-3">
              <Step n={1}>
                Tap the menu <Inline icon={EllipsisVertical} /> at the top right of Chrome.
              </Step>
              <Step n={2}>
                Tap <b>Add to Home screen</b> (or <b>Install app</b>).
              </Step>
              <Step n={3}>
                Tap <b>Install</b> or <b>Add</b>.
              </Step>
            </ol>
          ))}

        {!kind && <p className="text-sm text-zinc-600">Open jiveturkeys.app on your phone, then choose Add to Home Screen.</p>}
      </DialogContent>
    </Dialog>
  );
}

/** A one-time card on the Schedule page for phone players who haven't added the site yet. */
export function InstallCard({ onShowHow }) {
  const { offer } = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!offer || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: it shows again next time.
    }
    setDismissed(true);
  };

  return (
    <section
      aria-label="Add to Home Screen"
      className="mb-5 flex items-center gap-3 rounded-3xl bg-zinc-950 p-3.5 pr-2 text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <img src="/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-extrabold uppercase tracking-tight">Get the app</p>
        <p className="mt-0.5 text-xs leading-snug text-white/60">Add Jive Turkeys to your Home Screen. It opens like an app.</p>
      </div>
      <button
        onClick={onShowHow}
        className="shrink-0 rounded-full bg-lime-400 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-black transition hover:bg-lime-300"
      >
        How
      </button>
      <button
        onClick={dismiss}
        aria-label="Not now"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}
