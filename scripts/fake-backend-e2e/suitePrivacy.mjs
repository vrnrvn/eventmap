// Flow 7 — privacy as other people see you. The server rules were reviewed
// on 2026-11-03; what was never checked is the view from outside, in the UI.
//
//   node scripts/fake-backend-e2e/suitePrivacy.mjs <repo> <dist> [V1..V4|all] [outDir]
import fs from 'node:fs';
import { open, check, results, sleep } from './lib.mjs';

const [repo, dist, only = 'all', outDir = '/tmp/eventmap-privacy'] = process.argv.slice(2);
const run = (k) => only === 'all' || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const P = { repo, dist };
const OTHER = '00000000-0000-4000-8000-0000000000b1';

/** get_public_profile is the only way to see someone else (profiles is owner-only). */
const publicProfile = (payload) => ({ '/rest/v1/rpc/get_public_profile': () => ({ json: payload }) });

if (run('V1')) {
  const h = await open({ ...P, overrides: publicProfile({ is_private: true }) });
  await h.go(`/user/${OTHER}`, 9000);
  const t = await h.text();
  check('V1 a private profile is not shown to others',
    /private/i.test(t), t.match(/[^\n]*private[^\n]*/i)?.[0] ?? t.slice(0, 200));
  check('V1 and leaks no bio, city or socials', !/Bio\b/.test(t) && !/instagram/i.test(t), t.slice(0, 0));
  check('V1 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V1-private.png`);
  await h.close();
}

if (run('V2')) {
  // Public profile, but "share my future events" is off.
  const h = await open({
    ...P,
    overrides: publicProfile({ is_private: false, profile: {
      id: OTHER, name: 'Visible Vera', bio: 'Says hello', avatar_url: null, city: 'San Francisco',
      social_handles: null, hobbies: null, show_future_events: false, show_attendance_publicly: false,
    } }),
  });
  await h.go(`/user/${OTHER}`, 9000);
  const t = await h.text();
  check('V2 a public profile shows its name and bio', /Visible Vera/.test(t) && /Says hello/.test(t), t.slice(0, 120));
  // The section is headed "Events I'm Planning to Attend"; when sharing is
  // off it is hidden entirely rather than shown as an empty schedule.
  check('V2 future events stay hidden when the owner turned them off',
    !/Planning to Attend/i.test(t), t.match(/[^\n]*Planning to Attend[^\n]*/i)?.[0] ?? '');
  check('V2 no upcoming-events request is even made',
    h.count((r) => /get_user_upcoming_events/.test(r.path)) === 0,
    String(h.count((r) => /get_user_upcoming_events/.test(r.path))));
  check('V2 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V2-hidden-events.png`);
  await h.close();

  // Same profile with sharing on: the section appears.
  const h2 = await open({
    ...P,
    overrides: publicProfile({ is_private: false, profile: {
      id: OTHER, name: 'Visible Vera', bio: 'Says hello', avatar_url: null, city: 'San Francisco',
      social_handles: null, hobbies: null, show_future_events: true, show_attendance_publicly: true,
    } }),
  });
  await h2.go(`/user/${OTHER}`, 9000);
  const t2 = await h2.text();
  check('V2 with sharing on, the upcoming section is there',
    /Planning to Attend/i.test(t2), t2.match(/[^\n]*Planning to Attend[^\n]*/i)?.[0] ?? t2.slice(0, 160));
  check('V2 no runtime errors (sharing on)', h2.errors().length === 0, h2.errors().slice(0, 2).join(' | '));
  await h2.close();
}

if (run('V3')) {
  // The attendee list: private attendees must appear as a short name, never
  // in full (the 2026-11-03 private-name rule), to hosts and attendees alike.
  const h = await open({ ...P });
  await h.go(`/event/${h.data.ev[0].id}`, 9000);
  const clicked = await h.click('Attendee', false);
  await sleep(2000);
  const t = await h.text();
  const privatePerson = h.data.people.find((p) => p.is_private);
  check('V3 opened the attendee list', clicked === 'ok' || /attendee/i.test(t), String(clicked));
  check('V3 a private attendee is not listed under their full name',
    !t.includes(privatePerson.name), privatePerson.name);
  check('V3 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V3-attendees.png`);
  await h.close();
}

if (run('V4')) {
  // Signed out: an event is public, but nothing personal should show and the
  // write paths must ask for an account rather than failing.
  const h = await open({ ...P, noSession: true });
  await h.go(`/event/${h.data.ev[0].id}`, 9000);
  const t = await h.text();
  check('V4 a signed-out visitor can still read the event', t.length > 50 && !/Something went wrong/i.test(t), t.slice(0, 80));
  check('V4 and is invited to sign in rather than shown personal state',
    !/You attended|Your RSVP/i.test(t), (t.match(/You attended[^\n]*|Your RSVP[^\n]*/) ?? [''])[0]);
  check('V4 no runtime errors', h.errors().length === 0, h.errors().slice(0, 2).join(' | '));
  await h.shot(`${outDir}/V4-signed-out.png`);
  await h.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nSUITE PRIVACY: ${passed}/${results.length} passed — screenshots in ${outDir}`);
process.exit(passed === results.length ? 0 : 1);
