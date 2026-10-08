import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, LoaderCircle, Lock, Mail, TriangleAlert } from 'lucide-react';
import { api } from '@/api';
import { AuthShell, FormError } from '@/components/AuthShell';
import { PageSpinner } from '@/components/PageSpinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { IconInput } from './LoginPage';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.auth.requestPasswordReset(email);
    } catch {
      // Same message either way so the form doesn't reveal who has an account.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <AuthShell
      icon={Mail}
      title="Reset password"
      subtitle="We'll send you a link to reset it"
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
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
          <Button type="submit" className="h-12 w-full font-medium" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Send reset link'
            )}
          </Button>
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
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.auth.hasSession().then(setHasSession);
    return api.auth.onChange(() => api.auth.hasSession().then(setHasSession));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
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
        icon={TriangleAlert}
        title="Invalid reset link"
        subtitle="This password reset link is missing or invalid"
        footer={
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
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
      icon={Lock}
      title={isInvite ? 'Welcome to the team' : 'New password'}
      subtitle={isInvite ? 'Choose a password for your account' : 'Enter your new password below'}
    >
      <FormError>{error}</FormError>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New Password</Label>
          <IconInput
            icon={Lock}
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <IconInput
            icon={Lock}
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
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
