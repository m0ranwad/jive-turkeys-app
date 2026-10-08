import { useState } from 'react';
import { Link } from 'react-router';
import { LoaderCircle, Lock, LogIn, Mail } from 'lucide-react';
import { api } from '@/api';
import { AuthShell, FormError, GoogleIcon, OrDivider, safeReturnTo } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

export function GoogleButton({ returnTo, onError }) {
  return (
    <Button
      variant="outline"
      className="mb-6 h-12 w-full text-sm font-medium"
      onClick={() => api.auth.signInWithGoogle(returnTo).catch((e) => onError(e.message))}
    >
      <GoogleIcon className="mr-2 h-5 w-5" />
      Continue with Google
    </Button>
  );
}

export function IconInput({ icon: Icon, ...props }) {
  return (
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className="h-12 pl-10" required {...props} />
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const returnTo = safeReturnTo();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.auth.signIn(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={LogIn}
      title="Welcome back"
      subtitle="Log in to your account"
      footer={
        <>
          Don't have an account?{' '}
          <Link
            to={'/register' + (returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`)}
            className="font-medium text-primary hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <GoogleButton returnTo={returnTo} onError={setError} />
      <OrDivider />
      <FormError>{error}</FormError>
      <form onSubmit={submit} className="space-y-4">
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <IconInput
            icon={Lock}
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              Logging in...
            </>
          ) : (
            'Log in'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
