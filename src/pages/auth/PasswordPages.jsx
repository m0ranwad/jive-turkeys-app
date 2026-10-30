import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, KeyRound, LoaderCircle, Mail } from 'lucide-react';
import { api } from '@/api';
import { AuthShell, FormError } from '@/components/AuthShell';
import { PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { IconInput, PasswordInput } from './LoginPage';
import { UsernameField } from '@/components/UsernameAccount';

export function ForgotPasswordPage() {
  // Username players have no email for a link, so a captain gives them a code instead.
  const [withCode, setWithCode] = useState(false);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (withCode && password.length < 6) return setError('Use at least 6 characters for your password');
    setBusy(true);
    try {
      if (withCode) {
        const { session } = await api.auth.resetWithCode(username, code, password);
        window.location.href = session ? '/' : '/login';
        return;
      }
      await api.auth.requestPasswordReset(email);
    } catch (err) {
      if (withCode) setError(err.message || 'Could not reset your password.');
      // Same message either way so the form doesn't reveal who has an account.
    } finally {
      setBusy(false);
      if (!withCode) setSent(true);
    }
  };

  return (
    <AuthShell
      title="Reset password"
      subtitle={withCode ? "A captain can reset it: they'll text you a code to enter here." : "We'll send you a link to reset it"}
      footer={
        <Link to="/login" className="font-medium text-lime-700 hover:underline">
          <ArrowLeft className="mr-1 inline h-3 w-3" />
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p className="text-center text-sm text-foreground">
          If an account exists with that email, you'll receive a password reset link shortly.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormError>{error}</FormError>
          {withCode ? (
            <>
              <UsernameField value={username} onChange={setUsername} help={false} />
              <div className="space-y-2">
                <Label htmlFor="reset-code">Code from your captain</Label>
                <IconInput icon={KeyRound} id="reset-code" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off"
                  spellCheck={false} placeholder="ABCD-2345" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <PasswordInput id="password" autoComplete="new-password" placeholder="At least 6 characters" minLength={6} maxLength={256}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </>
          ) : (
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <IconInput
              icon={Mail}
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          )}
          <Button type="submit" className="h-12 w-full font-medium" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                {withCode ? 'Saving...' : 'Sending...'}
              </>
            ) : (
              withCode ? 'Set new password' : 'Send reset link'
            )}
          </Button>
          <button type="button" disabled={busy} className="w-full text-center text-sm font-medium text-lime-700 underline"
            onClick={() => { setWithCode(!withCode); setError(''); }}>
            {withCode ? 'Signed up with an email? Use email instead' : 'Signed up with a username? Use a code from a captain'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * Landing page for password-reset and invite emails. The link signs the
 * person in, then they choose a password here.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const isInvite = params.get('invite') === '1';
  const [hasSession, setHasSession] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.auth.hasSession().then(setHasSession);
    return api.auth.onChange(() => api.auth.hasSession().then(setHasSession));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Use at least 6 characters for your password');
    setBusy(true);
    try {
      await api.auth.updatePassword(password);
      window.location.href = '/';
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setBusy(false);
    }
  };

  if (hasSession === null) return <PageSpinner />;

  if (!hasSession) {
    return (
      <AuthShell
        title="Invalid reset link"
        subtitle="This password reset link is missing or invalid"
        footer={
          <Link to="/forgot-password" className="font-medium text-lime-700 hover:underline">
            Request a new link
          </Link>
        }
      >
        <p className="text-center text-sm text-foreground">
          The link you used appears to be incomplete or has expired. Please request a new password reset email.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={isInvite ? 'Welcome to the team' : 'New password'}
      subtitle={isInvite ? 'Choose a password for your account' : 'Enter your new password below'}
    >
      <FormError>{error}</FormError>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <PasswordInput id="password" autoComplete="new-password" autoFocus placeholder="At least 6 characters"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : isInvite ? (
            'Set password'
          ) : (
            'Reset password'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
