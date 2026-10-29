import { useState } from 'react';
import { Link } from 'react-router';
import { api, isDemo, DEMO_LOGIN, DEMO_PLAYER_LOGIN } from '@/api';
import { TEAM_FOUNDED } from '@/lib/constants';

/** Demo mode only: sign in as a sample captain or player with one tap. */
function DemoSignIn() {
  const [error, setError] = useState('');
  const signInAs = async ({ email, password }) => {
    setError('');
    try {
      await api.auth.signIn(email, password);
      window.location.href = safeReturnTo();
    } catch (err) {
      setError(err.message);
    }
  };
  const button = 'h-10 flex-1 rounded-full bg-amber-900 px-4 text-xs font-bold text-amber-50 transition hover:bg-amber-950';

  return (
    <div className="mb-6 rounded-2xl bg-amber-100 px-4 py-3 text-center text-xs font-semibold text-amber-900">
      <p>Demo mode with pretend players. Sign in with one tap:</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={button} onClick={() => signInAs(DEMO_LOGIN)}>
          Sign in as the captain
        </button>
        <button type="button" className={button} onClick={() => signInAs(DEMO_PLAYER_LOGIN)}>
          Sign in as a player
        </button>
      </div>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <p className="mt-3 font-normal">Or create any account to try it as a new player.</p>
    </div>
  );
}

/**
 * The sign-in screens: the team's turkey and name on top, so someone opening
 * the link from an invite knows they're in the right place. The privacy and
 * terms pages pass an `icon` and keep their plain look.
 */
export function AuthShell({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        {Icon ? (
          <div className="mb-10 text-center">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
              <Icon className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
          </div>
        ) : (
          <div className="mb-8 text-center">
            <img src="/icon-192.png" alt="" width="72" height="72" className="mx-auto h-[72px] w-[72px] rounded-[22px] shadow-sm" />
            <p className="mt-3 font-display text-sm font-extrabold uppercase tracking-[0.16em] text-zinc-950">Jive Turkeys</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.24em] text-lime-700">Est. {TEAM_FOUNDED}</p>
            <h1 className="mt-5 font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-zinc-950">{title}</h1>
            {subtitle && <p className="mt-2 text-zinc-600">{subtitle}</p>}
          </div>
        )}
        {isDemo && <DemoSignIn />}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">{children}</div>
        {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/privacy" className="hover:underline">
            Privacy
          </Link>
          {' · '}
          <Link to="/terms" className="hover:underline">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}

export function FormError({ children }) {
  if (!children) return null;
  return <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{children}</div>;
}

export function GoogleIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function OrDivider() {
  return (
    <div className="relative mb-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card px-3 text-muted-foreground">or</span>
      </div>
    </div>
  );
}

/** Same-origin path from ?returnTo=, or '/'. */
export function safeReturnTo() {
  const raw = new URLSearchParams(window.location.search).get('returnTo');
  if (!raw) return '/';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    const path = url.pathname + url.search;
    return !path.startsWith('/') || path.startsWith('//') || path.includes('\\') ? '/' : path;
  } catch {
    return '/';
  }
}
