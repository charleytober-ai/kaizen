// Kaizen: a bad-day-proof habit and project tracker.
// Saved data is read and written only through store.js, so storage can be swapped later.
import { load, save, askToKeep } from './store.js';

const DEFAULT_SETTINGS = {
  raiseThreshold: 0.6,
  raiseMinDays: 8,
  dayStartHour: 4,
  labels: { shit: 'Shit', ok: 'OK', good: 'Pretty good' },
  lastBackup: null,
};
const MODES = ['shit', 'ok', 'good'];
const MODE_HINT = { shit: 'Rest. Nothing to do.', ok: 'The small versions.', good: 'The full versions.' };

let state = null;
const ui = { tab: 'today', month: null, project: null, habitEdit: null, showRest: false, day: null };
let canShareFiles = false;

/* ---------- small helpers ---------- */

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d || 1, 12); };
const dayStartHour = () => (state && state.settings ? state.settings.dayStartHour : DEFAULT_SETTINGS.dayStartHour) || 0;
const todayKey = () => keyOf(new Date(Date.now() - dayStartHour() * 3600e3));
const monthOf = k => k.slice(0, 7);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return keyOf(new Date(y, mo - 1 + n, 1, 12)).slice(0, 7); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const weekStart = k => { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d); };
const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const round1 = n => Math.round(n * 10) / 10;
const num = v => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const lab = () => state.settings.labels;

const fmtDay = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShortDay = k => parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtWeekday = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'long' });
const fmtMonth = m => parseKey(m).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const fmtStamp = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const shelfLabel = m => {
  const d = parseKey(m);
  const sameYear = m.slice(0, 4) === todayKey().slice(0, 4);
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short' } : { month: 'short', year: 'numeric' });
};

const habit = id => state.habits.find(h => h.id === id);
const project = id => state.projects.find(p => p.id === id);
const catName = id => (state.categories.find(c => c.id === id) || {}).name || '';
const activeHabits = () => state.habits.filter(h => h.active);

function unitWord(n, u) {
  if (!u) return '';
  if (n === 1 && /s$/.test(u) && !/\s/.test(u)) return u.slice(0, -1);
  return u;
}
function amountText(h, n) {
  if (h.type === 'done' || n === null || n === undefined) return '';
  return `${n} ${unitWord(n, h.unit)}`.trim();
}

/* ---------- starting data ---------- */

function seed() {
  const created = todayKey();
  const month = monthOf(created);
  const h = (id, name, category, type, unit, freq, ok, okNote, good, goodNote, step) => ({
    id, name, category, type, unit, freq, ok, okNote, good, goodNote, step,
    active: true, created, history: [{ month, since: created, ok, good }],
  });
  return {
    version: 1,
    categories: [
      { id: 'body', name: 'Body' },
      { id: 'medical', name: 'Medical' },
      { id: 'legal', name: 'Legal' },
      { id: 'work', name: 'Work' },
      { id: 'safety', name: 'Safety' },
      { id: 'selfcare', name: 'Self-care' },
      { id: 'church', name: 'Church' },
    ],
    habits: [
      h('treadmill', 'Treadmill', 'body', 'count', 'min', 'daily', 20, 'slow, flat', 30, '', 1),
      h('protein', 'Protein', 'body', 'count', 'servings', 'daily', 1, 'a real serving or a shake', 3, 'one at each meal', null),
      h('squats', 'Chair squats', 'body', 'count', 'reps', 'daily', 5, 'shallow and slow', 30, '3 sets of 10', 1),
      h('birddogs', 'Bird dogs', 'body', 'count', 'each side', 'daily', 3, 'leg-only is fine', 24, '3 sets of 8', 1),
      h('bridges', 'Glute bridges', 'body', 'count', 'reps', 'daily', 5, '', 30, '3 sets of 10', 1),
      h('pushups', 'Wall push-ups', 'body', 'count', 'reps', 'daily', 5, '', 30, '3 sets of 10', 1),
      h('skin', 'Skin routine', 'selfcare', 'done', '', 'daily', null, 'easy version', null, 'full routine', null),
      h('church', 'Church', 'church', 'done', '', 'weekly', null, '', null, '', null),
    ],
    projects: [],
    days: {},
    raises: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  };
}

function normalize(s) {
  s.version = s.version || 1;
  s.categories = Array.isArray(s.categories) ? s.categories : [];
  s.habits = Array.isArray(s.habits) ? s.habits : [];
  s.projects = Array.isArray(s.projects) ? s.projects : [];
  s.days = s.days && typeof s.days === 'object' ? s.days : {};
  s.raises = Array.isArray(s.raises) ? s.raises : [];
  const st = s.settings || {};
  s.settings = { ...DEFAULT_SETTINGS, ...st, labels: { ...DEFAULT_SETTINGS.labels, ...(st.labels || {}) } };
  const fallback = keyOf(new Date());
  for (const h of s.habits) {
    if (!h.created) h.created = fallback;
    if (h.active === undefined) h.active = true;
    if (!Array.isArray(h.history) || !h.history.length) h.history = [{ month: monthOf(h.created), ok: h.ok ?? null, good: h.good ?? null }];
  }
  for (const p of s.projects) {
    p.steps = Array.isArray(p.steps) ? p.steps : [];
    p.notes = Array.isArray(p.notes) ? p.notes : [];
    p.status = p.status || 'active';
  }
  for (const d of Object.values(s.days)) {
    d.log = d.log || {};
    d.work = d.work || [];
    if (d.note == null) d.note = '';
  }
  return s;
}

/* ---------- model ---------- */

function commit() {
  if (!save(state)) toast("Couldn't save on this phone. Make a backup in More.");
}

function getDay(k, create = false) {
  let d = state.days[k];
  if (!d && create) d = state.days[k] = { mode: null, log: {}, work: [], note: '' };
  return d;
}

// Each history entry says which amounts apply from a given day onward.
// Every day is judged by the amounts in effect that day, so a raise never takes back a pebble.
const sinceOf = e => e.since || `${e.month}-01`;
const sortedHistory = h => (h.history || []).slice().sort((a, b) => (sinceOf(a) < sinceOf(b) ? -1 : 1));
const lastDayOf = m => addDays(`${shiftMonth(m, 1)}-01`, -1);

function amountsOn(h, k) {
  const hist = sortedHistory(h);
  let pick = hist[0] || { ok: h.ok, good: h.good };
  for (const e of hist) if (sinceOf(e) <= k) pick = e;
  return pick;
}

// The amounts a month ended on.
const amountsFor = (h, month) => amountsOn(h, lastDayOf(month));

// The newest amounts, including a raise that starts tomorrow.
function currentAmounts(h) {
  const hist = sortedHistory(h);
  return hist[hist.length - 1] || { ok: h.ok, good: h.good };
}

