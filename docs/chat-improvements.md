# Chat improvements

Saved plan: https://github.com/m0ranwad/jive-turkeys-app/issues/170

The owner approved these improvements and asked for small, saved steps so work can resume if usage runs out.
Keep the existing lime-and-charcoal look. The separate accessibility refactor is deferred.

## Iteration 1: message protection and recovery

Saved as `28c2dfe` in preview #171. All 358 logic checks and compilation pass. Hosted database rules
and rehearsal pass; hosted browser checks are running.

- Failed messages remain visible with Retry and Remove, separately from the next draft.
- Drafts and unconfirmed messages survive refresh, are scoped by player, and clear on sign-out.
- Stable message IDs prevent duplicate retries, including a lost server response.
- Failed history and room-list requests show Try again. Reconnection retains loaded messages.
- Edited latest-message previews update immediately, including live edits.
- Added six logic checks and phone/desktop recovery checks.

## Iteration 2: search

Saved as `b836ab2` in preview #171. Manual phone checks passed without page errors:

- Search opens directly from a conversation, on phones and computers.
- New queries show Searching, with old results cleared.
- Responses to older queries cannot replace the current results.
- Added checks for the shortcut, loading state and late responses.

## Iteration 3: screen polish

Implemented and checked on 1280px desktop, 393px phone and 360px small phone screens:

- Desktop chat is wider, with a wider room list on large screens.
- Phones have a roomy chat-options window; desktop keeps its dropdown.
- Rename, new thread and destructive confirmations match the other chat windows.
- Existing room-menu actions and both Cancel paths work at all three sizes, with no page errors or
  horizontal page overflow.
- Added a failed-reconnection check and made the history-retry check wait for the phone room list.

## Remaining steps

1. Finish hosted browser, logic, compilation, and database checks on the final saved increment.
2. Review the sample-data preview; publish only when the owner asks.
3. Check real iPhone keyboards/scrolling, push alerts and delivery between two signed-in devices.

## Continuation notes

- Work is on `chat-reliability-and-polish`, starting from `a858f08`.
- Save each tested increment and push it. Keep the existing preview updated; do not publish to the real team
  until the owner asks.
- Update `docs/chat.md` and tests with intentional behavior changes.
- Browser automation in this workspace has encountered certificate errors loading Google Fonts. Do not
  disable certificate verification or weaken tests. The hosted checks can also validate the browser suite.
- Real iPhone keyboards, scrolling, push alerts and delivery between devices require a real-device check.
- No database update is planned; existing access and notification rules must remain intact.
