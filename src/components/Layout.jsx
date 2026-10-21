import { Fragment, Suspense, useEffect, useState } from 'react';
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
import { InstallGuide, useInstall } from '@/components/InstallApp';
import { PageSpinner } from '@/components/PageSpinner';
import { Walkthrough } from '@/components/Walkthrough';
import { Dialog, DialogClose, DialogSidePanel, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useChatUnread } from '@/hooks/useChatUnread';
import { useTeam } from '@/hooks/useTeam';
import { signOut } from '@/lib/actions';
import { lastChatRoom } from '@/lib/chat';
import { NOTIFY_CHOICES_EVENT, resyncPush, setIconBadge } from '@/lib/push';
import { DEFAULT_SETTINGS, STATUS_LABEL } from '@/lib/constants';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const CHAT_PATH = '/banter';

const TABS = [
  { to: '/', label: 'Schedule', icon: CalendarDays },
  { to: '/stats', label: 'Stats', icon: ChartColumn },
  { to: '/team', label: 'Team', icon: Users },
  { to: CHAT_PATH, label: 'Chat', icon: MessageSquare, bold: true },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/dues', label: 'Dues', icon: DollarSign },
];

const seenKey = (userId) => `jt_seen_walkthrough_${userId}`;

/** The Chat tab's unread number, or (with `mention`) its separate @ count of messages that mention you. */
function Badge({ n, mention, className }) {
  if (!n) return null;
  return (
    <span
      aria-label={mention ? `${n} ${n === 1 ? 'mention' : 'mentions'}` : `${n} unread`}
      className={cn(
        'grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime-400 px-1 text-[11px] font-black leading-none tracking-normal text-black ring-2 ring-white',
        className,
      )}
    >
      {mention && '@'}
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
  const { user, profile, isCaptain, loading, reload, settings } = useTeam();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const { offer: offerInstall } = useInstall();
  const { pathname } = useLocation();
  const onChat = pathname === CHAT_PATH;
  // The Chat tab brings you back to the room you were in during this visit; tapped while you're in the
  // chat, it goes to the room list. Like a phone app's tabs.
  const linkTo = (to) => (to === CHAT_PATH && !onChat ? `${CHAT_PATH}${lastChatRoom()}` : to);
  const chatUnread = useChatUnread(!!user);
  // No badges while reading the chat itself.
  const unreadFor = (to) => (to === CHAT_PATH && !onChat ? chatUnread.unread : 0);
  const mentionsFor = (to) => (to === CHAT_PATH && !onChat ? chatUnread.mentions : 0);
  const myInitials = user ? initials(profile?.display_name || user.full_name || user.email) : '';

  useEffect(() => {
    if (!user) return;
    if (!profile || !hasSeenWalkthrough(user.id)) setWalkthroughOpen(true);
  }, [user, profile]);

  // This device's notifications follow whoever is signed in on it.
  useEffect(() => {
    if (user) resyncPush().catch(() => {});
  }, [user?.id]);

  // The number on the app icon follows the Chat tab, for players who get chat notifications (they keep
  // it up to date while the app is closed).
  const chatIconOn = !!user && profile?.notify_chat !== false;
  useEffect(() => {
    setIconBadge(chatIconOn ? chatUnread.unread : 0);
  }, [chatIconOn, chatUnread.unread]);
  useEffect(() => {
    window.addEventListener(NOTIFY_CHOICES_EVENT, reload);
    return () => window.removeEventListener(NOTIFY_CHOICES_EVENT, reload);
  }, [reload]);

  // Other screens (the chat's notification settings) can open the Home Screen guide.
  useEffect(() => {
    const open = () => setInstallOpen(true);
    window.addEventListener('jt:show-install', open);
    return () => window.removeEventListener('jt:show-install', open);
  }, []);

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
    { to: '/dues', label: 'Dues', icon: DollarSign, show: true },
    { to: '/settings', label: 'Team Settings', icon: SlidersHorizontal, show: isCaptain },
    { to: '/rules', label: 'Field Rules', icon: BookOpen, show: true },
    { to: '/profile', label: 'My Profile', icon: User, show: true },
  ];

  // The side menu is a dialog: Escape closes it, focus stays inside it, and closing it goes back to the Menu button.
  return (
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
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
                <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-lime-400">
                  {settings?.season_label || DEFAULT_SETTINGS.season_label}
                </span>
              </span>
            </Link>
            <nav className="ml-auto hidden items-center gap-1 md:flex">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={linkTo(tab.to)}
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
                  <Badge mention n={mentionsFor(tab.to)} className="ring-zinc-950" />
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-2">
              <NavLink
                to="/profile"
                // Names it with the initials it shows, so voice control can tap it by what's on screen.
                aria-label={myInitials ? `My profile, ${myInitials}` : 'My profile'}
                title="My profile"
                className={({ isActive }) =>
                  cn(
                    'grid h-10 w-10 place-items-center rounded-full font-display text-[13px] font-black tracking-tight transition',
                    isActive
                      ? 'bg-lime-400 text-black'
                      : 'bg-lime-400/15 text-lime-400 ring-1 ring-lime-400/40 hover:bg-lime-400/25',
                  )
                }
              >
                {myInitials || <User className="h-5 w-5" />}
              </NavLink>
              <DialogTrigger
                aria-label="Menu"
                className="grid h-10 w-10 place-items-center rounded-2xl bg-white/5 transition hover:bg-white/10"
              >
                <Menu className="h-5 w-5" />
              </DialogTrigger>
            </div>
          </div>
        </header>

        {/* The chat sizes itself to the screen, so it needs no room below for the tab bar. */}
        <main className={cn('mx-auto max-w-3xl px-4 pt-5', onChat ? 'pb-0' : 'pb-28 md:pb-14')}>
          {/* Keeps the header and tabs up while a screen downloads the first time. */}
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
        </main>

        <nav
          data-bottom-nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/[0.98] backdrop-blur md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto flex max-w-3xl">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={linkTo(tab.to)}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] transition',
                    isActive ? 'text-black' : tab.bold ? 'text-lime-700' : 'text-zinc-500',
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
                      <Badge mention n={mentionsFor(tab.to)} className="absolute -left-3 -top-1.5 bg-zinc-950 text-lime-400" />
                    </span>
                    {tab.label}
                  </Fragment>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        <DialogSidePanel className="bg-zinc-950 px-5 pb-8 pt-5 text-white">
          <div className="flex items-center justify-between">
            <DialogTitle asChild className="text-[11px] font-bold uppercase leading-normal tracking-[0.24em] text-lime-400">
              <span>Menu</span>
            </DialogTitle>
            <DialogClose
              aria-label="Close menu"
              className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 transition hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
          {user && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/5 p-3.5">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-lime-400 font-display text-sm font-black text-black">
                {myInitials}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">
                  {profile?.display_name || user.full_name || 'Player'}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-lime-400">
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
                  // Says Team Chat, so it opens Team Chat (the Chat tab opens the room list on phones).
                  to={item.to === CHAT_PATH ? `${CHAT_PATH}?room=team` : item.to}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition hover:bg-white/5"
                >
                  <item.icon className="h-4 w-4 text-lime-400" />
                  {item.label}
                  <span className="ml-auto flex gap-1">
                    <Badge n={unreadFor(item.to)} className="ring-zinc-950" />
                    <Badge mention n={mentionsFor(item.to)} className="ring-zinc-950" />
                  </span>
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
        </DialogSidePanel>

        {!loading && user && (
          <Walkthrough open={walkthroughOpen} needsProfile={!profile} profile={profile} onClose={closeWalkthrough} />
        )}
        {offerInstall && <InstallGuide open={installOpen} onOpenChange={setInstallOpen} />}
      </div>
    </Dialog>
  );
}