function setAmounts(h, k, ok, good) {
  h.history = h.history || [];
  let e = h.history.find(x => sinceOf(x) === k);
  if (!e) { e = { month: monthOf(k), since: k }; h.history.push(e); }
  e.ok = ok;
  e.good = good;
  h.history.sort((a, b) => (sinceOf(a) < sinceOf(b) ? -1 : 1));
  h.ok = ok;
  h.good = good;
}

// Did this logged value reach that day's OK amount?
function hitsOK(h, v, k) {
  if (h.type === 'done') return !!v;
  return (Number(v) || 0) >= amountsOn(h, k).ok;
}

// Does this logged value drop a pebble? On a Shit day, anything counts.
function earnsPebble(h, v, mode, k) {
  if (h.type === 'done') return !!v;
  const n = Number(v) || 0;
  if (n <= 0) return false;
  return mode === 'shit' || n >= amountsOn(h, k).ok;
}

// Pebbles are worked out from the log, never stored, so they can't drift.
function pebblesFor(month) {
  const list = [];
  const keys = Object.keys(state.days).filter(k => monthOf(k) === month).sort();
  for (const k of keys) {
    const d = state.days[k];
    for (const [hid, v] of Object.entries(d.log || {})) {
      const h = habit(hid);
      if (h && earnsPebble(h, v, d.mode, k)) list.push({ shiny: false, k });
    }
    for (const w of d.work || []) list.push({ shiny: w.kind !== 'worked', k });
  }
  for (const r of state.raises) {
    if (r.accepted && r.at && monthOf(r.at) === month) list.push({ shiny: true, k: r.at });
  }
  list.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return list;
}

// Daily habit stats for a month. Only days with a check-in that weren't Shit days count.
function habitStats(h, month) {
  let days = 0, hits = 0;
  for (const [k, d] of Object.entries(state.days)) {
    if (monthOf(k) !== month || !d.mode || d.mode === 'shit' || k < h.created) continue;
    days++;
    const v = d.log && d.log[h.id];
    if (v !== undefined && hitsOK(h, v, k)) hits++;
  }
  return { days, hits, rate: days ? hits / days : 0 };
}

function timesDone(h, month) {
  let n = 0;
  for (const [k, d] of Object.entries(state.days)) {
    if (monthOf(k) !== month) continue;
    const v = d.log && d.log[h.id];
    if (v && (h.type === 'done' || Number(v) > 0)) n++;
  }
  return n;
}

function weeklyDoneOn(h, k) {
  const ws = weekStart(k);
  for (let i = 0; i < 7; i++) {
    const dk = addDays(ws, i);
    if (dk === k) continue;
    const v = state.days[dk] && state.days[dk].log[h.id];
    if (v && (h.type === 'done' || Number(v) > 0)) return dk;
  }
  return null;
}

function usedIn(h, month) {
  return Object.entries(state.days).some(([k, d]) => monthOf(k) === month && d.log && d.log[h.id] !== undefined);
}

function pendingRaises() {
  const cur = monthOf(todayKey());
  const prev = shiftMonth(cur, -1);
  const { raiseThreshold, raiseMinDays } = state.settings;
  const out = [];
  for (const h of state.habits) {
    if (!h.active || h.type !== 'count' || h.freq !== 'daily' || !h.step) continue;
    if (monthOf(h.created) > prev) continue;
    if (state.raises.some(r => r.month === prev && r.habit === h.id)) continue;
    const s = habitStats(h, prev);
    if (s.days >= raiseMinDays && s.rate >= raiseThreshold) out.push({ h, s, from: currentAmounts(h) });
  }
  return out;
}

function acceptRaise(hid) {
  const h = habit(hid);
  if (!h) return;
  const k = todayKey();
  const a = currentAmounts(h);
  const ok = round1(a.ok + h.step);
  const good = round1(Math.max(a.good ?? a.ok, a.ok) + h.step);
  // If today's already logged, the new amount starts tomorrow so today's pebble stays.
  const loggedToday = state.days[k] && state.days[k].log[h.id] !== undefined;
  setAmounts(h, loggedToday ? addDays(k, 1) : k, ok, good);
  state.raises.push({ month: shiftMonth(monthOf(k), -1), habit: h.id, from: a.ok, to: ok, accepted: true, at: k });
}

function skipRaise(hid) {
  const cur = monthOf(todayKey());
  state.raises.push({ month: shiftMonth(cur, -1), habit: hid, accepted: false, at: todayKey() });
}

function setLog(hid, value) {
  const h = habit(hid);
  if (!h) return;
  const k = todayKey();
  const d = getDay(k, true);
  const before = d.log[hid] !== undefined && earnsPebble(h, d.log[hid], d.mode, k);
  if (h.type === 'done') {
    if (value) d.log[hid] = true; else delete d.log[hid];
  } else {
    const n = Math.max(0, round1(Number(value) || 0));
    if (n) d.log[hid] = n; else delete d.log[hid];
  }
  const after = d.log[hid] !== undefined && earnsPebble(h, d.log[hid], d.mode, k);
  commit();
  render();
  if (after && !before) toast('That counts.');
}

function completeStep(p, s, k) {
  s.doneOn = k;
  getDay(k, true).work.push({ project: p.id, kind: 'step', step: s.id });
}

function uncompleteStep(p, s) {
  const d = s.doneOn && state.days[s.doneOn];
  if (d) d.work = d.work.filter(w => !(w.kind === 'step' && w.step === s.id));
  s.doneOn = null;
}

function setProjectStatus(p, status) {
  if (status === p.status) return;
  const k = todayKey();
  if (p.status === 'done' && p.finishedOn) {
    const d = state.days[p.finishedOn];
    if (d) d.work = d.work.filter(w => !(w.kind === 'finish' && w.project === p.id));
    p.finishedOn = null;
  }
  if (status === 'done') {
    getDay(k, true).work.push({ project: p.id, kind: 'finish' });
    p.finishedOn = k;
  }
  p.status = status;
}

function firstMonth() {
  let m = monthOf(todayKey());
  for (const k of Object.keys(state.days)) if (monthOf(k) < m) m = monthOf(k);
  for (const h of state.habits) if (monthOf(h.created) < m) m = monthOf(h.created);
  return m;
}

function headline(m) {
  const prev = shiftMonth(m, -1);
  const hs = state.habits.filter(h =>
    h.type === 'count' && h.freq === 'daily' && monthOf(h.created) <= prev && (h.active || usedIn(h, m)));
  if (!hs.length) return 'First month. Nothing to compare yet.';
  const up = hs.filter(h => amountsFor(h, m).ok > amountsFor(h, prev).ok).length;
  return `${lab().ok} amounts up on ${up} of ${plural(hs.length, 'habit')}.`;
}

