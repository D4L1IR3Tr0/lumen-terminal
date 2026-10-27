// @name Weather
// @description The current temperature in the top bar, from wttr.in (your location is guessed from your IP). Click it for the full forecast.
// @version 1.0.0
// @author Lumen
// @category bar

module.exports = lumen => {
  let now = '…';

  async function refresh() {
    try {
      // The JSON format: the plain-text one answers browsers with a web page.
      const res = await fetch('https://wttr.in/?format=j1');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cur = (await res.json()).current_condition?.[0];
      if (!cur) throw new Error('no data');
      now = `${cur.temp_C}°C ${cur.weatherDesc?.[0]?.value || ''}`.trim();
    } catch {
      now = 'n/a';
    }
    lumen.statusbar.refresh();
  }

  lumen.statusbar.add({
    id: 'weather',
    title: 'Weather (wttr.in): click for the forecast',
    text: () => now,
    onClick: () => lumen.ui.openUrl('https://wttr.in/')
  });

  lumen.commands.register('weather.refresh', { title: 'Weather: refresh', run: refresh });
  setInterval(refresh, 10 * 60 * 1000);
  refresh();
};
