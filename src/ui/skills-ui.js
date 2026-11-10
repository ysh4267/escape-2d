// =========================================================
// the character screen's SKILLS tab
//
// The client's SkillsAndMasteringScreen, off its hierarchy and 1080p
// captures of 1.1.5:
//
//   top    the level being worked on and the next one, the experience bar
//          between them with what has come in since the last raid marked
//          over its end, `current:` and `remaining:` under it
//   strip  SKILLS / MASTERING, then Show: with its two boxes (which class,
//          in what order) and the list / grid switch
//   list   every skill, two abreast: its picture with the level on a tab in
//          the corner, its class and name, the icons of what it does, the
//          bar with the points gained since the last raid in green, the
//          level and the points toward the next. The grid shows the
//          pictures alone.
//
// Resting the pointer on a picture opens the skill's card: what the skill
// is, how it is trained, and each thing it does at the level it stands at.
// =========================================================

import { $, el, fmtNum } from '../core/util.js';
import { game } from '../core/state.js';
import { t, tOr } from '../core/i18n.js';
import { uiImg, setUiSrc, loadUiGroup, hasUi } from '../core/uiart.js';
import { sfx } from '../core/audio.js';
import { toStage } from '../core/stage.js';
import { levelGroup, levelProgress, MAX_LEVEL } from '../game/db.js';
import { listedSkills, skillState, skillSprite, skillGain, skillBuffs, skillName, MAX_SKILL_LEVEL } from '../game/skills.js';
import { dropdown } from './kit.js';

let mode = 'skills';
let view = 'list';
let filter = 'all';
let sort = 'default';
let tip = null;
let packed = false;

// the two letters on a skill's class tag, and the tag's colour. Physical,
// Mental and Combat are sampled from captures; Practical was never on screen
// in one and is a judgement.
const CLASS = {
  Physical: { sym: 'Ph', color: '#63999b' },
  Mental: { sym: 'M', color: '#c6c1a4' },
  Combat: { sym: 'C', color: '#b0553b' },
  Practical: { sym: 'Pr', color: '#8a9a5b' },
};

/** up to two places, as the client writes a skill's points: 80.86, 12.5, 0 */
const points = (v) => String(Math.round(v * 100) / 100);

function classTag(cls) {
  const c = CLASS[cls] || CLASS.Physical;
  return el('span', { class: 'skc', style: { backgroundColor: c.color } }, c.sym);
}

/** the tab on a picture's corner: the level, or the crown once it is elite */
function levelTab(level) {
  return el('span', { class: 'sklv' }, level >= MAX_SKILL_LEVEL ? uiImg('elite_icon') : String(level));
}

/** the bar: grey up to where the skill stood when the last raid began, green from there */
function fillBar(id, cls = '') {
  const [level, into, cost] = skillState(id);
  const bar = el('div', { class: `skbar ${cls}` });
  if (level >= MAX_SKILL_LEVEL) { bar.append(el('i', { class: 'skbar__fill skbar__fill--elite', style: { width: '100%' } })); return bar; }
  const now = cost ? into / cost : 0;
  const gain = skillGain(id);
  if (gain) {
    bar.append(el('i', { class: 'skbar__fill skbar__fill--new', style: { width: `${now * 100}%` } }),
      el('span', { class: 'skbar__gain', style: { left: `${now * 100}%` } }, `+${points(gain.shown)}`));
  }
  bar.append(el('i', { class: 'skbar__fill', style: { width: `${(gain ? gain.from : now) * 100}%` } }));
  return bar;
}

function levelLine(id) {
  const [level, into, cost] = skillState(id);
  if (level >= MAX_SKILL_LEVEL) {
    return [el('span', { class: 'sk__level is-elite' }, t('<color=#c78b2c>ELITE Level</color>').replace(/<[^>]+>/g, '')),
      el('span', { class: 'sk__pts' }, t('maxed'))];
  }
  return [el('span', { class: 'sk__level' }, `${t('Level ')}${level}`),
    el('span', { class: 'sk__pts' }, el('b', {}, points(into)), `/${cost}`)];
}

function buffIcon(b) {
  return el('span', { class: `skbf${b.elite ? ' is-elite' : ''}` }, b.ico && hasUi(b.ico) ? uiImg(b.ico) : null);
}

function picture(s, level) {
  const art = skillSprite(s.id);
  const pic = el('div', { class: 'skpic' },
    el('div', { class: 'skpic__img', dataset: { tip: s.id } }, art && hasUi(art) ? uiImg(art) : null),
    levelTab(level));
  return pic;
}

