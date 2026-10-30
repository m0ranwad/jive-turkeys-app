import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { api } from '@/api';
import { FormError } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { IconInput, PasswordInput } from '@/pages/auth/LoginPage';
import { usernameProblem } from '@/lib/username';
import { CARD } from '@/lib/constants';

export function UsernameField({ value, onChange, help = true }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="username">Username</Label>
      <IconInput icon={UserRound} id="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        minLength={3} maxLength={24} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? 'username-help' : undefined} />
      {help && (
        <p id="username-help" className="text-xs text-zinc-600">
          Letters and numbers; dots, dashes and underscores are fine. It's separate from your name on the team.
        </p>
      )}
    </div>
  );
}

/** My Profile: the username a player signs in with, or adding one to a Google or email account. */
export function UsernameAccount({ user, onSaved }) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    setOpen(false);
    setPassword('');
    setError('');
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (usernameProblem(username)) return setError(usernameProblem(username));
    if (password.length < 6) return setError('Use at least 6 characters for your password');
    setBusy(true);
    try {
      await api.auth.linkUsername(username, password);
      close();
      await onSaved();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={CARD} aria-label="Sign-in options">
      <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Sign-in options</h2>
      {user?.username ? (
        <p className="mt-3 text-sm text-zinc-600">
          Your username is <strong className="text-zinc-950">{user.username}</strong>. Use it with your password to sign in.
          Forgot your password? A captain can reset it.
        </p>
      ) : open ? (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <p className="text-sm text-zinc-600">
            {user?.hasPassword
              ? 'Sign in with a username instead of your email, using the password you already have.'
              : "Sign in with a username and a password, as well as Google. You'll choose the password here."}
          </p>
          {!user?.hasPassword && (
            <p className="text-sm text-zinc-600">For your security, this works within 10 minutes of signing in with Google.</p>
          )}
          <FormError>{error}</FormError>
          <UsernameField value={username} onChange={setUsername} />
          <div className="space-y-2">
            <Label htmlFor="username-password">{user?.hasPassword ? 'Your password' : 'Choose a password'}</Label>
            <PasswordInput id="username-password" autoComplete={user?.hasPassword ? 'current-password' : 'new-password'}
              minLength={6} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button className="h-12 w-full" disabled={busy}>{busy ? 'Adding username…' : 'Add username'}</Button>
          <button type="button" className="text-sm text-zinc-600 underline" disabled={busy} onClick={close}>Cancel</button>
        </form>
      ) : (
        <>
          <p className="mt-3 text-sm text-zinc-600">Want to sign in with a username? Add one here to keep your profile, stats, and dues together.</p>
          <Button variant="outline" className="mt-3" onClick={() => setOpen(true)}>Add a username</Button>
        </>
      )}
    </section>
  );
}
