// Updates from GitHub Releases (electron-updater): checked a little after startup, then every few
// hours, downloaded in the background. Nothing is installed until the user clicks "restart" in the
// bar, or quits Lumen. The installed app only: never in a dev checkout or the test harness.
// macOS is skipped while Lumen is not signed (its updater refuses unsigned apps).
const { app } = require('electron');

let ready = null;   // version downloaded and waiting for a restart
let updater = null;

function start(broadcast) {
  if (!app.isPackaged || process.platform === 'darwin' || process.env.LUMEN_SCREENSHOT) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('update-downloaded', info => {
    ready = info.version;
    broadcast('update:ready', ready);
  });
  updater.on('error', () => {});
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

function install() {
  if (ready && updater) updater.quitAndInstall(false, true);
}

module.exports = { start, install, ready: () => ready };
