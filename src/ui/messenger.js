// =========================================================
// the messenger
//
// Conversations on the left - one a trader, the newest on top, a count on
// the ones holding something - and the open one on the right: what he wrote,
// when, and under each message whatever he attached, to be taken one at a
// time or all at once with RECEIVE ALL. Attachments run out; the time left
// is printed on them.
// =========================================================

import { $, el, icon } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { renderItem } from '../inventory/view.js';
import { DB } from '../game/db.js';
import { threads, markRead, attachments, receive, receiveAll, expireMail } from '../game/mail.js';
import { currentScreen, previousScreen, showScreen, toast } from './shell.js';

let openFrom = null;

function who(from) {
  if (from === 'system') return { name: 'System', img: null };
  const t = DB.traderById[from];
  return t ? { name: t.name, img: t.img } : { name: 'Unknown', img: null };
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtLeft(ms) {
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h >= 1 ? `${h} h ${m} min` : `${m} min`;
}

export function renderMessenger() {
  const host = $('#messenger-host');
  if (!host) return;
  expireMail();
  host.replaceChildren();
  const list = threads();
  if (openFrom && !list.some((t) => t.from === openFrom)) openFrom = null;
  if (!openFrom && list.length) openFrom = list[0].from;

  const left = el('div', { class: 'msg__threads' });
  left.append(el('div', { class: 'msg__title' }, 'MESSENGER'));
  if (!list.length) left.append(el('div', { class: 'tl-empty' }, 'No messages'));
  for (const th of list) {
    const w = who(th.from);
    const row = el('button', { class: `msg-thread${th.from === openFrom ? ' is-active' : ''}${th.unread ? ' is-unread' : ''}`, dataset: { sfx: 'own' } },
      el('div', { class: 'msg-thread__pic' }, w.img ? el('img', { src: w.img, alt: '' }) : icon('info', 'ico')),
      el('div', { class: 'msg-thread__body' },
        el('div', { class: 'msg-thread__name' }, w.name),
        el('div', { class: 'msg-thread__last' }, (th.last.text || '').slice(0, 64))),
      th.attachments ? el('span', { class: 'msg-thread__n', title: 'Items attached' }, String(th.attachments)) : null);
    row.addEventListener('click', () => { openFrom = th.from; sfx.chat('select'); renderMessenger(); });
    left.append(row);
  }

  const right = el('div', { class: 'msg__conv' });
  const th = list.find((t) => t.from === openFrom);
  if (th) {
    markRead(th.from);
    const w = who(th.from);
    const head = el('div', { class: 'msg__convhead' }, el('span', {}, w.name));
    if (th.attachments) {
      const all = el('button', { class: 'ebtn ebtn--sm', dataset: { sfx: 'own' } }, 'RECEIVE ALL');
      all.addEventListener('click', () => {
        const r = receiveAll(th.from);
        if (r.taken) sfx.ui('equip');
        if (r.left) toast('Not enough space in stash', 'warn');
        renderMessenger();
      });
      head.append(all);
    }
    right.append(head);
    const scroll = el('div', { class: 'msg__scroll' });
    const now = Date.now();
    for (const m of th.messages) {
      const node = el('div', { class: 'msg' },
        el('div', { class: 'msg__when' }, fmtWhen(m.ts)),
        el('div', { class: 'msg__text' }, ...String(m.text || '').split(/\n+/).filter(Boolean).map((p) => el('p', {}, p))));
      if (m.items && m.items.length) {
        const att = el('div', { class: 'msg__att' });
        attachments(m).forEach((it, i) => {
          it.virtual = true;
          const tile = renderItem(it, { static: true });
          tile.classList.add('msg__tile');
          tile.title = `${it.tpl.name} — click to receive`;
          tile.addEventListener('click', () => {
            const r = receive(m, i);
            if (r.taken) sfx.item(it.tpl, 'pickup'); else toast('Not enough space in stash', 'warn');
            renderMessenger();
          });
          att.append(tile);
        });
        node.append(att, el('div', { class: 'msg__exp' }, `Will be stored for ${fmtLeft((m.exp || now) - now)}`));
      } else if (m.expired) {
        node.append(el('div', { class: 'msg__exp is-gone' }, 'The attached items were not collected in time'));
      }
      scroll.append(node);
    }
    right.append(scroll);
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  } else {
    right.append(el('div', { class: 'tl-empty' }, 'Select a conversation'));
  }
  host.append(left, right);
}

/** the bottom bar's entry opens and shuts the messenger through these */
export function messengerOpen() { return currentScreen() === 'messenger'; }
export function openMessenger(from = null) { if (from) openFrom = from; showScreen('messenger'); }
export function closeMessenger() { if (messengerOpen()) showScreen(previousScreen() === 'messenger' ? 'menu' : previousScreen()); }
export function toggleMessenger() { if (messengerOpen()) closeMessenger(); else openMessenger(); }

export function initMessenger() {
  on(EV.SCREEN_CHANGED, (id) => { if (id === 'messenger') renderMessenger(); });
  on(EV.MAIL, (msg) => { if (msg && currentScreen() === 'messenger') renderMessenger(); });
}