function listRow(s) {
  const level = skillState(s.id)[0];
  return el('div', { class: 'sk' },
    picture(s, level),
    el('div', { class: 'sk__head' }, classTag(s.cls), el('span', { class: 'sk__name' }, skillName(s.id))),
    el('div', { class: 'sk__buffs' }, skillBuffs(s.id).map(buffIcon)),
    fillBar(s.id),
    levelLine(s.id));
}

function gridCell(s) {
  const [level, into, cost] = skillState(s.id);
  const cell = picture(s, level);
  cell.classList.add('skpic--cell');
  cell.append(classTag(s.cls),
    el('span', { class: 'skpic__pts' }, level >= MAX_SKILL_LEVEL ? t('maxed') : [el('b', {}, points(into)), `/${cost}`]));
  return cell;
}

// ---------------------------------------------------------
// the card
// ---------------------------------------------------------
function closeTip() {
  tip?.remove();
  tip = null;
}

function openTip(id, x, y) {
  closeTip();
  const s = listedSkills().find((k) => k.id === id);
  if (!s) return;
  const level = skillState(id)[0];
  const about = [tOr(`${id}Description`, ''), tOr(`${id}LevelingUpDescription`, '')].filter(Boolean);
  tip = el('div', { class: 'sktip' },
    el('div', { class: 'sktip__head' }, classTag(s.cls), el('span', { class: 'sktip__name' }, skillName(id)), levelTab(level)),
    el('div', { class: 'sktip__about' }, about.map((p) => el('p', {}, p))),
    el('div', { class: 'sktip__prog' }, fillBar(id, 'skbar--tip'), levelLine(id)),
    el('div', { class: 'sktip__buffs' }, skillBuffs(id).map((b) => el('div', { class: 'sktip__buff' },
      buffIcon(b),
      el('span', {}, b.elite ? el('em', {}, 'ELITE ') : null, b.parts.map((p) => (p.lit ? el('b', {}, p.text) : p.text)))))));
  // on whichever frame the tab is drawn in: the character screen, or a raid's inventory
  const frame = $('#skills-host').closest('.rinv__frame, .screen') || $('#screen-character');
  frame.append(tip);
  // at the pointer, and back inside the screen where it would run off it
  const box = frame.getBoundingClientRect();
  let left = toStage(x - box.left) + 2;
  let top = toStage(y - box.top) + 2;
  left = Math.max(4, Math.min(left, 1920 - tip.offsetWidth - 4));
  top = Math.max(4, Math.min(top, 1046 - tip.offsetHeight - 4));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ---------------------------------------------------------
// the screen
// ---------------------------------------------------------
function levelPanel(level, cls) {
  const badge = el('img', { class: 'skl__badge', alt: '' });
  setUiSrc(badge, `rank${levelGroup(level) * 5}`, 'ranks');
  return el('div', { class: `skl__lv ${cls}` }, badge, el('span', {}, String(level).padStart(2, '0')));
}

function subTab(id, label, ico) {
  const on = mode === id;
  const b = el('button', { class: `dbtn skl__tab${on ? ' is-hover' : ''}`, type: 'button', dataset: { sfx: 'own' } },
    uiImg(on ? `${ico}_selected` : ico, '', { w: 24, h: 24 }), el('span', {}, label));
  b.addEventListener('click', () => { if (mode !== id) { mode = id; sfx.ui('click'); renderSkills(); } });
  return b;
}

function viewTab(id, ico) {
  const b = el('button', { class: `skl__view${view === id ? ' is-on' : ''}`, type: 'button', dataset: { sfx: 'own' } }, uiImg(ico));
  b.addEventListener('click', () => { if (view !== id) { view = id; sfx.ui('click'); renderSkills(); } });
  return b;
}

function shownSkills() {
  let list = listedSkills();
  if (filter !== 'all') list = list.filter((s) => s.cls === filter);
  if (sort === 'default') return list;
  const key = sort === 'level'
    ? (s) => skillState(s.id)[0]
    : (s) => { const [level, into, cost] = skillState(s.id); return level >= MAX_SKILL_LEVEL ? 1 : into / cost; };
  // a sort keeps the tab's own order among equals
  return list.map((s, i) => [s, i]).sort((a, b) => key(b[0]) - key(a[0]) || a[1] - b[1]).map((x) => x[0]);
}

export function renderSkills() {
  const host = $('#skills-host');
  if (!host) return;
  closeTip();
  // the pictures are a pack of their own, fetched the first time the tab is opened
  if (!packed) loadUiGroup('skills').then((ok) => { packed = true; if (ok) renderSkills(); });

  const p = game.profile;
  const [into, span] = levelProgress(p.exp || 0);
  const top = p.level >= MAX_LEVEL();
  const share = span ? Math.min(1, into / span) : 1;
  // what has come in since the last raid began, as far back as this level goes
  const gained = Math.max(0, (p.exp || 0) - (p.expMark ?? p.exp ?? 0));
  const from = span ? Math.max(0, into - gained) / span : 1;
  const bar = el('div', { class: 'skl__bar' },
    el('i', { class: 'skl__fill', style: { width: `${from * 100}%` } }),
    gained > 0 && share > from ? el('i', { class: 'skl__fill skl__fill--new', style: { left: `${from * 100}%`, width: `${(share - from) * 100}%` } }) : null,
    el('div', { class: 'skl__gain', style: { left: `${share * 100}%` } },
      el('span', { class: 'skl__gainnum' }, `+${fmtNum(gained)}`, uiImg('icon_experience_big')), uiImg('level_fill_bar_pointer', 'skl__pointer')));

  const header = el('div', { class: 'skl__top' },
    levelPanel(p.level, 'skl__lv--now'),
    bar,
    el('div', { class: 'skl__cur' }, t('current:'), el('b', {}, fmtNum(p.exp || 0))),
    top ? null : el('div', { class: 'skl__rem' }, t('remaining:'), el('b', {}, fmtNum(Math.max(0, span - into)))),
    top ? null : levelPanel(p.level + 1, 'skl__lv--next'));

  // weapon mastering is not kept yet: its page is the one of a character that
  // has fired nothing - the search box, the options, and an empty list
  const skills = mode === 'skills';
  const filterBox = dropdown({
    value: skills ? filter : 'all', width: 180, cls: 'ddb--31',
    options: skills
      ? [{ id: 'all', label: t('All types') }, { id: 'Physical', label: t('Physical') }, { id: 'Mental', label: t('Mental') },
        { id: 'Combat', label: t('Combat') }, { id: 'Practical', label: t('Practical') }]
      : [{ id: 'all', label: t('All types') }],
    onChange: (v) => { filter = v; renderSkills(); },
  });
  const sortBox = dropdown({
    value: skills ? sort : 'default', width: 180, cls: 'ddb--31',
    options: skills
      ? [{ id: 'default', label: t('Default') }, { id: 'level', label: t('Lvl') }, { id: 'progress', label: t('Progress') }]
      : [{ id: 'default', label: t('Default') }],
    onChange: (v) => { sort = v; renderSkills(); },
  });
  filterBox.node.classList.add('skl__filter');
  sortBox.node.classList.add('skl__sort');
  const search = skills ? null : el('label', { class: 'skl__search' },
    el('input', { type: 'text', spellcheck: 'false', placeholder: t('Weapon name') }), uiImg('icon_search', '', { w: 19, h: 19 }));

  const strip = el('div', { class: 'skl__strip' },
    subTab('skills', t('SKILLS'), 'tab_icon_skills'), subTab('mastering', t('MASTERING'), 'tab_icon_mastering'),
    search, el('span', { class: 'skl__show' }, t('Show:').trim()), filterBox.node, sortBox.node,
    viewTab('list', 'skills_list_icon'), viewTab('grid', 'skills_grid_icon'));

  const rows = skills ? shownSkills() : [];
  const keep = host.querySelector('.skl__scroll')?.scrollTop || 0;
  const list = el('div', { class: 'skl__scroll' },
    el('div', { class: view === 'grid' ? 'skl__grid' : 'skl__list' }, rows.map(view === 'grid' ? gridCell : listRow)));
  host.replaceChildren(header, strip, list);
  list.scrollTop = keep;
}

export function initSkills() {
  const host = $('#skills-host');
  if (!host) return;
  // the card belongs to the picture, as in the client, not to the whole row
  host.addEventListener('pointerover', (e) => {
    const pic = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (pic) openTip(pic.dataset.tip, e.clientX, e.clientY);
  });
  host.addEventListener('pointerout', (e) => {
    const pic = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (pic && !(e.relatedTarget instanceof Node && pic.contains(e.relatedTarget))) closeTip();
  });
  host.addEventListener('scroll', closeTip, true);
}
