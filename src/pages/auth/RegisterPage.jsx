import { useState } from 'react';
import { Link } from 'react-router';
import { KeyRound, LoaderCircle, Lock, Mail } from 'lucide-react';
import { api } from '@/api';
import { AuthShell, FormError, OrDivider, safeReturnTo } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/components/ui/toast';
import { GoogleButton, IconInput } from './LoginPage';
import { RecoveryCodeCard, UsernameField } from '@/components/UsernameAccount';
import { forgetRecoveryCode, rememberRecoveryCode, usernameProblem } from '@/lib/username';

function VerifyEmail({ email }) {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setError('');
    setBusy(true);
    try {
      await api.auth.verifySignup(email, code);
      window.location.href = safeReturnTo();
    } catch (err) {
      setError(err.message || 'Invalid verification code');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      await api.auth.resendSignup(email);
      toast({ title: 'Code sent', description: 'Check your email for the new code.' });
    } catch (err) {
      setError(err.message || 'Failed to resend code');
    }
  };

  return (
    <AuthShell title="Verify your email" subtitle={`We sent a code to ${email}`}>
      <FormError>{error}</FormError>
      <div className="mb-6 flex justify-center">
        <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus autoComplete="one-time-code">
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button className="h-12 w-full font-medium" onClick={verify} disabled={busy || code.length < 6}>
        {busy ? (
          <>
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : (
          'Verify'
        )}
      </Button>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Didn't receive the code?{' '}
        <button onClick={resend} className="font-medium text-lime-700 hover:underline">
          Resend
        </button>
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">You can also tap the link in that email.</p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [method, setMethod] = useState('email');
  const [username, setUsername] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [created, setCreated] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const returnTo = safeReturnTo();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 6) return setError('Use at least 6 characters for your password');
    if (method === 'username' && usernameProblem(username)) return setError(usernameProblem(username));
    setBusy(true);
    try {
      if (method === 'username') {
        const data = await api.auth.signUpUsername(username, password, teamCode);
        rememberRecoveryCode(data.username, data.recoveryCode);
        // Signed in: the site shows the code before anything else (RecoveryCodeGate), even after a reload.
        if (data.session) {
          window.location.href = returnTo;
          return;
        }
        setCreated(data);
        setPassword('');
        setConfirm('');
        return;
      }
      const { needsVerification } = await api.auth.signUp(email, password);
      if (needsVerification) setVerifying(true);
      else window.location.href = returnTo;
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  if (verifying) return <VerifyEmail email={email} />;
  if (created) return (
    <AuthShell title="Save your recovery code" subtitle={`Your username is ${created.username}.`}>
      <RecoveryCodeCard code={created.recoveryCode} continueLabel="Log in"
        onContinue={() => { forgetRecoveryCode(); window.location.href = '/login'; }} />
    </AuthShell>
  );

  return (
    <AuthShell
      title="Create your account"
      subtitle="You'll need the team code from your invite to join."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={'/login' + (returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`)}
            className="font-medium text-lime-700 hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <GoogleButton returnTo={returnTo} onError={setError} />
      <OrDivider />
      <div className="mb-5 grid grid-cols-2 gap-2">
        {[['username', 'Username (no email)'], ['email', 'Email']].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={method === value} disabled={busy}
            className={`rounded-xl px-3 py-3 text-sm font-semibold ${method === value ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600'}`}
            onClick={() => { setMethod(value); setError(''); }}>{label}</button>
        ))}
      </div>
      <FormError>{error}</FormError>
      <form onSubmit={submit} className="space-y-4">
        {method === 'username' ? (
          <>
            <p className="text-sm text-zinc-600">Already use Google or email? <Link className="text-lime-700 underline" to="/login">Log in first</Link>, then add a username in My Profile to keep the same account.</p>
            <UsernameField value={username} onChange={setUsername} />
            <div className="space-y-2">
              <Label htmlFor="team-code">Team code</Label>
              <IconInput icon={KeyRound} id="team-code" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={40} value={teamCode} onChange={(e) => setTeamCode(e.target.value)} />
            </div>
          </>
        ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
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
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <IconInput
            icon={Lock}
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
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
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
