import { Fragment, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  CircleHelp,
  DollarSign,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  SlidersHorizontal,
  Smartphone,
  User,
  Users,
  X,
} from 'lucide-react';
import { isDemo } from '@/api';
import { InstallCard, InstallGuide, useInstall } from '@/components/InstallApp';
import { Walkthrough } from '@/components/Walkthrough';
import { useChatUnread } from '@/hooks/useChatUnread';
import { useTeam } from '@/hooks/useTeam';
import { signOut } from '@/lib/actions';
import { STATUS_LABEL } from '@/lib/constants';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const CHAT_PATH = '/banter';

const TABS = [
  { to: '/', label: 'Schedule', icon: CalendarDays },
  { to: '/stats', label: 'Stats', icon: ChartColumn },
  { to: '/team', label: 'Team', icon: Users },
  { to: CHAT_PATH, label: 'Chat', icon: MessageSquare, bold: true },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/profile', label: 'Profile', icon: User },
];

const seenKey = (userId) => `jt_seen_walkthrough_${userId}`;

function Badge({ n, className }) {
  if (!n) return null;
  return (
    <span
      aria-label={`${n} unread`}
      className={cn(
        'grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime-400 px-1 text-[10px] font-black leading-none tracking-normal text-black ring-2 ring-white',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function hasSeenWalkthrough(userId) {
  try {
    return !!localStorage.getItem(seenKey(userId));
  } catch {
    return false;
  }
}

export function Layout() {
  const { user, profile, isCaptain, loading, reload } = useTeam();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const { offer: offerInstall } = useInstall();
  const { pathname } = useLocation();
  const onChat = pathname === CHAT_PATH;
  const chatUnread = useChatUnread(!!user);
  // No badge while reading the chat itself.
  const unreadFor = (to) => (to === CHAT_PATH && !onChat ? chatUnread : 0);

  useEffect(() => {
    if (!user) return;
    if (!profile || !hasSeenWalkthrough(user.id)) setWalkthroughOpen(true);
  }, [user, profile]);

  const closeWalkthrough = (markSeen) => {
    if (user && markSeen !== false) {
      try {
        localStorage.setItem(seenKey(user.id), '1');
      } catch {
        // Private mode: they'll just see it again next time.
      }
    }
    setWalkthroughOpen(false);
    reload();
  };

  const menuItems = [
    { to: CHAT_PATH, label: 'Team Chat', icon: MessageSquare, show: true },
    { to: '/announcements', label: 'Announcements', icon: Megaphone, show: true },
    { to: '/dues', label: 'Dues', icon: DollarSign, show: isCaptain },
    { to: '/settings', label: 'Team Settings', icon: SlidersHorizontal, show: isCaptain },
    { to: '/rules', label: 'Field Rules', icon: BookOpen, show: true },
    { to: '/profile', label: 'My Profile', icon: User, show: true },
  ];

  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      {isDemo && (
        <div className="bg-amber-300 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-black">
          Demo mode · sample data stored in this browser only
        </div>
      )}
      <header className="sticky top-0 z-40 bg-zinc-950 text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-lime-400 font-display text-[13px] font-black tracking-tight text-black">
              JT
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-display text-[15px] font-extrabold uppercase tracking-[0.14em]">
                Jive Turkeys
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-lime-400">
                Season 12 · Indoor Coed
              </span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition',
                    isActive
                      ? 'bg-lime-400 text-black'
                      : tab.bold
                        ? 'bg-lime-400/15 text-lime-400 ring-1 ring-lime-400/40'
                        : 'text-white/60 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {tab.label}
                <Badge n={unreadFor(tab.to)} className="ring-zinc-950" />
              </NavLink>
            ))}
          </nav>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/5 transition hover:bg-white/10 md:ml-2"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* The chat sizes itself to the screen, so it needs no room below for the tab bar. */}
      <main className={cn('mx-auto max-w-3xl px-4 pt-5', onChat ? 'pb-0' : 'pb-28 md:pb-14')}>
        {pathname === '/' && <InstallCard onShowHow={() => setInstallOpen(true)} />}
        <Outlet />
      </main>

      <nav
        data-bottom-nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.06em] transition',
                  isActive ? 'text-black' : tab.bold ? 'text-lime-600' : 'text-zinc-400',
                )
              }
            >
              {({ isActive }) => (
                <Fragment>
                  <span className="relative">
                    <tab.icon
                      className={cn('h-5 w-5', (isActive || tab.bold) && 'text-lime-500')}
                      strokeWidth={isActive || tab.bold ? 2.6 : 2}
                    />
                    <Badge n={unreadFor(tab.to)} className="absolute -right-2.5 -top-1.5 bg-zinc-950 text-lime-400" />
                  </span>
                  {tab.label}
                </Fragment>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-zinc-950 px-5 pb-8 pt-5 text-white">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-lime-400">Menu</span>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 transition hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {user && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/5 p-3.5">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-lime-400 font-display text-sm font-black text-black">
                  {initials(profile?.display_name || user.full_name || user.email)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">
                    {profile?.display_name || user.full_name || 'Player'}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-400">
                    {isCaptain ? 'Captain' : 'Player'}
                    {profile?.status ? ` · ${STATUS_LABEL[profile.status]}` : ''}
                  </span>
                </span>
              </div>
            )}
            <div className="mt-5 space-y-1">
              {menuItems
                .filter((item) => item.show)
                .map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition hover:bg-white/5"
                  >
                    <item.icon className="h-4 w-4 text-lime-400" />
                    {item.label}
                    <Badge n={unreadFor(item.to)} className="ml-auto ring-zinc-950" />
                  </Link>
                ))}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setWalkthroughOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition hover:bg-white/5"
              >
                <CircleHelp className="h-4 w-4 text-lime-400" />
                How to Use
              </button>
              {offerInstall && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setInstallOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition hover:bg-white/5"
                >
                  <Smartphone className="h-4 w-4 text-lime-400" />
                  Add to Home Screen
                </button>
              )}
            </div>
            <button
              onClick={signOut}
              className="mt-auto flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}

      {!loading && user && (
        <Walkthrough open={walkthroughOpen} needsProfile={!profile} profile={profile} onClose={closeWalkthrough} />
      )}
      {offerInstall && <InstallGuide open={installOpen} onOpenChange={setInstallOpen} />}
    </div>
  );
}
