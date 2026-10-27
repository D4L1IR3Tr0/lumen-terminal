// Bridge between the sandboxed page and the main process. Only these calls are exposed.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = channel => cb => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('native', {
  init: () => ipcRenderer.invoke('app:init'),
  pty: {
    spawn: opts => ipcRenderer.invoke('pty:spawn', opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: id => ipcRenderer.send('pty:kill', id),
    onData: listen('pty:data'),
    onExit: listen('pty:exit')
  },
  update: {
    ready: () => ipcRenderer.invoke('update:ready'),
    install: () => ipcRenderer.send('update:install'),
    onReady: listen('update:ready')
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    create: () => ipcRenderer.send('win:new'),
    toggleFullscreen: () => ipcRenderer.send('win:toggleFullscreen'),
    reload: () => ipcRenderer.send('win:reload'),
    devtools: () => ipcRenderer.send('win:devtools'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: listen('win:maximized')
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: text => ipcRenderer.send('clipboard:write', text)
  },
  // ~/.lumen/backgrounds and ~/.lumen/fonts
  assets: {
    list: kind => ipcRenderer.invoke('assets:list', kind),
    import: (kind, file) => ipcRenderer.invoke('assets:import', kind, file),
    remove: (kind, name) => ipcRenderer.invoke('assets:remove', kind, name)
  },
  image: {
    sample: (file, width) => ipcRenderer.invoke('image:sample', file, width)
  },
  session: {
    update: snap => ipcRenderer.send('session:update', snap)
  },
  notify: (title, body, paneId) => ipcRenderer.send('notify', { title, body, paneId }),
  onNotifyClick: listen('notify:click'),
  // Real path of a file dropped on the window.
  pathForFile: file => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
  open: {
    external: url => ipcRenderer.send('open:external', url),
    reveal: target => ipcRenderer.send('open:reveal', target),
    path: which => ipcRenderer.send('open:path', which)
  },
  config: {
    setTheme: id => ipcRenderer.invoke('config:setTheme', id),
    set: (keyPath, value) => ipcRenderer.invoke('config:set', keyPath, value),
    onChange: listen('config:changed')
  },
  git: {
    status: cwd => ipcRenderer.invoke('git:status', cwd),
    op: (name, ...args) => ipcRenderer.invoke('git:op', name, ...args)
  },
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    get: pathname => ipcRenderer.invoke('github:get', pathname),
    contributions: () => ipcRenderer.invoke('github:contributions'),
    setToken: token => ipcRenderer.invoke('github:setToken', token),
    signOut: () => ipcRenderer.invoke('github:signOut'),
    refresh: () => ipcRenderer.invoke('github:refresh')
  },
  stats: {
    onSample: listen('stats')
  },
  fs: {
    list: dir => ipcRenderer.invoke('fs:list', dir)
  },
  store: {
    get: name => ipcRenderer.invoke('store:get', name),
    set: (name, data) => ipcRenderer.invoke('store:set', name, data),
    onChange: listen('store:changed')
  },
  clipboardHistory: {
    list: () => ipcRenderer.invoke('clipboard:history'),
    remove: text => ipcRenderer.invoke('clipboard:remove', text),
    clear: () => ipcRenderer.invoke('clipboard:clear'),
    onChange: listen('clipboard:changed')
  },
  folders: {
    open: dir => ipcRenderer.send('open:folder', dir),
    isDir: dir => ipcRenderer.invoke('fs:isDir', dir)
  },
  aliases: {
    list: () => ipcRenderer.invoke('aliases:list'),
    save: list => ipcRenderer.invoke('aliases:save', list),
    detect: () => ipcRenderer.invoke('aliases:detect'),
    forPty: id => ipcRenderer.invoke('aliases:forPty', id)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    read: file => ipcRenderer.invoke('plugins:read', file),
    readBuiltin: file => ipcRenderer.invoke('plugins:readBuiltin', file),
    toggle: file => ipcRenderer.invoke('plugins:toggle', file),
    remove: file => ipcRenderer.invoke('plugins:remove', file),
    install: (name, code, enabled) => ipcRenderer.invoke('plugins:install', name, code, enabled),
    installUrl: url => ipcRenderer.invoke('plugins:installUrl', url),
    registry: fresh => ipcRenderer.invoke('plugins:registry', fresh),
    installRegistry: id => ipcRenderer.invoke('plugins:installRegistry', id),
    installPath: file => ipcRenderer.invoke('plugins:installPath', file)
  },
  agents: {
    detect: () => ipcRenderer.invoke('agents:detect')
  },
  // Embedded agents over ACP (Gemini CLI, Codex, Claude Code, Mistral Vibe)
  acp: {
    list: () => ipcRenderer.invoke('acp:list'),
    status: () => ipcRenderer.invoke('acp:status'),
    start: (agentId, opts) => ipcRenderer.send('acp:start', agentId, opts),
    prompt: (text, environment) => ipcRenderer.send('acp:prompt', text, environment),
    cancel: () => ipcRenderer.send('acp:cancel'),
    stop: () => ipcRenderer.send('acp:stop'),
    setAuto: on => ipcRenderer.send('acp:auto', on),
    authenticate: methodId => ipcRenderer.send('acp:authenticate', methodId),
    setMode: modeId => ipcRenderer.send('acp:mode', modeId),
    answerPermission: (id, optionId) => ipcRenderer.send('acp:permission', id, optionId),
    answerMcp: (id, result) => ipcRenderer.send('acp:mcpReply', id, result),
    onEvent: listen('acp:event'),
    onTerminal: listen('acp:terminal')
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    setKey: key => ipcRenderer.invoke('ai:setKey', key),
    models: () => ipcRenderer.invoke('ai:models'),
    history: () => ipcRenderer.invoke('ai:history'),
    send: payload => ipcRenderer.send('ai:send', payload),
    stop: () => ipcRenderer.send('ai:stop'),
    reply: (id, answer) => ipcRenderer.send('ai:reply', id, answer),
    reset: () => ipcRenderer.send('ai:reset'),
    onEvent: listen('ai:event')
  },
  onPanelOpen: listen('panel:open'),
  onReminder: listen('reminder')
});
