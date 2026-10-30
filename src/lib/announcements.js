// Announcements: which posts are new to you (the database counts them, announcements_unread()).

/** Fired after announcements are marked read, so the menu's badge refreshes. */
export const ANNOUNCEMENTS_READ_EVENT = 'jt:announcements-read';

/** When the newest of these posts went up, or null with none. Marking read goes up to it, never past what's on screen. */
export function newestPostAt(posts) {
  return (posts || []).reduce((newest, p) => (p.created_date && (!newest || p.created_date > newest) ? p.created_date : newest), null);
}

/** What the menu says about new posts: "1 new announcement", "3 new announcements". */
export const newPostsLabel = (n) => `${n} new ${n === 1 ? 'announcement' : 'announcements'}`;
