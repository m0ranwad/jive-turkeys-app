import { useState } from 'react';
import { Link } from 'react-router';
import { LoaderCircle, Lock, Mail } from 'lucide-react';
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

/** A password box with a Show button, so players on phones can check what they typed instead of typing it twice. */
export function PasswordInput({ id, ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className="h-12 pl-10 pr-20" required autoCapitalize="none" autoCorrect="off" spellCheck={false} id={id} {...props}
        type={shown ? 'text' : 'password'} />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-pressed={shown}
        aria-controls={id}
        aria-label="Show password"
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-600 transition ${shown ? 'bg-zinc-200' : 'hover:bg-zinc-100'}`}
      >
        Show
      </button>
    </div>
  );
}

// After a failed log in: the usual mix-ups, and where to go next.
function loginHint(login) {
  return login.includes('@')
    ? 'Signed up with Google? Use Continue with Google. Forgot your password? Tap Forgot password.'
    : "Your username isn't your name on the team. Forgot it, or your password? Ask a captain.";
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const returnTo = safeReturnTo();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setHint('');
    setBusy(true);
    try {
      await api.auth.signIn(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      setHint(loginHint(email));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to the team site."
      footer={
        <>
          Don't have an account?{' '}
          <Link
            to={'/register' + (returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`)}
            className="font-medium text-lime-700 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <GoogleButton returnTo={returnTo} onError={setError} />
      <OrDivider />
      <FormError>{error}</FormError>
      {error && hint && <p className="-mt-2 mb-4 text-sm text-zinc-600">{hint}</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email or username</Label>
          <IconInput
            icon={Mail}
            id="email"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            placeholder="Your email or username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-lime-700 hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
