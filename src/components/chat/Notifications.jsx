import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, X } from 'lucide-react';
import { isDemo } from '@/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { phoneKind } from '@/lib/install';
import { pushState, sendTestPush, turnOffPush, turnOnPush } from '@/lib/push';
import { cn } from '@/lib/utils';

const PROMPT_KEY = 'jt_push_prompt_dismissed';
const CHANGED = 'jt:push-changed';

/** Opens the Home Screen guide (it lives in the site frame). */
export const showInstallGuide = () => window.dispatchEvent(new Event('jt:show-install'));

/** This device's notification state, kept in sync across the bell, the card and the dialog. */
export function usePush() {
  const [state, setState] = useState(null);
  const refresh = useCallback(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);
  return state;
}

function useTurnOn() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await turnOnPush();
      if (next === 'on') toast({ title: 'Notifications are on', description: 'For new chat messages, on this device.' });
      if (next === 'blocked')
        toast({ title: 'Notifications are blocked', description: 'Allow them in your settings, then try again.' });
    } catch (err) {
      toast({ title: "Couldn't turn on notifications", description: err.message });
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event(CHANGED));
    }
  };
  return { busy, turnOn };
}

/** The bell in the chat header: shows whether notifications are on, and opens the settings. */
export function NotificationsButton({ state, onClick }) {
  const Icon = state === 'on' ? BellRing : state === 'blocked' ? BellOff : Bell;
  return (
    <button
      onClick={onClick}
      aria-label={state === 'on' ? 'Notifications: on' : 'Notifications: off'}
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-zinc-100',
        state === 'on' ? 'text-lime-600' : 'text-zinc-400',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function readDismissed() {
  try {
    return !!localStorage.getItem(PROMPT_KEY);
  } catch {
    return false;
  }
}

/** A one-time card in the chat offering notifications (or, on iPhone, the Home Screen first). */
export function NotificationsPrompt({ state }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const { busy, turnOn } = useTurnOn();
  if (dismissed || (state !== 'off' && state !== 'needs-install')) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(PROMPT_KEY, '1');
    } catch {
      // Private mode: it shows again next time.
    }
    setDismissed(true);
  };

  return (
    <section
      aria-label="Chat notifications"
      className="flex items-center gap-3 border-b border-black/5 bg-zinc-950 px-4 py-2.5 text-white"
    >
      <BellRing className="h-5 w-5 shrink-0 text-lime-400" />
      <p className="min-w-0 flex-1 text-xs font-medium leading-snug text-white/80">
        {state === 'needs-install'
          ? 'Want notifications? On iPhone, add Jive Turkeys to your Home Screen first.'
          : 'Get a notification when someone posts.'}
      </p>
      {state === 'needs-install' ? (
        <button
          onClick={showInstallGuide}
          className="shrink-0 rounded-full bg-lime-400 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-black transition hover:bg-lime-300"
        >
          How
        </button>
      ) : (
        <button
          onClick={turnOn}
          disabled={busy}
          className="shrink-0 rounded-full bg-lime-400 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-black transition hover:bg-lime-300 disabled:opacity-60"
        >
          Turn on
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Not now"
        className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}

const BLOCKED_HELP = {
  ios: 'On your iPhone, open Settings → Notifications → Jive Turkeys, and turn on Allow Notifications. Then come back here.',
  android:
    'In Chrome, tap ⋮ → Settings → Notifications (or the icon next to the address), and allow jiveturkeys.app. Then come back here.',
  other: "Click the icon next to the site's address and allow notifications. Then come back here.",
};

/** Settings for this device: turn on or off, send a test, or what to do when blocked. */
export function NotificationsDialog({ open, onOpenChange, state }) {
  const { toast } = useToast();
  const { busy, turnOn } = useTurnOn();
  const [working, setWorking] = useState(false);

  const run = async (fn) => {
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
      window.dispatchEvent(new Event(CHANGED));
    }
  };

  const test = () =>
    run(async () => {
      try {
        const result = await sendTestPush();
        toast(
          result.sent
            ? { title: 'Test sent', description: 'It should appear in a few seconds.' }
            : { title: "Couldn't send a test", description: 'Try turning notifications off and on again.' },
        );
      } catch (err) {
        toast({ title: "Couldn't send a test", description: err.message });
      }
    });

  const turnOff = () =>
    run(async () => {
      await turnOffPush();
      toast({ title: 'Notifications are off on this device' });
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">Notifications</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm leading-relaxed text-zinc-600">
          {state === 'on' && (
            <>
              <p>
                <b className="text-zinc-900">On for this device.</b> You'll get new Team Chat messages, and messages in threads
                you started or opened. Not your own, and not for the room you're looking at.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={test} disabled={working} className="flex-1">
                  Send a test
                </Button>
                <Button variant="outline" onClick={turnOff} disabled={working} className="flex-1">
                  Turn off
                </Button>
              </div>
            </>
          )}
          {state === 'off' && (
            <>
              <p>
                Get a notification for new Team Chat messages, and for threads you started or opened. Not your own, and not for
                the room you're looking at. Turn it on on each phone or computer you use.
              </p>
              <Button onClick={turnOn} disabled={busy} className="w-full">
                <BellRing /> Turn on notifications
              </Button>
            </>
          )}
          {state === 'needs-install' && (
            <>
              <p>
                On iPhone, notifications work once Jive Turkeys is on your Home Screen. Open it from there, then turn them on
                here.
              </p>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  showInstallGuide();
                }}
                className="w-full"
              >
                Show me how
              </Button>
            </>
          )}
          {state === 'blocked' && <p>Notifications are blocked for Jive Turkeys. {BLOCKED_HELP[phoneKind() || 'other']}</p>}
          {state === 'unsupported' && (
            <p>This browser can't show notifications. On a phone, use Safari (iPhone) or Chrome (Android).</p>
          )}
          {isDemo && (
            <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              This is a preview with pretend players, so it shows a sample notification instead of real ones.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
