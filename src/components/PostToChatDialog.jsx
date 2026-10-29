import { useMemo, useState } from 'react';
import { Copy, MessageSquare } from 'lucide-react';
import { api } from '@/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { copyText } from '@/lib/clipboard';
import { DIALOG, DIALOG_TITLE } from '@/lib/constants';
import { saveFailedToast } from '@/lib/errors';
import { findMentions, mentionPeople } from '@/lib/mentions';
import { chatNamer, plainName } from '@/lib/team-posts';
import { cn } from '@/lib/utils';

const BIG_BUTTON = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold uppercase tracking-[0.1em] transition';
// The database refuses longer messages.
const MAX_LENGTH = 2000;

/**
 * A message about something on another screen (a game reminder, a call for
 * subs, a dues reminder, an announcement), shown first so nothing posts by
 * accident. Post in Team Chat sends it as you, @mentioning the teammates it
 * names so their phones buzz (`everyone`: @team, captains only); Copy instead
 * gives plain names for anyone who isn't on the site. `message(nameOf)` builds
 * the text; `about` is who it names, for the note on who won't see it.
 */
export function PostToChatDialog({ open, onOpenChange, title, intro, message, about = [], everyone = false }) {
  const { user, profile, profiles, isCaptain } = useTeam();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => mentionPeople(profiles || []), [profiles]);

  const team = everyone && isCaptain;
  const body = useMemo(() => {
    if (!open) return '';
    const text = message(chatNamer(profiles || []));
    return team ? `@team ${text}` : text;
  }, [open, message, profiles, team]);
  const { mentions } = useMemo(
    () => findMentions(body, people, { me: user?.id, canMentionTeam: team }),
    [body, people, user?.id, team],
  );
  const offSite = about.filter((p) => p.guest).map((p) => p.display_name);
  const tooLong = body.length > MAX_LENGTH;
  // Over about three lines, the preview may shrink to fit the screen (it keeps at least that much).
  const longBody = body.length > 120 || body.split('\n').length > 3;
  const buzzes = team
    ? 'Everyone with notifications on gets a buzz (@team).'
    : mentions.length
      ? `${mentions.length === 1 ? '1 teammate gets' : `${mentions.length} teammates get`} a buzz: ${people
          .filter((p) => mentions.includes(p.id))
          .map((p) => p.label)
          .join(', ')}.`
      : 'Teammates with chat notifications on get a buzz.';

  const post = async () => {
    if (!user || tooLong) return;
    setBusy(true);
    try {
      await api.entities.Message.create({
        user_id: user.id,
        author_name: profile?.display_name || user.full_name || 'Player',
        body,
        thread_id: null,
        ...(mentions.length && { mentions }),
        ...(team && { mentions_team: true }),
      });
      onOpenChange(false);
      toast({ title: 'Posted in Team Chat' });
    } catch (err) {
      toast(saveFailedToast(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await copyText(message(plainName));
    onOpenChange(false);
    toast({
      title: 'Copied',
      description: offSite.length ? `Text it to ${offSite.join(', ')}, who ${offSite.length === 1 ? "isn't" : "aren't"} on the site yet.` : 'Paste it wherever you need it.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Only a long message scrolls: it shrinks to fit the screen, so the buttons stay put. */}
      <DialogContent className={cn(DIALOG, 'flex flex-col')} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="text-left">
          <DialogTitle className={DIALOG_TITLE}>{title}</DialogTitle>
        </DialogHeader>
        {intro && <p className="-mt-2 text-sm text-zinc-500">{intro}</p>}
        <p
          data-testid="post-preview"
          className={cn(
            'max-h-64 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-3.5 py-3 text-sm leading-relaxed text-zinc-800',
            longBody ? 'min-h-[5rem]' : 'shrink-0',
          )}
        >
          {body}
        </p>
        <p className="text-xs font-medium text-zinc-500">
          {buzzes}
          {offSite.length > 0 &&
            ` ${offSite.join(', ')} ${offSite.length === 1 ? "isn't" : "aren't"} on the site yet, so copy it to text them.`}
        </p>
        {tooLong && (
          <p className="text-xs font-semibold text-red-700">Too long for the chat (2,000 characters at most). Copy it instead.</p>
        )}
        <div className="space-y-2">
          <button
            type="button"
            onClick={post}
            disabled={busy || tooLong || !user}
            className={cn(BIG_BUTTON, 'bg-lime-400 text-black hover:bg-lime-300 disabled:opacity-50')}
          >
            <MessageSquare className="h-4 w-4" />
            {busy ? 'Posting…' : 'Post in Team Chat'}
          </button>
          <button
            type="button"
            onClick={copy}
            className="flex w-full items-center justify-center gap-1.5 py-2 text-xs font-bold uppercase tracking-[0.1em] text-zinc-600 transition hover:text-zinc-950"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy instead
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
