import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, isDemo, DEMO_TEAM_CODE } from '@/api';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { clearTeamCache } from '@/hooks/useTeam';
import { signOut } from '@/lib/actions';

/** A new account enters the team code before it can see anything about the team. */
export function JoinTeamPage() {
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.users.joinTeam(code.trim());
      clearTeamCache();
      await refresh();
    } catch (err) {
      setError(err.message || "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Enter the team code"
      subtitle="It's in the invite from your captain."
      footer={
        <>
          Wrong account?{' '}
          <button type="button" onClick={signOut} className="font-medium text-lime-700 hover:underline">
            Sign out
          </button>
        </>
      }
    >
      <FormError>{error}</FormError>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="team-code">Team code</Label>
          <Input
            id="team-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABC123"
            className="h-12 text-center font-display text-xl font-extrabold uppercase tracking-[0.3em]"
          />
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={busy || code.trim().length < 4}>
          {busy ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              Joining...
            </>
          ) : (
            'Join the team'
          )}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Don't have it? Ask the teammate who invited you, or a captain.
      </p>
      {isDemo && (
        <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-center text-xs font-semibold text-amber-900">
          Demo mode: the team code is {DEMO_TEAM_CODE}.
        </p>
      )}
    </AuthShell>
  );
}
