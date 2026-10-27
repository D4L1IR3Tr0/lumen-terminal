// @name Pomodoro
// @description A 25/5 focus timer in the top bar. Click it to start or pause; a toast tells you when to take a break.
// @version 1.0.0
// @author Lumen
// @category productivity

module.exports = lumen => {
  const WORK = 25 * 60;
  const BREAK = 5 * 60;
  let phase = 'idle';   // idle | work | break
  let left = WORK;
  let timer = null;

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function tick() {
    left--;
    if (left <= 0) {
      if (phase === 'work') { phase = 'break'; left = BREAK; lumen.notify('Pomodoro: time for a 5 minute break'); }
      else { phase = 'work'; left = WORK; lumen.notify('Pomodoro: back to work'); }
    }
    lumen.statusbar.refresh();
  }

  function start() {
    if (timer) return;
    if (phase === 'idle') { phase = 'work'; left = WORK; }
    timer = setInterval(tick, 1000);
    lumen.statusbar.refresh();
  }

  function pause() {
    clearInterval(timer);
    timer = null;
    lumen.statusbar.refresh();
  }

  function reset() {
    pause();
    phase = 'idle';
    left = WORK;
    lumen.statusbar.refresh();
  }

  lumen.statusbar.add({
    id: 'pomodoro',
    title: 'Pomodoro: click to start or pause',
    text: () => (phase === 'idle' ? 'focus 25:00' : `${phase} ${fmt(left)}${timer ? '' : ' (paused)'}`),
    onClick: () => (timer ? pause() : start())
  });

  lumen.commands.register('pomodoro.toggle', { title: 'Pomodoro: start / pause', run: () => (timer ? pause() : start()), keywords: 'focus timer' });
  lumen.commands.register('pomodoro.reset', { title: 'Pomodoro: reset', run: reset, keywords: 'focus timer' });
};