function projectMoves(m) {
  const out = [];
  for (const p of state.projects) {
    let worked = 0, steps = 0, finished = false;
    for (const [k, d] of Object.entries(state.days)) {
      if (monthOf(k) !== m) continue;
      for (const w of d.work || []) {
        if (w.project !== p.id) continue;
        if (w.kind === 'worked') worked++;
        else if (w.kind === 'step') steps++;
        else if (w.kind === 'finish') finished = true;
      }
    }
    if (worked || steps || finished) out.push({ p, worked, steps, finished });
  }
  return out;
}

/* ---------- the jar ---------- */

const STONES = ['#a7aeb0', '#bfb3a2', '#9aa898', '#b09d8f', '#8f9cab', '#c9beae', '#a1b0a6', '#b6a99c'];
const JAR_BODY = 'M70 26 L70 40 C70 50 30 52 30 78 L30 212 C30 224 38 232 52 232 L148 232 C162 232 170 224 170 212 L170 78 C170 52 130 50 130 40 L130 26 Z';
let svgSeq = 0;

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function jarSVG(pebbles, seedKey, cls) {
  const id = `jar${++svgSeq}`;
  const rnd = mulberry(hash(seedKey));
  const left = 36, right = 164, bottom = 227, top = 84;
  const W = right - left, H = bottom - top, n = pebbles.length;
  const fits = r => Math.max(1, Math.floor(W / (r * 2.25))) * Math.floor(H / (r * 1.6));
  let r = 11;
  while (r > 2.5 && fits(r) < n) r -= 0.25;
  const cw = r * 2.25, rh = r * 1.6, cols = Math.max(1, Math.floor(W / cw));
  const x0 = left + (W - cols * cw) / 2;
  let body = '';
  pebbles.forEach((p, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const stagger = (row % 2 ? 0.18 : -0.18) * cw;
    const cx = x0 + cw * (col + 0.5) + stagger + (rnd() - 0.5) * r * 0.4;
    const cy = bottom - rh * (row + 0.5) + (rnd() - 0.5) * r * 0.3;
    const rx = r * (1.0 + rnd() * 0.2), ry = r * (0.72 + rnd() * 0.16);
    const rot = Math.round((rnd() - 0.5) * 50);
    const stone = STONES[Math.floor(rnd() * STONES.length)];
    const fill = p.shiny ? `url(#${id}s)` : stone;
    const c = `${cx.toFixed(1)} ${cy.toFixed(1)}`;
    body += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot} ${c})" fill="${fill}" stroke="rgba(0,0,0,.2)" stroke-width="${Math.max(0.6, r * 0.08).toFixed(2)}"/>`;
    if (p.shiny) {
      body += `<ellipse cx="${(cx - rx * 0.35).toFixed(1)}" cy="${(cy - ry * 0.35).toFixed(1)}" rx="${(rx * 0.28).toFixed(1)}" ry="${(ry * 0.22).toFixed(1)}" transform="rotate(${rot} ${c})" fill="#fffbe8" opacity=".85"/>`;
    }
  });
  return `<svg class="${cls}" viewBox="0 0 200 244" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="${id}s" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#f0bd45"/><stop offset="1" stop-color="#b8790f"/></radialGradient>
      <clipPath id="${id}c"><path d="${JAR_BODY}"/></clipPath>
    </defs>
    <path d="${JAR_BODY}" style="fill:var(--glass)"/>
    <g clip-path="url(#${id}c)">${body}</g>
    <path d="${JAR_BODY}" style="fill:none;stroke:var(--jar-line)" stroke-width="4" stroke-linejoin="round"/>
    <path d="M45 94 L45 198" style="stroke:var(--jar-shine)" stroke-width="5" stroke-linecap="round"/>
    <rect x="62" y="13" width="76" height="14" rx="5" style="fill:var(--bg);stroke:var(--jar-line)" stroke-width="4"/>
  </svg>`;
}

const PEBBLE_ICON = '<svg class="pebble-icon" viewBox="0 0 20 14" aria-hidden="true"><ellipse cx="10" cy="7" rx="9" ry="6" fill="currentColor"/></svg>';

/* ---------- Today ---------- */

function renderToday() {
  const k = todayKey();
  const d = getDay(k);
  const month = monthOf(k);
  const L = lab();
  const mode = d && d.mode;
  const pebs = pebblesFor(month);

  let html = `<header class="top">
    <div><div class="eyebrow">Today</div><h1 class="date">${esc(fmtDay(k))}</h1></div>
    <button class="jar-mini" data-act="tab" data-tab="month" aria-label="This month's jar: ${plural(pebs.length, 'pebble')}">
      ${jarSVG(pebs, month, 'mini')}<span>${pebs.length}</span>
    </button>
  </header>`;

  if (!mode) {
    html += `<section class="pick"><h2>How's today?</h2>
      ${MODES.map(m => `<button class="mode" data-act="mode" data-mode="${m}"><b>${esc(L[m])}</b><span>${MODE_HINT[m]}</span></button>`).join('')}
    </section>`;
    return html;
  }

  html += `<div class="seg" role="group" aria-label="Today is">
    ${MODES.map(m => `<button data-act="mode" data-mode="${m}" aria-pressed="${m === mode}">${esc(L[m])}</button>`).join('')}
  </div>`;

  if (mode === 'shit') {
    html += `<p class="rest">${esc(L.shit)} day. Nothing to do.<br>Your ${esc(L.ok)} versions are here if you want them.</p>`;
    const anyLogged = Object.keys(d.log).length > 0;
    if (ui.showRest || anyLogged) html += habitsSection(d, 'ok', k);
    else html += `<button class="btn wide" data-act="show-rest">Show them</button>`;
  } else {
    html += renderRaiseCard();
    html += habitsSection(d, mode, k);
    html += projectsToday(k);
  }
  html += `<label class="field note-field"><span>Note</span>
    <input type="text" maxlength="200" placeholder="One line about today, if you want" value="${esc(d.note || '')}" data-input="note" data-change="note" autocomplete="off">
  </label>`;
  return html;
}

function habitsSection(d, mode, k) {
  const hs = activeHabits();
  if (!hs.length) return `<p class="muted">No habits yet. Add them in More.</p>`;
  return `<h2 class="sec">Habits</h2>` + hs.map(h => habitCard(h, d, mode, k)).join('');
}

