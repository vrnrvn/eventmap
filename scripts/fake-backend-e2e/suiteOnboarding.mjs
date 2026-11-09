// Flow 1 — new-user onboarding, walked as a journey against the FAKE backend
// (no database): welcome → sign up → profile → interests → permissions →
// home area → privacy → tutorial → Discover; plus sign-in, forgot password,
// the "check your email" branch, back-outs, a failed save, and resuming after
// a reload mid-flow. Screenshots per step in outDir.
//
//   node scripts/fake-backend-e2e/suiteOnboarding.mjs <repo> <dist> [scenarios] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { open, check, results, sleep, UID } from './lib.mjs';
import { session } from './seed.mjs';

const [repo, dist, only, outDir = '/tmp/eventmap-onboarding'] = process.argv.slice(2);
const T0 = Date.now();
const origLog = console.log; console.log = (...a) => origLog(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const P = { repo, dist, viewport: [390, 844] };
const run = (k) => !only || only.split(',').includes(k);
fs.mkdirSync(outDir, { recursive: true });
const ROOT = `(document.querySelector('[data-testid^="onboarding-page-"]:not([inert])') || document.body)`;
let shotN = 0;
/** No single harness call may hang the run: 20 s cap, logged, then the suite moves on. */
const guard = (h) => {
  for (const k of ['eval', 'text', 'click', 'shot', 'go', 'history', 'close']) {
    const f = h[k].bind(h);
    h[k] = (...a) => {
      let timer;
      const cap = new Promise((r) => { timer = setTimeout(() => { console.log(`TIMEOUT ${k}(${String(a[0] ?? '').slice(0, 40)})`); r('TIMEOUT'); }, k === 'go' || k === 'close' ? 30000 : 20000); });
      return Promise.race([f(...a).finally(() => clearTimeout(timer)), cap]);
    };
  }
  return h;
};
const openG = async (opts) => {
  const h = guard(await open(opts));
  // All seven onboarding pages are in the DOM side by side. A user can only
  // reach the active one, so clicks and text reads are scoped to it (inactive
  // pages are `inert`); outside onboarding the whole document is used.
  const rawEval = h.eval;
  h.click = (text, exact = false) => rawEval(`(() => { const want = ${JSON.stringify(text)}; const root = ${ROOT};
    const els = [...root.querySelectorAll('[role=button],[role=tab],[role=link],a,button,[tabindex]')];
    const el = els.find((e) => { const t = (e.getAttribute('aria-label') || e.innerText || '').trim(); return ${exact} ? t === want : t.includes(want); });
    if (!el) return 'NOT FOUND'; el.scrollIntoView({ block: 'center' }); el.click(); return 'ok'; })()`);
  h.text = () => rawEval(`${ROOT}.innerText`);
  return h;
};
const shot = (h, name) => h.shot(path.join(outDir, `${String(++shotN).padStart(2, '0')}-${name}.png`));

/** Fake auth endpoints + a profiles table that actually applies PATCHes. */
function authOverrides({ confirmEmail = false } = {}) {
  const patches = [];
  return {
    patches,
    overrides: {
      '/auth/v1/signup': (r, data) => {
        const b = JSON.parse(r.body || '{}');
        data.signups = (data.signups || 0) + 1;
        Object.assign(data.profile, { has_completed_onboarding: false, name: b.data?.name ?? '', bio: null, hobbies: null, social_handles: null, city: null, lat: null, lng: null, avatar_url: null, preferred_categories: [] });
        const s = session(3600);
        s.user.user_metadata = { name: b.data?.name ?? '' };
        // Confirmation on: GoTrue returns the user with no session.
        return { json: confirmEmail ? { ...s.user, user_metadata: s.user.user_metadata } : s };
      },
      '/auth/v1/recover': () => ({ json: {} }),
      '/auth/v1/token': (r) => {
        const b = JSON.parse(r.body || '{}');
        if (b.password === 'wrong-password') return { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' } };
        return null; // default: a fresh session
      },
      '/rest/v1/profiles': (r, data) => {
        if (r.method === 'PATCH') {
          if (data.failNextPatch) { data.failNextPatch = false; return { status: 500, json: { message: 'boom' } }; }
          const b = JSON.parse(r.body || '{}');
          patches.push(b);
          Object.assign(data.profile, b);
          return { status: 204, raw: '' };
        }
        return null;
      },
    },
  };
}

/** Focus the input whose label/placeholder contains `label` (active page only) and type. */
const field = async (h, label, text) => {
  const r = await h.eval(`(() => { const el = [...${ROOT}.querySelectorAll('input,textarea')].find((i) => ((i.getAttribute('aria-label') || '') + ' ' + (i.getAttribute('placeholder') || '')).includes(${JSON.stringify(label)})); if (!el) return 'NOT FOUND'; el.focus(); return document.activeElement === el ? 'ok' : 'NOT FOCUSED'; })()`);
  if (r !== 'ok') { console.log(`field(${label}) → ${r}`); return r; }
  await h.send('Input.insertText', { text });
  return 'ok';
};
/** Focus the n-th visible <input>/<textarea> of a kind ('text' = anything not password) on the active page and type. */
const typeNth = async (h, kind, n, text, replace = false) => {
  const r = await h.eval(`(() => { const els = [...${ROOT}.querySelectorAll('input,textarea')].filter((i) => ${kind === 'password' ? "i.type === 'password'" : "i.type !== 'password'"} && i.offsetParent !== null); const el = els[${n}]; if (!el) return 'NOT FOUND'; el.focus(); ${replace ? 'el.select && el.select();' : ''} return 'ok'; })()`);
  if (r !== 'ok') { console.log(`typeNth(${kind},${n}) → ${r}`); return r; }
  if (replace) {
    // Clear through the native setter + input event, which React's controlled
    // inputs honour (select-all + Backspace does not reach RN-web's state).
    await h.eval(`(() => { const el = document.activeElement; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  }
  if (text) await h.send('Input.insertText', { text });
  return 'ok';
};
const clickAny = async (h, labels) => { for (const l of labels) { const r = await h.click(l); if (r === 'ok') return 'ok'; } return 'NOT FOUND'; };
const toggle = (h, label) => h.eval(`(() => { const root = ${ROOT}; const el = [...root.querySelectorAll('[role=switch],input[type=checkbox]')].find((e) => (e.getAttribute('aria-label') || '').includes(${JSON.stringify(label)})); if (!el) return 'NOT FOUND'; const before = el.getAttribute('aria-checked') ?? String(el.checked); el.click(); const input = el.querySelector && el.querySelector('input'); if (input && (el.getAttribute('aria-checked') ?? String(el.checked)) === before) input.click(); return 'ok:' + before; })()`);
const bodyHas = (h, text) => h.eval('document.body.innerText').then((t) => String(t).includes(text));
const has = (h, text) => h.text().then((t) => t.includes(text));
const step = (h) => h.eval(`(document.body.innerText.match(/Step (\\d) of 6/) || [])[1] || null`);
const disabled = (h, label) => h.eval(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((e) => (e.getAttribute('aria-label') || e.innerText || '').trim() === ${JSON.stringify(label)}); return b ? (b.getAttribute('aria-disabled') === 'true' || b.disabled === true) : 'NOT FOUND'; })()`);

// ---------------------------------------------------------------------------
if (run('J')) { // The whole journey, happy path with a failed save in the middle
  const { overrides, patches } = authOverrides();
  const h = await openG({ ...P, noSession: true, overrides });
  h.data.signups = 0;

  await h.go('/', 8000);
  check('J welcome shows Get Started + Sign In', await has(h, 'Get Started') && await has(h, 'Sign In'));
  await shot(h, 'welcome');
  check('J Get Started → sign up', (await h.click('Get Started')) === 'ok'); await sleep(1500);
  check('J sign-up screen', await has(h, 'Create an Account'));

  // Validation first
  await h.click('Sign Up', true); await sleep(600);
  const t1 = await h.text();
  check('J sign-up validation: name/email/password required', /required/i.test(t1), t1.slice(0, 120));
  await typeNth(h, 'text', 0, 'Nova Tester');
  await typeNth(h, 'text', 1, 'nova@example.test');
  await typeNth(h, 'password', 0, 'short');
  await typeNth(h, 'password', 1, 'short');
  await h.click('Sign Up', true); await sleep(600);
  check('J sign-up: short password refused', await has(h, 'Minimum 8 characters'));
  await typeNth(h, 'password', 0, 'LongEnough123!', true);
  await h.click('Sign Up', true); await sleep(600);
  check('J sign-up: mismatched confirmation refused', await has(h, 'Passwords do not match'));
  await typeNth(h, 'password', 1, 'LongEnough123!', true);
  await shot(h, 'signup-filled');
  await h.click('Sign Up', true); await sleep(7000);
  check('J sign-up posted once', h.data.signups === 1, `signups=${h.data.signups}`);
  check('J lands on onboarding welcome', await has(h, "Let's Get Started"), (await h.text()).slice(0, 100));
  await shot(h, 'onboarding-welcome');

  await h.click("Let's Get Started"); await sleep(900);
  check('J step 1 of 6 = profile', (await step(h)) === '1' && await has(h, 'Make it yours'));
  check('J inactive pages are inert (not focusable / announced)', (await h.eval(`document.querySelectorAll('[data-testid^="onboarding-page-"][inert]').length`)) === 6 && (await h.eval(`document.querySelectorAll('[data-testid^="onboarding-page-"]:not([inert])').length`)) === 1);
  check('J name prefilled from sign-up', await h.eval(`[...document.querySelectorAll('input')].some((i) => i.value === 'Nova Tester')`));
  check('J no Skip on the profile step for a new user', !(await has(h, 'Skip')));
  // Clear the name → Continue disabled + error
  await typeNth(h, 'text', 0, '', true); await sleep(400);
  check('J empty name: Continue disabled', (await disabled(h, 'Continue')) === true);
  check('J empty name: inline error', await has(h, 'Your name is required'));
  await typeNth(h, 'text', 0, 'Nova T.');
  await field(h, 'What should people know', 'Live music and long walks.');
  await field(h, 'yourhandle', '@nova');
  await shot(h, 'profile-filled');
  // Failed save: stays on the step, shows an error
  h.data.failNextPatch = true;
  await h.click('Continue'); await sleep(1500);
  check('J failed save keeps the user on step 1 with an error toast', (await step(h)) === '1' && /Failed|boom|try again/i.test(await h.eval('document.body.innerText')), (await h.eval('document.body.innerText')).slice(0, 160));
  await h.click('Continue'); await sleep(1500);
  check('J profile saved: name trimmed, handle without @', patches.some((p) => p.name === 'Nova T.' && p.social_handles?.instagram === 'nova' && p.bio === 'Live music and long walks.'), JSON.stringify(patches.at(-1)));
  check('J step 2 = interests', (await step(h)) === '2' && await has(h, 'What interests you?'));
  await shot(h, 'interests');
  check('J interests: button reads "Skip for now" with nothing picked', await has(h, 'Skip for now'));
  await h.click('Music'); await h.click('Food'); await sleep(300);
  check('J interests: button reads Continue after picking', await has(h, 'Continue') && !(await has(h, 'Skip for now')));
  await h.click('Continue'); await sleep(1500);
  check('J interests saved (2 categories)', (patches.at(-1)?.preferred_categories || []).length === 2, JSON.stringify(patches.at(-1)));
  check('J step 3 = permissions', (await step(h)) === '3');
  await shot(h, 'permissions');
  // Back then forward keeps the picks
  await h.click('Go back'); await sleep(700);
  check('J back from permissions → interests still picked', (await step(h)) === '2' && (await h.eval(`document.querySelectorAll('[role=checkbox][aria-checked="true"],[role=radio][aria-checked="true"]').length`)) === 2);
  await h.click('Continue'); await sleep(1200);
  await h.click('Continue without'); await sleep(900);
  check('J step 4 = home area', (await step(h)) === '4' && await has(h, 'Where are you based?'));
  await shot(h, 'home-area');
  check('J home area: new user has no prefilled area', !(await has(h, 'currently')) && await has(h, 'Tap to pick a spot on the map'));
  check('J home area: Set location on map opens the picker', (await clickAny(h, ['Set location on map', 'Change location'])) === 'ok'); await sleep(3500);
  const pickerText = await h.eval('document.body.innerText');
  check('J map picker screen shows Confirm location', /Confirm location|Confirm/.test(pickerText), pickerText.slice(0, 120));
  await shot(h, 'map-picker');
  await h.history('history.back()', 2000);
  check('J back from picker returns to step 4', (await step(h)) === '4');
  await h.click('Continue without'); await sleep(900);
  check('J step 5 = privacy', (await step(h)) === '5' && await has(h, 'Privacy & visibility'));
  check('J privacy preview shows the entered name', await has(h, 'Nova T.'));
  await shot(h, 'privacy');
  const tg = await toggle(h, 'Show my profile to others'); await sleep(400);
  const nowChecked = await h.eval(`(() => { const el = [...${ROOT}.querySelectorAll('[role=switch],input[type=checkbox]')].find((e) => (e.getAttribute('aria-label') || '').includes('Show my profile to others')); return el ? (el.getAttribute('aria-checked') ?? String(el.checked)) : 'NF'; })()`);
  check('J privacy: switch toggles on click', tg.startsWith('ok') && nowChecked === 'false', `toggle=${tg} now=${nowChecked}`);
  await h.click('Continue'); await sleep(1500);
  check('J privacy saved: profile private', patches.at(-1)?.is_profile_private === true, JSON.stringify(patches.at(-1)));
  check('J step 6 = tutorial', (await step(h)) === '6' && await has(h, "You're all set"));
  await shot(h, 'tutorial');
  await h.click('Start Exploring'); await sleep(6000);
  const fin = patches.at(-1) || {};
  check('J final write: completed flag + every field', fin.has_completed_onboarding === true && fin.name === 'Nova T.' && fin.is_profile_private === true && (fin.preferred_categories || []).length === 2, JSON.stringify(fin));
  check('J lands on Discover', await has(h, 'Discover') && !(await has(h, 'Step ')));
  const keys = await h.eval('Object.keys(localStorage).join(",")').then((k) => String(k).split(','));
  check('J onboarding draft cleared', !keys.some((k) => /onboarding/i.test(k)), keys.filter((k) => /onboard/i.test(k)).join(','));
  await shot(h, 'discover-after');
  // Reload: must stay on Discover, not bounce back into onboarding
  await h.go('/', 7000);
  check('J reload after completion stays out of onboarding', await has(h, 'Discover') && !(await has(h, 'Step ')));
  check('J no uncaught exceptions', h.errors().length === 0, h.errors().slice(0, 3).join(' | '));
  console.log('J writes:', h.requests.filter((r) => r.method !== 'GET' && r.method !== 'OPTIONS').map((r) => `${r.method} ${r.path.replace('/rest/v1/', '')} ${(r.body || '').slice(0, 90)}`).join('\n  '));
  console.log('J unknown endpoints:', h.unknown.join(' ; ') || 'none');
  await h.close();
}

// ---------------------------------------------------------------------------
if (run('R')) { // Resume: kill mid-flow, reopen → same step, same answers; and a returning user is never re-onboarded
  const { overrides } = authOverrides();
  const h2 = await openG({ ...P, overrides });
  h2.data.profile.has_completed_onboarding = false; h2.data.profile.name = ''; h2.data.profile.preferred_categories = [];
  await h2.go('/', 8000);
  check('R signed-in user without completed onboarding is routed into it', await has(h2, "Let's Get Started"), (await h2.text()).slice(0, 80));
  await h2.click("Let's Get Started"); await sleep(800);
  check('R name falls back to the session name', await h2.eval(`[...document.querySelectorAll('input')].some((i) => i.value === 'Test User')`));
  await field(h2, 'What should people know', 'Draft bio');
  await h2.click('Continue'); await sleep(1200);
  await h2.click('Sports'); await sleep(800); // draft debounce is 400 ms
  const before = await step(h2);
  await h2.go('/', 8000); // "kill and reopen"
  check('R reopen resumes on the same step', (await step(h2)) === before && before === '2', `before=${before} after=${await step(h2)}`);
  check('R reopen keeps the picked interest', (await h2.eval(`document.querySelectorAll('[aria-checked="true"]').length`)) === 1);
  await h2.click('Go back'); await sleep(700);
  check('R bio draft survived the reload', await h2.eval(`[...${ROOT}.querySelectorAll('textarea,input')].some((i) => i.value.includes('Draft bio'))`));
  await shot(h2, 'resumed');
  // Returning user: completed flag set → never sees onboarding, draft or not
  h2.data.profile.has_completed_onboarding = true;
  await h2.go('/', 8000);
  check('R completed user goes straight to Discover', await has(h2, 'Discover') && !(await has(h2, 'Step ')));
  check('R no uncaught exceptions', h2.errors().length === 0, h2.errors().slice(0, 3).join(' | '));
  await h2.close();
}

// ---------------------------------------------------------------------------
if (run('A')) { // Sign-in paths: wrong password, success → Discover, forgot password, email-confirmation sign-up branch
  const h2 = await openG({ ...P, noSession: true, overrides: authOverrides().overrides });
  await h2.go('/', 7000);
  await h2.click('Already have an account? Sign In'); await sleep(1500);
  check('A sign-in screen', await has(h2, 'Welcome Back'));
  await h2.click('Go to sign up'); await sleep(1200);
  await h2.click('Go to log in'); await sleep(1200);
  check('A sign-up ↔ sign-in links swap screens (one sign-in form mounted)', await has(h2, 'Welcome Back') && (await h2.eval(`[...document.querySelectorAll('[role=button]')].filter((b) => (b.innerText || '').trim() === 'Login').length`)) === 1);
  await h2.click('Login', true); await sleep(500);
  check('A sign-in validation', await has(h2, 'Email is required'));
  await typeNth(h2, 'text', 0, 'nova@example.test');
  await typeNth(h2, 'password', 0, 'wrong-password');
  await h2.click('Login', true); await sleep(2500);
  const t = await h2.text();
  check('A wrong password: clear error, stays on sign-in', /not right|Invalid|incorrect|wrong|didn.t match/i.test(t) && await has(h2, 'Welcome Back'), t.slice(-160));
  await shot(h2, 'login-wrong-password');
  // forgot password
  await h2.click('Forgot password'); await sleep(1500);
  check('A forgot-password screen', await has(h2, 'Forgot Password?'));
  await typeNth(h2, 'text', 0, 'nova@example.test');
  await h2.click('Send Reset Link', true); await sleep(2500);
  check('A reset link "sent" confirmation', /sent a password reset link|Check your email/i.test(await h2.text()), (await h2.text()).slice(0, 140));
  await shot(h2, 'forgot-sent');
  await h2.click('Back to Sign In'); await sleep(1500);
  check('A back to sign-in', await has(h2, 'Welcome Back'));
  check('A exactly one sign-in form mounted (no stale copy underneath)', (await h2.eval(`[...document.querySelectorAll('[role=button]')].filter((b) => (b.innerText || '').trim() === 'Login').length`)) === 1);
  check('A the form kept what was typed (email), so only the password needs retyping', await h2.eval(`[...document.querySelectorAll('input')].some((i) => i.value === 'nova@example.test')`));
  // success
  await typeNth(h2, 'text', 0, 'nova@example.test', true);
  await typeNth(h2, 'password', 0, 'LongEnough123!', true);
  await h2.click('Login', true); await sleep(7000);
  check('A sign-in success → Discover (profile already onboarded)', await has(h2, 'Discover'), (await h2.text()).slice(0, 100));
  await h2.close();

  // Sign-up with email confirmation on → "check your email" → login prefilled
  const h4 = await openG({ ...P, noSession: true, overrides: authOverrides({ confirmEmail: true }).overrides });
  await h4.go('/signup', 7000);
  await typeNth(h4, 'text', 0, 'Confirm Me');
  await typeNth(h4, 'text', 1, 'confirm@example.test');
  await typeNth(h4, 'password', 0, 'LongEnough123!');
  await typeNth(h4, 'password', 1, 'LongEnough123!');
  await h4.click('Sign Up', true); await sleep(4000);
  const t4 = await h4.text();
  check('A confirmation-required sign-up → sign-in with email prefilled + toast', await has(h4, 'Welcome Back') && await h4.eval(`[...document.querySelectorAll('input')].some((i) => i.value === 'confirm@example.test')`), t4.slice(0, 160));
  check('A confirmation toast shown', /Check your email/i.test(t4), t4.slice(0, 100));
  await shot(h4, 'signup-confirm-branch');
  check('A no uncaught exceptions', h4.errors().length === 0, h4.errors().slice(0, 3).join(' | '));
  await h4.close();
}

fs.writeFileSync(path.join(outDir, 'onboarding-report.json'), JSON.stringify(results, null, 2));
console.log(`\nSUITE ONBOARDING: ${results.filter((r) => r.ok).length}/${results.length} passed — screenshots in ${outDir}`);
process.exit(0);
