import { Link } from 'react-router';
import { FileText, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/AuthShell';

const UPDATED = 'October 8, 2026';

function LegalBody({ children }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground">
      {children}
      <p className="text-xs text-muted-foreground">Last updated {UPDATED}.</p>
    </div>
  );
}

const backLink = (
  <Link to="/" className="font-medium text-primary hover:underline">
    Back to the team hub
  </Link>
);

export function PrivacyPage() {
  return (
    <AuthShell icon={ShieldCheck} title="Privacy" subtitle="Jive Turkeys Team Hub" footer={backLink}>
      <LegalBody>
        <p>
          This page is here because Google requires one for "Sign in with Google". The Jive Turkeys Team Hub is a
          private site for one recreational soccer team.
        </p>
        <p>
          We keep the details you give us so the site can work: your email and name, plus anything you add to your
          profile, RSVPs, stats and chat. If you sign in with Google, we receive only your name and email address.
        </p>
        <p>
          Only signed-in teammates can see team information. We don't sell or share your information, and we don't
          use it for advertising.
        </p>
        <p>To change or delete your information, edit your profile or ask a team captain.</p>
      </LegalBody>
    </AuthShell>
  );
}

export function TermsPage() {
  return (
    <AuthShell icon={FileText} title="Terms" subtitle="Jive Turkeys Team Hub" footer={backLink}>
      <LegalBody>
        <p>
          This page is here because Google requires one for "Sign in with Google". The Jive Turkeys Team Hub is a
          private site for one recreational soccer team.
        </p>
        <p>
          It's for team members only. Please keep it friendly and respectful. Captains may remove content or accounts
          that aren't.
        </p>
        <p>The site is run by volunteers and provided as-is, with no guarantees.</p>
      </LegalBody>
    </AuthShell>
  );
}