function habitCard(h, d, mode, k) {
  const a = amountsOn(h, k);
  const target = mode === 'good' ? a.good : a.ok;
  const note = mode === 'good' ? h.goodNote : h.okNote;
  const v = d.log[h.id];
  const weekly = h.freq === 'weekly';
  const counts = v !== undefined && earnsPebble(h, v, d.mode, k);
  const elsewhere = weekly && v === undefined ? weeklyDoneOn(h, k) : null;

  const parts = [];
  if (h.type === 'count') parts.push(esc(amountText(h, target)));
  if (note) parts.push(esc(note));
  const targetLine = `${weekly ? '<span class="tag">Once a week</span> ' : ''}${parts.join(' · ')}`;

  let controls;
  if (elsewhere) {
    controls = `<p class="muted done-else">Done ${esc(fmtWeekday(elsewhere))}. That counts for this week.</p>`;
  } else if (h.type === 'done') {
    controls = `<button class="btn wide toggle" data-act="toggle" data-id="${h.id}" aria-pressed="${!!v}">${v ? 'Done' : 'Did it'}</button>`;
  } else {
    const val = v === undefined ? '' : v;
    controls = `<div class="count">
      <button class="stepper" data-act="dec" data-id="${h.id}" aria-label="One less">&minus;</button>
      <input class="num" type="number" inputmode="decimal" min="0" step="any" value="${val}" placeholder="0" data-change="log" data-id="${h.id}" aria-label="${esc(h.name)}, amount done">
      <button class="stepper" data-act="inc" data-id="${h.id}" aria-label="One more">+</button>
      <button class="btn did" data-act="did" data-id="${h.id}" data-n="${target}" aria-pressed="${(Number(v) || 0) >= target}">Did ${target}</button>
    </div>`;
  }

  return `<div class="card habit${counts || elsewhere ? ' counts' : ''}">
    <div class="h-top"><span class="h-name">${esc(h.name)}</span>${counts ? `<span class="counts-tag">${PEBBLE_ICON}counts</span>` : ''}</div>
    ${targetLine ? `<div class="h-target">${targetLine}</div>` : ''}
    ${controls}
  </div>`;
}

function projectsToday(k) {
  const ps = state.projects.filter(p => p.status === 'active');
  if (!ps.length) {
    return `<h2 class="sec">Projects</h2><p class="muted">No projects yet. <button class="link" data-act="tab" data-tab="projects">Add one</button></p>`;
  }
  return `<h2 class="sec">Projects</h2>` + ps.map(p => projectCard(p, k)).join('');
}

function projectCard(p, k) {
  const d = getDay(k);
  const work = (d && d.work) || [];
  const worked = work.some(w => w.project === p.id && w.kind === 'worked');
  const stepsToday = work.filter(w => w.project === p.id && w.kind === 'step').length;
  const next = p.steps.find(s => !s.doneOn);
  return `<div class="card project">
    <button class="p-head" data-act="open-project" data-id="${p.id}">
      ${p.category ? `<span class="cat">${esc(catName(p.category))}</span>` : ''}
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-next">${next ? `Next: ${esc(next.text)}` : 'No next step written yet.'}</span>
    </button>
    <div class="p-btns">
      <button class="btn" data-act="worked" data-id="${p.id}" aria-pressed="${worked}">Worked on it</button>
      ${next
        ? `<button class="btn" data-act="step-done" data-id="${p.id}" data-step="${next.id}">Step done</button>`
        : `<button class="btn" data-act="open-project" data-id="${p.id}">Add a step</button>`}
    </div>
    ${stepsToday ? `<p class="muted small">${plural(stepsToday, 'step')} done today.</p>` : ''}
  </div>`;
}

function renderRaiseCard() {
  const pend = pendingRaises();
  if (!pend.length) return '';
  const L = lab();
  const prev = shiftMonth(monthOf(todayKey()), -1);
  return `<section class="card raise">
    <h2>${esc(fmtMonth(prev))} is done.</h2>
    <p>You did your ${esc(L.ok)} amount most days on ${pend.length === 1 ? 'this one. Bump it' : 'these. Bump them'} up a hair?</p>
    ${pend.map(({ h, s, from }) => {
      const to = round1(from.ok + h.step);
      const toGood = round1(Math.max(from.good ?? from.ok, from.ok) + h.step);
      return `<div class="raise-row">
        <div class="raise-name">${esc(h.name)}</div>
        <div class="raise-amt">${esc(L.ok)}: ${from.ok} → <b>${esc(amountText(h, to))}</b></div>
        <div class="muted small">${esc(L.good)} goes to ${toGood} too. You hit it on ${s.hits} of ${plural(s.days, 'day')}.</div>
        <div class="two">
          <button class="btn primary" data-act="raise-yes" data-id="${h.id}">Bump it</button>
          <button class="btn" data-act="raise-skip" data-id="${h.id}">Skip</button>
        </div>
      </div>`;
    }).join('')}
  </section>`;
}

/* ---------- Projects ---------- */

function renderProjects() {
  if (ui.project) {
    const p = project(ui.project);
    if (p) return renderProject(p);
    ui.project = null;
  }
  const groups = { active: [], waiting: [], done: [] };
  for (const p of state.projects) (groups[p.status] || groups.active).push(p);
  let html = `<h1>Projects</h1>
    <form class="add" data-form="add-project">
      <input name="name" placeholder="New project" aria-label="New project name" autocomplete="off">
      <button class="btn primary">Add</button>
    </form>`;
  if (!state.projects.length) {
    html += `<p class="muted">Big things with an end. Add one, then write its first small step.</p>`;
  }
  html += groups.active.map(projectRow).join('');
  if (groups.waiting.length) html += `<h2 class="sec">Waiting on someone</h2>` + groups.waiting.map(projectRow).join('');
  if (groups.done.length) {
    html += `<details class="done-list"><summary>Finished (${groups.done.length})</summary>${groups.done.map(projectRow).join('')}</details>`;
  }
  return html;
}

function projectRow(p) {
  const next = p.steps.find(s => !s.doneOn);
  const sub = p.status === 'done' ? 'Finished' : next ? `Next: ${esc(next.text)}` : 'No next step yet';
  return `<button class="card row" data-act="open-project" data-id="${p.id}">
    ${p.category ? `<span class="cat">${esc(catName(p.category))}</span>` : ''}
    <span class="p-name">${esc(p.name)}</span>
    <span class="p-next">${sub}</span>
  </button>`;
}

