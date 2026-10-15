// "Add to calendar": the .ics file and the Google Calendar link for one game.
import { describe, expect, it } from 'vitest';
import { gameIcs, googleCalendarUrl } from '@/lib/calendar';

const settings = { primary_jersey: 'Bright green/yellow', backup_jersey: 'Black', venue_name: 'North Coast', venue_address: '8809 Lake Rd, Seville, OH' };
const game = {
  id: 'g1',
  date: '2026-10-15',
  time: '7:00 PM',
  field_number: '2',
  opponent: 'Ball Busters',
  location: 'North Coast Premier Soccer Complex, 8809 Lake Rd, Seville, OH',
  jersey: 'backup',
  notes: 'Bring both jerseys; playoff seeding',
};
const link = 'https://jiveturkeys.app/games/g1';

describe('add to calendar', () => {
  it('makes an event at the Eastern kickoff time, 55 minutes long, in UTC', () => {
    const ics = gameIcs(game, settings, link);
    // 7:00 PM Eastern in October (daylight time) is 23:00 UTC.
    expect(ics).toContain('DTSTART:20261015T230000Z');
    expect(ics).toContain('DTEND:20261015T235500Z');
    expect(ics).toContain('SUMMARY:Jive Turkeys vs Ball Busters');
    expect(ics).toContain('LOCATION:North Coast Premier Soccer Complex\\, 8809 Lake Rd\\, Seville\\, OH');
    expect(ics).toContain('DESCRIPTION:Field 2 · Black jersey\\nBring both jerseys\\; playoff seeding\\nRSVP: https://jiveturkeys.app/games/g1');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it("uses the game id as the event's UID", () => {
    expect(gameIcs(game, settings, link)).toContain('UID:g1@jiveturkeys.app');
  });

  it('handles winter time, and a game with no time yet as an all-day event', () => {
    expect(gameIcs({ ...game, date: '2026-12-03', time: '20:10' }, settings, link)).toContain('DTSTART:20261204T011000Z');
    const allDay = gameIcs({ ...game, time: '' }, settings, link);
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261015');
    expect(allDay).toContain('DTEND;VALUE=DATE:20261016');
  });

  it("falls back to the team's venue when a game has no location", () => {
    expect(gameIcs({ ...game, location: '' }, settings, link)).toContain('LOCATION:North Coast');
  });

  it('fills in a Google Calendar event the same way', () => {
    const url = new URL(googleCalendarUrl(game, settings, link));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('text')).toBe('Jive Turkeys vs Ball Busters');
    expect(url.searchParams.get('dates')).toBe('20261015T230000Z/20261015T235500Z');
    expect(url.searchParams.get('details')).toContain('RSVP: https://jiveturkeys.app/games/g1');
  });
});
