# Chat improvements

Saved plan: https://github.com/m0ranwad/jive-turkeys-app/issues/170

The owner approved these improvements and asked for small, saved steps so work can resume if usage runs out.
Keep the existing lime-and-charcoal look. The separate accessibility refactor is deferred.

## Iteration 1: message protection and recovery

Implemented, with final hosted checks still to run:

- Failed messages remain visible with Retry and Remove, separately from the next draft.
- Drafts and unconfirmed messages survive refresh, are scoped by player, and clear on sign-out.
- Stable message IDs prevent duplicate retries, including a lost server response.
- Failed history and room-list requests show Try again. Reconnection retains loaded messages.
- Edited latest-message previews update immediately, including live edits.
- Added six logic checks and phone/desktop recovery checks. The focused 104 logic checks pass.

## Remaining steps

1. Finish hosted checks for iteration 1 and resolve any failures.
2. Show Searching instead of stale results and add search inside open conversations.
3. Give desktop chat and its room list more space.
4. Polish phone controls: larger room-menu rows and consistent chat dialogs (#76).

## Continuation notes

- Work is on `chat-reliability-and-polish`, starting from `a858f08`.
- Save each tested increment and push it. Keep the existing preview updated; do not publish to the real team
  until the owner asks.
- Update `docs/chat.md` and tests with intentional behavior changes.
- Browser automation in this workspace has encountered certificate errors loading Google Fonts. Do not
  disable certificate verification or weaken tests. The hosted checks can also validate the browser suite.
- Real iPhone keyboards, scrolling, push alerts and delivery between devices require a real-device check.
- No database update is planned; existing access and notification rules must remain intact.