function renderProject(p) {
  const statuses = [['active', 'Active'], ['waiting', 'Waiting on someone'], ['done', 'Done']];
  return `<button class="back" data-act="close-project">‹ Projects</button>
  <label class="field"><span class="sr">Project name</span>
    <input class="title-input" value="${esc(p.name)}" data-change="p-name" autocomplete="off">
  </label>
  <label class="field"><span>Category</span>${catSelect(p.category, 'data-change="p-cat"')}</label>
  <div class="seg status" role="group" aria-label="Status">
    ${statuses.map(([v, t]) => `<button data-act="p-status" data-status="${v}" aria-pressed="${p.status === v}">${t}</button>`).join('')}
  </div>

  <h2 class="sec">Steps</h2>
  ${p.steps.length ? `<ol class="steps">${p.steps.map((s, i) => `<li class="${s.doneOn ? 'done' : ''}">
      <button class="check" data-act="toggle-step" data-step="${s.id}" aria-pressed="${!!s.doneOn}" aria-label="${s.doneOn ? 'Mark not done' : 'Mark done'}: ${esc(s.text)}"></button>
      <span class="s-text">${esc(s.text)}${s.doneOn ? ` <span class="muted small">done ${esc(fmtShortDay(s.doneOn))}</span>` : ''}</span>
      ${i > 0 ? `<button class="icon" data-act="step-up" data-step="${s.id}" aria-label="Move up">↑</button>` : '<span class="icon-space"></span>'}
      <button class="icon" data-act="step-del" data-step="${s.id}" aria-label="Delete step">×</button>
    </li>`).join('')}</ol>` : '<p class="muted">No steps yet. Small ones are best: "look up one name," "read one page."</p>'}
  <form class="add" data-form="add-step">
    <input name="text" placeholder="Add a small step" aria-label="New step" autocomplete="off">
    <button class="btn primary">Add</button>
  </form>

  <h2 class="sec">Notes</h2>
  <p class="muted small">Each note gets the date and time stamped on it.</p>
  <form class="note-add" data-form="add-note">
    <textarea name="text" rows="3" placeholder="What happened, who you talked to, numbers to keep" aria-label="New note"></textarea>
    <button class="btn primary wide">Add note</button>
  </form>
  ${p.notes.length ? `<ul class="notes">${p.notes.slice().reverse().map(n => `<li>
      <div class="stamp">${esc(fmtStamp(n.at))}</div>
      <div class="n-text">${esc(n.text)}</div>
      <button class="link small danger" data-act="note-del" data-note="${n.id}">Delete note</button>
    </li>`).join('')}</ul>` : ''}

  <button class="btn wide ghost danger delete-project" data-act="p-delete">Delete this project</button>`;
}

