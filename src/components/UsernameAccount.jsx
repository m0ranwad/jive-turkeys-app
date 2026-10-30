import { useState } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { api } from '@/api';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { IconInput } from '@/pages/auth/LoginPage';
import { forgetRecoveryCode, rememberRecoveryCode, unsavedRecoveryCode, usernameProblem } from '@/lib/username';
import { CARD } from '@/lib/constants';
import { copyText } from '@/lib/clipboard';

export function UsernameField({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="username">Username</Label>
      <IconInput icon={UserRound} id="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        minLength={3} maxLength={24} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby="username-help" />
      <p id="username-help" className="text-xs text-zinc-600">3–24 letters, numbers, or underscores. This is separate from your name on the team.</p>
    </div>
  );
}

export function RecoveryCodeCard({ code, onContinue, continueLabel = 'Continue' }) {
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">Keep this code somewhere safe. You can use it with your username to reset your password without email. It is shown only once.</p>
      <div className="space-y-2">
        <Label htmlFor="recovery-code">Your recovery code</Label>
        <Input id="recovery-code" readOnly value={code} className="h-auto py-3 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <button type="button" className="text-sm font-medium text-lime-700 underline"
          onClick={async () => setCopyStatus(await copyText(code) ? 'Copied. Paste it somewhere safe.' : 'Select the code above to copy it.')}>
          Copy recovery code
        </button>
        {copyStatus && <p role="status" className="text-xs text-zinc-600">{copyStatus}</p>}
      </div>
      <label className="flex items-start gap-3 text-sm text-zinc-700">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 h-4 w-4 accent-lime-700" />
        I've saved my recovery code somewhere safe.
      </label>
      <Button className="h-12 w-full" disabled={!saved} onClick={onContinue}>{continueLabel}</Button>
    </div>
  );
}

/**
 * Until the player ticks that they saved their newest recovery code, it comes
 * before everything else, even after a reload or a tap on another tab.
 */
export function RecoveryCodeGate({ user, children }) {
  const [, setSaved] = useState(0);
  const code = unsavedRecoveryCode(user?.username);
  if (!code) return children;
  return (
    <AuthShell title="Save your recovery code" subtitle={`Your username is ${user.username}.`}>
      <RecoveryCodeCard code={code} continueLabel="Continue to the team"
        onContinue={() => { forgetRecoveryCode(); setSaved((n) => n + 1); }} />
    </AuthShell>
  );
}

export function UsernameAccount({ user, onSaved }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (usernameProblem(username)) return setError(usernameProblem(username));
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 6) return setError('Use at least 6 characters for your password');
    setBusy(true);
    try {
      const data = await api.auth.linkUsername(username, password, user.hasPassword ? current : undefined);
      rememberRecoveryCode(data.username, data.recoveryCode);
      setCode(data.recoveryCode);
      setPassword('');
      setConfirm('');
      setCurrent('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const replaceCode = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api.auth.rotateRecoveryCode(user.username, password);
      rememberRecoveryCode(user.username, data.recoveryCode);
      setCode(data.recoveryCode);
      setPassword('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <section className={CARD} aria-label="Sign-in options">
      <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Sign-in options</h2>
      {code ? (
        <div className="mt-4">
          <p className="mb-3 text-sm font-bold">Save your recovery code</p>
          <RecoveryCodeCard code={code} continueLabel="Done" onContinue={async () => { forgetRecoveryCode(); await onSaved(); setCode(''); setOpen(false); }} />
        </div>
      ) : user?.username ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-zinc-600">Your username is <strong className="text-zinc-950">{user.username}</strong>. Use it with your password to sign in.</p>
          {open ? (
            <form onSubmit={replaceCode} className="space-y-3">
              <p className="text-sm text-zinc-600">Enter your password to replace your recovery code. The old code will stop working.</p>
              <FormError>{error}</FormError>
              <Label htmlFor="recovery-password">Current password</Label>
              <IconInput icon={Lock} id="recovery-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button disabled={busy}>{busy ? 'Replacing…' : 'Replace recovery code'}</Button>
              <button type="button" disabled={busy} className="ml-3 text-sm text-zinc-600 underline" onClick={() => { setOpen(false); setPassword(''); setError(''); }}>Cancel</button>
            </form>
          ) : <button type="button" className="text-sm font-medium text-lime-700 underline" onClick={() => setOpen(true)}>Replace recovery code</button>}
        </div>
      ) : open ? (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <p className="text-sm text-zinc-600">Add another way to sign in to this same account. Your Google and email options still work. This password also becomes your email sign-in password.</p>
          <FormError>{error}</FormError>
          {user?.hasPassword ? (
            <div className="space-y-2">
              <Label htmlFor="username-current">Current password</Label>
              <IconInput icon={Lock} id="username-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          ) : (
            <p className="text-sm text-zinc-600">For your security, this works within 10 minutes of signing in with Google.</p>
          )}
          <UsernameField value={username} onChange={setUsername} />
          <div className="space-y-2">
            <Label htmlFor="username-password">New password</Label>
            <IconInput icon={Lock} id="username-password" type="password" autoComplete="new-password" minLength={6} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username-confirm">Confirm password</Label>
            <IconInput icon={Lock} id="username-confirm" type="password" autoComplete="new-password" minLength={6} maxLength={256} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button className="h-12 w-full" disabled={busy}>{busy ? 'Adding username…' : 'Add username'}</Button>
          <button type="button" className="text-sm text-zinc-600 underline" disabled={busy} onClick={() => { setOpen(false); setCurrent(''); setError(''); }}>Cancel</button>
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
