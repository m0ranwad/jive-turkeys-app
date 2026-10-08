import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { Layout } from '@/components/Layout';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { AnnouncementsPage } from '@/pages/AnnouncementsPage';
import { ChatPage } from '@/pages/ChatPage';
import { DuesPage } from '@/pages/DuesPage';
import { GameDetailPage } from '@/pages/GameDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RulesPage } from '@/pages/RulesPage';
import { SchedulePage } from '@/pages/SchedulePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { StatsPage } from '@/pages/StatsPage';
import { TeamPage } from '@/pages/TeamPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/PasswordPages';
import { RegisterPage } from '@/pages/auth/RegisterPage';

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
  return <Outlet />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