function catSelect(val, attrs) {
  return `<select ${attrs}>
    <option value="">None</option>
    ${state.categories.map(c => `<option value="${esc(c.id)}"${c.id === val ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
  </select>`;
}

/* ---------- Month ---------- */

function renderMonth() {
  const cur = monthOf(todayKey());
  const m = ui.month && ui.month <= cur ? ui.month : cur;
  const first = firstMonth();
  const L = lab();
  const pebs = pebblesFor(m);
  const shiny = pebs.filter(p => p.shiny).length;
  const checked = Object.entries(state.days).filter(([k, d]) => monthOf(k) === m && d.mode);
  const shitDays = checked.filter(([, d]) => d.mode === 'shit').length;

  let html = `<div class="month-nav">
    <button class="icon-btn" data-act="month" data-m="${shiftMonth(m, -1)}" ${m <= first ? 'disabled' : ''} aria-label="Previous month">‹</button>
    <h1>${esc(fmtMonth(m))}</h1>
    <button class="icon-btn" data-act="month" data-m="${shiftMonth(m, 1)}" ${m >= cur ? 'disabled' : ''} aria-label="Next month">›</button>
  </div>
  <p class="headline">${esc(headline(m))}</p>
  <div class="jar-wrap">
    ${jarSVG(pebs, m, 'jar-big')}
    <p class="jar-count">${pebs.length
      ? `${plural(pebs.length, 'pebble')}${shiny ? `, ${shiny} shiny` : ''}`
      : m === cur ? 'The jar fills with your first pebble.' : 'Nothing logged this month.'}</p>
  </div>`;

  if (checked.length) {
    html += `<p class="muted center">${plural(checked.length, 'day')} checked in.${shitDays ? ` ${shitDays} ${esc(L.shit)} day${shitDays === 1 ? '' : 's'}, not counted.` : ''}</p>`;
  }

  const hs = state.habits.filter(h => monthOf(h.created) <= m && (h.active || usedIn(h, m)));
  if (hs.length) {
    html += `<h2 class="sec">Habits</h2>` + hs.map(h => {
      const a = amountsFor(h, m), pa = amountsFor(h, shiftMonth(m, -1));
      let amt = '';
      if (h.type === 'count') {
        const changed = monthOf(h.created) < m && a.ok !== pa.ok;
        amt = changed ? `${L.ok} amount: ${pa.ok} → ${amountText(h, a.ok)}` : `${L.ok} amount: ${amountText(h, a.ok)}`;
      }
      let line;
      if (h.freq === 'weekly') {
        const n = timesDone(h, m);
        line = n ? `Done ${n === 1 ? 'once' : `${n} times`}.` : 'Nothing logged.';
      } else {
        const s = habitStats(h, m);
        line = s.days ? `Hit it on ${s.hits} of ${plural(s.days, 'day')}.` : 'No days to count yet.';
      }
      return `<div class="stat"><b>${esc(h.name)}</b>${amt ? `<span>${esc(amt)}</span>` : ''}<span class="muted">${line}</span></div>`;
    }).join('');
  }

  const moved = projectMoves(m);
  if (moved.length) {
    html += `<h2 class="sec">Projects that moved</h2>` + moved.map(({ p, worked, steps, finished }) => {
      const bits = [];
      if (worked) bits.push(`worked on ${plural(worked, 'day')}`);
      if (steps) bits.push(`${plural(steps, 'step')} done`);
      if (finished) bits.push('finished');
      return `<div class="stat"><b>${esc(p.name)}</b><span class="muted">${esc(cap(bits.join(' · ')))}</span></div>`;
    }).join('');
  }
  if (m === cur) {
    const waiting = state.projects.filter(p => p.status === 'waiting');
    if (waiting.length) html += `<h2 class="sec">Waiting on someone</h2><p class="muted">${waiting.map(p => esc(p.name)).join(', ')}</p>`;
  }

  const shelf = [];
  for (let mm = first; mm <= cur; mm = shiftMonth(mm, 1)) {
    const p = pebblesFor(mm);
    if (p.length) shelf.push([mm, p]);
  }
  if (shelf.length) {
    html += `<h2 class="sec">The shelf</h2><div class="shelf">${shelf.map(([mm, p]) =>
      `<button data-act="month" data-m="${mm}" aria-current="${mm === m}" aria-label="${esc(fmtMonth(mm))}: ${plural(p.length, 'pebble')}">
        ${jarSVG(p, mm, 'jar-thumb')}<span>${esc(shelfLabel(mm))}</span><span class="muted small">${p.length}</span>
      </button>`).join('')}</div>`;
  }
  return html;
}

/* ---------- More ---------- */

function renderMore() {
  if (ui.habitEdit) return renderHabitEditor();
  const L = lab();
  const st = state.settings;
  const active = activeHabits();
  const removed = state.habits.filter(h => !h.active);

  const habitRows = active.map((h, i) => {
    const a = currentAmounts(h);
    const freq = h.freq === 'weekly' ? 'weekly' : 'daily';
    const sum = h.type === 'done'
      ? `Done or not · ${freq}`
      : `${esc(L.ok)}: ${esc(amountText(h, a.ok))} · ${esc(L.good)}: ${esc(amountText(h, a.good))} · ${freq}`;
    return `<div class="habit-row">
      <button class="card row" data-act="edit-habit" data-id="${h.id}"><span class="p-name">${esc(h.name)}</span><span class="p-next">${sum}</span></button>
      ${i > 0 ? `<button class="icon" data-act="habit-up" data-id="${h.id}" aria-label="Move ${esc(h.name)} up">↑</button>` : '<span class="icon-space"></span>'}
    </div>`;
  }).join('');

  return `<h1>More</h1>
  <h2 class="sec">Habits</h2>
  ${habitRows || '<p class="muted">No habits yet.</p>'}
  <button class="btn wide" data-act="add-habit">Add a habit</button>
  ${removed.length ? `<details class="removed"><summary>Removed habits (${removed.length})</summary>
    ${removed.map(h => `<div class="row-between"><span>${esc(h.name)}</span><button class="btn" data-act="habit-restore" data-id="${h.id}">Bring back</button></div>`).join('')}
  </details>` : ''}

  <h2 class="sec">Backup</h2>
  <p class="muted">Everything lives on this phone only. A backup file is your safety net. It has your notes in it, so keep it somewhere private.</p>
  <div class="stack">
    <button class="btn primary wide" data-act="backup-save">Save backup file</button>
    ${canShareFiles ? '<button class="btn wide" data-act="backup-share">Send backup to…</button>' : ''}
    <button class="btn wide" data-act="backup-load">Load a backup file</button>
  </div>
  <p class="muted small">${st.lastBackup ? `Last backup: ${esc(fmtStamp(st.lastBackup))}` : 'No backup yet.'}</p>

  <h2 class="sec">Categories</h2>
  ${state.categories.map(c => `<div class="cat-row">
    <input value="${esc(c.name)}" data-change="cat-name" data-id="${esc(c.id)}" aria-label="Category name" autocomplete="off">
    <button class="icon" data-act="cat-del" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">×</button>
  </div>`).join('')}
  <form class="add" data-form="add-cat">
    <input name="name" placeholder="New category" aria-label="New category name" autocomplete="off">
    <button class="btn">Add</button>
  </form>

  <h2 class="sec">Words on the morning buttons</h2>
  <label class="field"><span>Rest day</span><input value="${esc(L.shit)}" data-change="label" data-key="shit" autocomplete="off"></label>
  <label class="field"><span>Small-version day</span><input value="${esc(L.ok)}" data-change="label" data-key="ok" autocomplete="off"></label>
  <label class="field"><span>Full-version day</span><input value="${esc(L.good)}" data-change="label" data-key="good" autocomplete="off"></label>

  <h2 class="sec">Raise offers</h2>
  <label class="field"><span>Offer a raise when I hit the ${esc(L.ok)} amount on at least this % of days</span>
    <input type="number" inputmode="numeric" min="1" max="100" value="${Math.round(st.raiseThreshold * 100)}" data-change="set-threshold"></label>
  <label class="field"><span>…with at least this many days logged that month</span>
    <input type="number" inputmode="numeric" min="1" max="31" value="${st.raiseMinDays}" data-change="set-mindays"></label>
  <p class="muted small">${esc(L.shit)} days are never counted. Raises are only ever offered, never automatic, and amounts never go down on their own.</p>

  <h2 class="sec">New day starts at</h2>
  <label class="field"><span class="sr">New day starts at</span>
    <select data-change="set-daystart">${[0, 1, 2, 3, 4, 5, 6].map(h => `<option value="${h}"${h === st.dayStartHour ? ' selected' : ''}>${h === 0 ? 'Midnight' : `${h} am`}</option>`).join('')}</select>
  </label>
  <p class="muted small">So a late night still counts as the same day.</p>

  <p class="muted small footer">Kaizen keeps everything on this device. Nothing is sent anywhere.</p>`;
}

function renderHabitEditor() {
  const isNew = ui.habitEdit === 'new';
  const h = isNew
    ? { name: '', category: 'body', type: 'count', unit: 'reps', freq: 'daily', okNote: '', goodNote: '', step: 1 }
    : habit(ui.habitEdit);
  if (!h) { ui.habitEdit = null; return renderMore(); }
  const a = isNew ? { ok: 5, good: 10 } : currentAmounts(h);
  const L = lab();
  const radio = (name, value, text, cur) =>
    `<label><input type="radio" name="${name}" value="${value}"${cur === value ? ' checked' : ''}><span>${text}</span></label>`;
  return `<button class="back" data-act="close-habit">‹ More</button>
  <h1>${isNew ? 'New habit' : 'Edit habit'}</h1>
  <form data-form="habit" data-type="${h.type}" data-freq="${h.freq}" class="editor">
    <label class="field"><span>Name</span><input name="name" value="${esc(h.name)}" required autocomplete="off"></label>
    <label class="field"><span>Category</span>${catSelect(h.category, 'name="category"')}</label>
    <fieldset class="field"><legend>Kind</legend><div class="seg">${radio('type', 'count', 'A number', h.type)}${radio('type', 'done', 'Done or not', h.type)}</div></fieldset>
    <fieldset class="field"><legend>How often</legend><div class="seg">${radio('freq', 'daily', 'Daily', h.freq)}${radio('freq', 'weekly', 'Weekly', h.freq)}</div></fieldset>
    <label class="field count-only"><span>Unit</span><input name="unit" value="${esc(h.unit || '')}" placeholder="min, reps, servings" autocomplete="off"></label>

    <div class="pair">
      <h2 class="sub">${esc(L.ok)} day</h2>
      <label class="field count-only"><span>Amount</span><input name="ok" type="number" inputmode="decimal" min="0" step="any" value="${a.ok ?? ''}"></label>
      <label class="field"><span>Short description (optional)</span><input name="okNote" value="${esc(h.okNote || '')}" autocomplete="off"></label>
    </div>
    <div class="pair">
      <h2 class="sub">${esc(L.good)} day</h2>
      <label class="field count-only"><span>Amount</span><input name="good" type="number" inputmode="decimal" min="0" step="any" value="${a.good ?? ''}"></label>
      <label class="field"><span>Short description (optional)</span><input name="goodNote" value="${esc(h.goodNote || '')}" autocomplete="off"></label>
    </div>

    <label class="field count-only daily-only"><span>Raise by</span>
      <input name="step" type="number" inputmode="decimal" min="0" step="any" value="${h.step ?? ''}" placeholder="Blank = never offer a raise">
      <small class="muted">When you hit your ${esc(L.ok)} amount most days, the app offers to add this much. Leave blank for never.</small>
    </label>
    <p class="muted small weekly-only">Weekly habits don't get raise offers.</p>
    <button class="btn primary wide">Save</button>
  </form>
  ${isNew ? '' : `<button class="btn wide ghost danger" data-act="habit-remove">Remove this habit</button>
  <p class="muted small">Removing hides it. Its history and pebbles stay.</p>`}`;
}

function saveHabitForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) { toast('Give it a name.'); return; }
  const type = f.get('type') === 'done' ? 'done' : 'count';
  const freq = f.get('freq') === 'weekly' ? 'weekly' : 'daily';
  let ok = null, good = null;
  if (type === 'count') {
    ok = num(f.get('ok'));
    if (ok === null) ok = 1;
    good = num(f.get('good'));
    if (good === null || good < ok) good = ok;
  }
  let step = type === 'count' && freq === 'daily' ? num(f.get('step')) : null;
  if (!step || step < 0) step = null;
  let h;
  if (ui.habitEdit === 'new') {
    h = { id: uid('h'), created: todayKey(), active: true, history: [] };
    state.habits.push(h);
  } else {
    h = habit(ui.habitEdit);
    if (!h) return;
  }
  Object.assign(h, {
    name,
    category: String(f.get('category') || ''),
    type,
    unit: type === 'count' ? String(f.get('unit') || '').trim() : '',
    freq,
    okNote: String(f.get('okNote') || '').trim(),
    goodNote: String(f.get('goodNote') || '').trim(),
    step,
  });
  // A manual edit applies from today and replaces any raise that was waiting to start.
  const k = todayKey();
  h.history = (h.history || []).filter(e => sinceOf(e) <= k);
  setAmounts(h, k, ok, good);
  ui.habitEdit = null;
  commit();
  render();
  window.scrollTo(0, 0);
  toast('Saved.');
}

/* ---------- backup ---------- */

function backupFile() {
  const name = `kaizen-backup-${todayKey()}.json`;
  return new File([JSON.stringify(state, null, 2)], name, { type: 'application/json' });
}

function markBackedUp() {
  state.settings.lastBackup = new Date().toISOString();
  commit();
  render();
}

function saveBackup() {
  const file = backupFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  markBackedUp();
  toast('Backup file saved.');
}

async function shareBackup() {
  try {
    await navigator.share({ files: [backupFile()], title: 'Kaizen backup' });
    markBackedUp();
  } catch { /* cancelled */ }
}

async function loadBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.habits) || !data.days || typeof data.days !== 'object') throw new Error('not a backup');
    if (!confirm('Replace everything on this phone with this backup file?')) return;
    state = normalize(data);
    ui.project = null;
    ui.habitEdit = null;
    commit();
    render();
    toast('Backup loaded.');
  } catch {
    toast("That file isn't a Kaizen backup.");
  }
}

/* ---------- toast ---------- */

let toastTimer = null;
let toastUndo = null;
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${opts.undo ? '<button class="link" data-toast-undo>Undo</button>' : ''}`;
  t.hidden = false;
  toastUndo = opts.undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opts.undo ? 6000 : 2000);
}
function hideToast() {
  $('#toast').hidden = true;
  toastUndo = null;
}

