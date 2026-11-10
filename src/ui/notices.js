// =========================================================
// what the game tells you as it happens
//
// A task that opened up, an objective ticked off, a message from a trader,
// a trader's regard going up: each is a strip that slides in at the right
// edge just over the bottom bar, in the client's own words, and a sound of
// its own - the task cues are the game's (started, subtask, completed,
// finished, failed), a message with something attached rings differently
// from one without.
// =========================================================

import { on, EV } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { t } from '../core/i18n.js';
import { traderName } from '../game/db.js';
import { skillName } from '../game/skills.js';
import { notify } from './shell.js';

/** the client marks the name it drops into a line as bold; a strip is plain text */
const plain = (s) => s.replace(/<\/?b>/g, '');

export function initNotices() {
  on(EV.QUEST, (e) => {
    if (!e) return;
    const name = e.task?.name;
    switch (e.kind) {
      case 'started':
        sfx.quest('started');
        notify(`${t('Quest start')}: ${name}`, 'quest');
        break;
      case 'objective':
        sfx.quest('subtask');
        notify(`${t('Subtask completed:')} ${name}`, 'quest');
        break;
      case 'ready':
        sfx.quest('completed');
        notify(t('NotifierQuestAvailableForFinish', name), 'quest', 5200);
        break;
      case 'done':
        sfx.quest('finished');
        break;
      case 'failed':
        sfx.quest('failed');
        notify(t('NotifierQuestFail', name), 'bad', 5200);
        break;
      case 'available':
        notify(t('NotifierQuestAvailableForStart', name), 'quest');
        break;
      case 'trader':
        notify(plain(t('ProfileEvent/UnlockTrader', e.trader.name)), 'quest', 5200);
        break;
      default:
    }
  });

  on(EV.MAIL, (msg) => {
    if (!msg) return;                       // a redraw, not a new message
    const stuff = msg.items && msg.items.length;
    sfx.chat(msg.kind === 'insurance' ? 'incoming_insurance' : stuff ? 'incoming_stuff' : 'incoming');
  });

  on(EV.LEVEL_UP, () => { sfx.ui('exp'); });

  on(EV.TRADER_STANDING, (e) => {
    if (!e || !e.delta) return;
    const text = e.delta > 0
      ? t('Notifications/TraderStandingIncreased{0}{1}', traderName(e.trader.id), e.delta.toFixed(2))
      : t('Notifications/TraderStandingDecreased{0}{1}', traderName(e.trader.id), Math.abs(e.delta).toFixed(2));
    notify(text, e.delta > 0 ? 'up' : 'down');
  });

  on(EV.SKILL_UP, (e) => {
    notify(t('SkillLevelUpMessage', skillName(e.id), e.level), 'up');
  });
}
