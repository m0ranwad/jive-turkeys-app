import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { Layout } from '@/components/Layout';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { SchedulePage } from '@/pages/SchedulePage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { JoinTeamPage } from '@/pages/auth/JoinTeamPage';

// Schedule (where most visits start) and signing in come with the site; every
// other screen downloads the first time it's opened, so phones at the complex
// with weak signal get going sooner.
// After a publish, a page that was already open asks for files that were
// replaced; reloading once picks up the new version instead of failing.
const RELOADED_KEY = 'jt_reloaded_for_update';
function reloadForUpdate() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY)) || 0;
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
const screen = (load, name) =>
  lazy(() =>
    load().then(
      (module) => ({ default: module[name] }),
      (err) => {
        if (reloadForUpdate()) return new Promise(() => {});
        throw err;
      },
    ),
  );
const AnnouncementsPage = screen(() => import('@/pages/AnnouncementsPage'), 'AnnouncementsPage');
const ChatPage = screen(() => import('@/pages/ChatPage'), 'ChatPage');
const DuesPage = screen(() => import('@/pages/DuesPage'), 'DuesPage');
const GameDetailPage = screen(() => import('@/pages/GameDetailPage'), 'GameDetailPage');
const PrivacyPage = screen(() => import('@/pages/LegalPages'), 'PrivacyPage');
const TermsPage = screen(() => import('@/pages/LegalPages'), 'TermsPage');
const NotFoundPage = screen(() => import('@/pages/NotFoundPage'), 'NotFoundPage');
const ProfilePage = screen(() => import('@/pages/ProfilePage'), 'ProfilePage');
const RulesPage = screen(() => import('@/pages/RulesPage'), 'RulesPage');
const SettingsPage = screen(() => import('@/pages/SettingsPage'), 'SettingsPage');
const StatsPage = screen(() => import('@/pages/StatsPage'), 'StatsPage');
const TeamPage = screen(() => import('@/pages/TeamPage'), 'TeamPage');
const ForgotPasswordPage = screen(() => import('@/pages/auth/PasswordPages'), 'ForgotPasswordPage');
const ResetPasswordPage = screen(() => import('@/pages/auth/PasswordPages'), 'ResetPasswordPage');
const RegisterPage = screen(() => import('@/pages/auth/RegisterPage'), 'RegisterPage');

function FullScreenSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
    </div>
  );
}

function RequireAuth() {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) {
    const here = location.pathname + location.search;
    return <Navigate to={here === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(here)}`} replace />;
  }
  // Signed in but not on the team yet: the team code comes first.
  if (!user.joined) return <JoinTeamPage />;
  return <Outlet />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<FullScreenSpinner />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<SchedulePage />} />
                  <Route path="/games/:id" element={<GameDetailPage />} />
                  <Route path="/stats" element={<StatsPage />} />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/rules" element={<RulesPage />} />
                  <Route path="/dues" element={<DuesPage />} />
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                  <Route path="/banter" element={<ChatPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