/* ---------- render ---------- */

function render() {
  const k = todayKey();
  if (ui.day !== k) { ui.day = k; ui.showRest = false; }
  const views = { today: renderToday, projects: renderProjects, month: renderMonth, more: renderMore };
  $('#main').innerHTML = (views[ui.tab] || renderToday)();
  document.querySelectorAll('.tabs [data-tab]').forEach(b => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function go(fn) {
  fn();
  render();
  window.scrollTo(0, 0);
}

/* ---------- events ---------- */

document.addEventListener('click', e => {
  if (e.target.closest('[data-toast-undo]')) {
    const undo = toastUndo;
    hideToast();
    if (undo) undo();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const k = todayKey();
  const p = ui.project ? project(ui.project) : null;

  switch (act) {
    case 'tab':
      go(() => { ui.tab = el.dataset.tab; ui.project = null; ui.habitEdit = null; ui.month = null; });
      break;
    case 'mode': {
      const d = getDay(k, true);
      d.mode = el.dataset.mode;
      if (d.mode !== 'shit') ui.showRest = false;
      commit();
      render();
      break;
    }
    case 'show-rest':
      ui.showRest = true;
      render();
      break;
    case 'inc':
    case 'dec': {
      const d = getDay(k);
      const v = Number(d && d.log[id]) || 0;
      setLog(id, Math.max(0, v + (act === 'inc' ? 1 : -1)));
      break;
    }
    case 'did':
      setLog(id, Number(el.dataset.n));
      break;
    case 'toggle': {
      const d = getDay(k);
      setLog(id, !(d && d.log[id]));
      break;
    }
    case 'worked': {
      const d = getDay(k, true);
      const i = d.work.findIndex(w => w.project === id && w.kind === 'worked');
      if (i >= 0) d.work.splice(i, 1);
      else d.work.push({ project: id, kind: 'worked' });
      commit();
      render();
      if (i < 0) toast('That counts.');
      break;
    }
    case 'step-done': {
      const pr = project(id);
      const s = pr && pr.steps.find(x => x.id === el.dataset.step);
      if (!s || s.doneOn) break;
      completeStep(pr, s, k);
      commit();
      render();
      toast('Step done. That counts.', { undo: () => { uncompleteStep(pr, s); commit(); render(); } });
      break;
    }
    case 'open-project':
      go(() => { ui.tab = 'projects'; ui.project = id; });
      break;
    case 'close-project':
      go(() => { ui.project = null; });
      break;
    case 'p-status': {
      if (!p) break;
      const was = p.status;
      setProjectStatus(p, el.dataset.status);
      commit();
      render();
      if (p.status === 'done' && was !== 'done') {
        toast('Project finished. That counts.', { undo: () => { setProjectStatus(p, was); commit(); render(); } });
      }
      break;
    }
    case 'toggle-step': {
      if (!p) break;
      const s = p.steps.find(x => x.id === el.dataset.step);
      if (!s) break;
      if (s.doneOn) uncompleteStep(p, s);
      else { completeStep(p, s, k); toast('Step done. That counts.'); }
      commit();
      render();
      break;
    }
    case 'step-up': {
      if (!p) break;
      const i = p.steps.findIndex(x => x.id === el.dataset.step);
      if (i > 0) [p.steps[i - 1], p.steps[i]] = [p.steps[i], p.steps[i - 1]];
      commit();
      render();
      break;
    }
    case 'step-del': {
      if (!p) break;
      const s = p.steps.find(x => x.id === el.dataset.step);
      if (!s || !confirm(`Delete this step?\n\n"${s.text}"`)) break;
      p.steps = p.steps.filter(x => x !== s);
      commit();
      render();
      break;
    }
    case 'note-del': {
      if (!p) break;
      if (!confirm('Delete this note? This can\'t be undone.')) break;
      p.notes = p.notes.filter(n => n.id !== el.dataset.note);
      commit();
      render();
      break;
    }
    case 'p-delete': {
      if (!p) break;
      if (!confirm(`Delete "${p.name}" and all its steps and notes? This can't be undone.`)) break;
      state.projects = state.projects.filter(x => x !== p);
      ui.project = null;
      commit();
      go(() => {});
      break;
    }
    case 'raise-yes': {
      const d = getDay(k);
      const startsTomorrow = !!(d && d.log[id] !== undefined);
      acceptRaise(id);
      commit();
      render();
      toast(startsTomorrow ? 'Bumped up, starting tomorrow. That counts.' : 'Bumped up. That counts.');
      break;
    }
    case 'raise-skip':
      skipRaise(id);
      commit();
      render();
      break;
    case 'month':
      ui.month = el.dataset.m;
      render();
      break;
    case 'edit-habit':
      go(() => { ui.habitEdit = id; });
      break;
    case 'add-habit':
      go(() => { ui.habitEdit = 'new'; });
      break;
    case 'close-habit':
      go(() => { ui.habitEdit = null; });
      break;
    case 'habit-remove': {
      const h = habit(ui.habitEdit);
      if (!h || !confirm(`Remove "${h.name}"? Its history and pebbles stay, and you can bring it back later.`)) break;
      h.active = false;
      ui.habitEdit = null;
      commit();
      go(() => {});
      break;
    }
    case 'habit-restore': {
      const h = habit(id);
      if (h) { h.active = true; commit(); render(); }
      break;
    }
    case 'habit-up': {
      const i = state.habits.findIndex(h => h.id === id);
      let j = i - 1;
      while (j >= 0 && !state.habits[j].active) j--;
      if (i > 0 && j >= 0) {
        const [h] = state.habits.splice(i, 1);
        state.habits.splice(j, 0, h);
        commit();
        render();
      }
      break;
    }
    case 'cat-del': {
      const c = state.categories.find(x => x.id === id);
      if (!c || !confirm(`Delete the category "${c.name}"? Anything in it just won't have a category.`)) break;
      state.categories = state.categories.filter(x => x !== c);
      for (const h of state.habits) if (h.category === id) h.category = '';
      for (const pr of state.projects) if (pr.category === id) pr.category = '';
      commit();
      render();
      break;
    }
    case 'backup-save':
      saveBackup();
      break;
    case 'backup-share':
      shareBackup();
      break;
    case 'backup-load':
      $('#loadFile').click();
      break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('form[data-form="habit"] input[type="radio"]')) {
    el.form.dataset[el.name] = el.value;
    return;
  }
  const kind = el.dataset && el.dataset.change;
  if (!kind) return;
  const p = ui.project ? project(ui.project) : null;
  switch (kind) {
    case 'log':
      setLog(el.dataset.id, el.value);
      break;
    case 'note': {
      clearTimeout(noteTimer);
      getDay(todayKey(), true).note = el.value;
      commit();
      break;
    }
    case 'p-name': {
      const v = el.value.trim();
      if (p && v) { p.name = v; commit(); } else if (p) el.value = p.name;
      break;
    }
    case 'p-cat':
      if (p) { p.category = el.value; commit(); }
      break;
    case 'cat-name': {
      const c = state.categories.find(x => x.id === el.dataset.id);
      const v = el.value.trim();
      if (c && v) { c.name = v; commit(); } else if (c) el.value = c.name;
      break;
    }
    case 'label': {
      const v = el.value.trim();
      if (v) { state.settings.labels[el.dataset.key] = v; commit(); render(); } else el.value = lab()[el.dataset.key];
      break;
    }
    case 'set-threshold': {
      const v = num(el.value);
      if (v && v > 0 && v <= 100) { state.settings.raiseThreshold = v / 100; commit(); }
      render();
      break;
    }
    case 'set-mindays': {
      const v = num(el.value);
      if (v && v >= 1 && v <= 31) { state.settings.raiseMinDays = Math.round(v); commit(); }
      render();
      break;
    }
    case 'set-daystart': {
      const v = num(el.value);
      if (v !== null && v >= 0 && v <= 6) { state.settings.dayStartHour = v; commit(); render(); }
      break;
    }
  }
});

let noteTimer = null;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.input === 'note') {
    clearTimeout(noteTimer);
    const v = el.value;
    noteTimer = setTimeout(() => { getDay(todayKey(), true).note = v; commit(); }, 400);
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const p = ui.project ? project(ui.project) : null;
  const field = name => String(new FormData(form).get(name) || '').trim();

  if (kind === 'habit') { saveHabitForm(form); return; }
  if (kind === 'add-project') {
    const name = field('name');
    if (!name) return;
    const np = { id: uid('p'), name, category: '', status: 'active', created: todayKey(), steps: [], notes: [] };
    state.projects.push(np);
    commit();
    go(() => { ui.project = np.id; });
    return;
  }
  if (kind === 'add-step' && p) {
    const text = field('text');
    if (!text) return;
    p.steps.push({ id: uid('s'), text, doneOn: null });
    commit();
    render();
    const input = $('form[data-form="add-step"] input');
    if (input) input.focus();
    return;
  }
  if (kind === 'add-note' && p) {
    const text = field('text');
    if (!text) return;
    p.notes.push({ id: uid('n'), at: new Date().toISOString(), text });
    commit();
    render();
    toast('Note saved.');
    return;
  }
  if (kind === 'add-cat') {
    const name = field('name');
    if (!name) return;
    state.categories.push({ id: uid('c'), name });
    commit();
    render();
  }
});

$('#loadFile').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) loadBackup(file);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const active = document.activeElement;
    const typing = active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (!typing) render();
  }
});

/* ---------- start ---------- */

function init() {
  const saved = load();
  state = normalize(saved || seed());
  if (!saved) commit();
  ui.day = todayKey();
  try {
    canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
  } catch { canShareFiles = false; }
  render();
  askToKeep();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
