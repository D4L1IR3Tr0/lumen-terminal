// Built-in themes. Shared between the main process (window background) and the renderer.
// Each theme has the 16 ANSI colors plus a few UI tokens used for the chrome.
(function (root) {
  const themes = {
    'tokyo-night': {
      name: 'Tokyo Night',
      ui: { crust: '#13141c', surface: '#1f2335', overlay: '#292e42', border: '#2f3549', accent: '#7aa2f7', accent2: '#bb9af7', muted: '#565f89' },
      background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selectionBackground: '#33467c',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#565f89', brightRed: '#ff899d', brightGreen: '#9fe044', brightYellow: '#faba4a', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff', brightCyan: '#a4daff', brightWhite: '#c0caf5'
    },
    'catppuccin-mocha': {
      name: 'Catppuccin Mocha',
      ui: { crust: '#11111b', surface: '#181825', overlay: '#313244', border: '#313244', accent: '#cba6f7', accent2: '#89b4fa', muted: '#6c7086' },
      background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a',
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
      brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8'
    },
    'rose-pine': {
      name: 'Rosé Pine',
      ui: { crust: '#111019', surface: '#1f1d2e', overlay: '#26233a', border: '#2a273f', accent: '#ebbcba', accent2: '#c4a7e7', muted: '#6e6a86' },
      background: '#191724', foreground: '#e0def4', cursor: '#e0def4', selectionBackground: '#403d52',
      black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
      brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4'
    },
    'kanagawa': {
      name: 'Kanagawa',
      ui: { crust: '#16161d', surface: '#1a1a22', overlay: '#2a2a37', border: '#2a2a37', accent: '#7e9cd8', accent2: '#e6c384', muted: '#727169' },
      background: '#1f1f28', foreground: '#dcd7ba', cursor: '#c8c093', selectionBackground: '#2d4f67',
      black: '#16161d', red: '#c34043', green: '#76946a', yellow: '#c0a36e', blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093',
      brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c', brightYellow: '#e6c384', brightBlue: '#7fb4ca', brightMagenta: '#938aa9', brightCyan: '#7aa89f', brightWhite: '#dcd7ba'
    },
    'gruvbox': {
      name: 'Gruvbox',
      ui: { crust: '#1d2021', surface: '#232323', overlay: '#3c3836', border: '#3c3836', accent: '#fabd2f', accent2: '#fe8019', muted: '#928374' },
      background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
    },
    'everforest': {
      name: 'Everforest',
      ui: { crust: '#1e2326', surface: '#272e33', overlay: '#374145', border: '#374145', accent: '#a7c080', accent2: '#83c092', muted: '#859289' },
      background: '#2d353b', foreground: '#d3c6aa', cursor: '#d3c6aa', selectionBackground: '#475258',
      black: '#343f44', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d3c6aa',
      brightBlack: '#868d80', brightRed: '#e67e80', brightGreen: '#a7c080', brightYellow: '#dbbc7f', brightBlue: '#7fbbb3', brightMagenta: '#d699b6', brightCyan: '#83c092', brightWhite: '#d3c6aa'
    },
    'nord': {
      name: 'Nord',
      ui: { crust: '#21252e', surface: '#292e39', overlay: '#3b4252', border: '#3b4252', accent: '#88c0d0', accent2: '#81a1c1', muted: '#616e88' },
      background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
    },
    'matte-black': {
      name: 'Matte Black',
      ui: { crust: '#0b0b0b', surface: '#161616', overlay: '#222222', border: '#262626', accent: '#f59e0b', accent2: '#e5e5e5', muted: '#6b6b6b' },
      background: '#121212', foreground: '#d4d4d4', cursor: '#f59e0b', selectionBackground: '#333333',
      black: '#262626', red: '#d35f5f', green: '#a3b18a', yellow: '#f59e0b', blue: '#8a9db5', magenta: '#b294bb', cyan: '#8abeb7', white: '#bebebe',
      brightBlack: '#5c5c5c', brightRed: '#e57373', brightGreen: '#b5c99a', brightYellow: '#fbbf24', brightBlue: '#a3b8cc', brightMagenta: '#c5a3cf', brightCyan: '#a3d1ca', brightWhite: '#eaeaea'
    },
    'dracula': {
      name: 'Dracula',
      ui: { crust: '#1e1f29', surface: '#21222c', overlay: '#343746', border: '#343746', accent: '#bd93f9', accent2: '#ff79c6', muted: '#6272a4' },
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
    },
    'one-dark': {
      name: 'One Dark',
      ui: { crust: '#1b1e23', surface: '#21252b', overlay: '#2c313a', border: '#2c313a', accent: '#61afef', accent2: '#c678dd', muted: '#5c6370' },
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451',
      black: '#3f4451', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d7dae0',
      brightBlack: '#5c6370', brightRed: '#ff7b86', brightGreen: '#a5e075', brightYellow: '#f0cd8a', brightBlue: '#4dc4ff', brightMagenta: '#de73ff', brightCyan: '#4cd1e0', brightWhite: '#e6e6e6'
    },
    'github-dark': {
      name: 'GitHub Dark',
      ui: { crust: '#010409', surface: '#161b22', overlay: '#21262d', border: '#30363d', accent: '#58a6ff', accent2: '#bc8cff', muted: '#7d8590' },
      background: '#0d1117', foreground: '#e6edf3', cursor: '#58a6ff', selectionBackground: '#264f78',
      black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff'
    },
    'night-owl': {
      name: 'Night Owl',
      ui: { crust: '#010e1a', surface: '#0b2942', overlay: '#13344f', border: '#122d42', accent: '#82aaff', accent2: '#c792ea', muted: '#5f7e97' },
      background: '#011627', foreground: '#d6deeb', cursor: '#80a4c2', selectionBackground: '#1d3b53',
      black: '#0b2942', red: '#ef5350', green: '#22da6e', yellow: '#addb67', blue: '#82aaff', magenta: '#c792ea', cyan: '#21c7a8', white: '#d6deeb',
      brightBlack: '#5f7e97', brightRed: '#ef5350', brightGreen: '#22da6e', brightYellow: '#ffeb95', brightBlue: '#82aaff', brightMagenta: '#c792ea', brightCyan: '#7fdbca', brightWhite: '#ffffff'
    },
    'ayu-mirage': {
      name: 'Ayu Mirage',
      ui: { crust: '#171b24', surface: '#1c212b', overlay: '#2a3040', border: '#2a3040', accent: '#ffcc66', accent2: '#73d0ff', muted: '#707a8c' },
      background: '#1f2430', foreground: '#cccac2', cursor: '#ffcc66', selectionBackground: '#33415e',
      black: '#171b24', red: '#ed8274', green: '#87d96c', yellow: '#facc6e', blue: '#6dcbfa', magenta: '#dabafa', cyan: '#90e1c6', white: '#c7c7c7',
      brightBlack: '#686868', brightRed: '#f28779', brightGreen: '#d5ff80', brightYellow: '#ffd173', brightBlue: '#73d0ff', brightMagenta: '#dfbfff', brightCyan: '#95e6cb', brightWhite: '#ffffff'
    },
    'monokai-pro': {
      name: 'Monokai Pro',
      ui: { crust: '#221f22', surface: '#2a272b', overlay: '#403e41', border: '#403e41', accent: '#ffd866', accent2: '#ff6188', muted: '#727072' },
      background: '#2d2a2e', foreground: '#fcfcfa', cursor: '#fcfcfa', selectionBackground: '#5b595c',
      black: '#403e41', red: '#ff6188', green: '#a9dc76', yellow: '#ffd866', blue: '#fc9867', magenta: '#ab9df2', cyan: '#78dce8', white: '#fcfcfa',
      brightBlack: '#727072', brightRed: '#ff6188', brightGreen: '#a9dc76', brightYellow: '#ffd866', brightBlue: '#fc9867', brightMagenta: '#ab9df2', brightCyan: '#78dce8', brightWhite: '#ffffff'
    },
    'solarized-dark': {
      name: 'Solarized Dark',
      ui: { crust: '#00212b', surface: '#073642', overlay: '#0b4452', border: '#0b4452', accent: '#268bd2', accent2: '#2aa198', muted: '#586e75' },
      background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selectionBackground: '#0e4a5a',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#a3b800', brightYellow: '#d9a400', brightBlue: '#4aa3e8', brightMagenta: '#6c71c4', brightCyan: '#3ec1b6', brightWhite: '#fdf6e3'
    },
    'synthwave-84': {
      name: "Synthwave '84",
      ui: { crust: '#1a1726', surface: '#241b2f', overlay: '#34294f', border: '#34294f', accent: '#ff7edb', accent2: '#03edf9', muted: '#848bbd' },
      background: '#262335', foreground: '#f0eff1', cursor: '#ff7edb', selectionBackground: '#463465',
      black: '#2a2139', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#03edf9', magenta: '#ff7edb', cyan: '#03edf9', white: '#f0eff1',
      brightBlack: '#614d85', brightRed: '#fe4450', brightGreen: '#72f1b8', brightYellow: '#f3e70f', brightBlue: '#03edf9', brightMagenta: '#ff7edb', brightCyan: '#03edf9', brightWhite: '#ffffff'
    },
    'poimandres': {
      name: 'Poimandres',
      ui: { crust: '#14161e', surface: '#222533', overlay: '#303340', border: '#303340', accent: '#5de4c7', accent2: '#fcc5e9', muted: '#767c9d' },
      background: '#1b1e28', foreground: '#a6accd', cursor: '#a6accd', selectionBackground: '#303340',
      black: '#303340', red: '#d0679d', green: '#5de4c7', yellow: '#fffac2', blue: '#89ddff', magenta: '#fcc5e9', cyan: '#add7ff', white: '#e4f0fb',
      brightBlack: '#767c9d', brightRed: '#d0679d', brightGreen: '#5de4c7', brightYellow: '#fffac2', brightBlue: '#add7ff', brightMagenta: '#fae4fc', brightCyan: '#89ddff', brightWhite: '#ffffff'
    },
    'oxocarbon': {
      name: 'Oxocarbon',
      ui: { crust: '#0f0f0f', surface: '#1c1c1c', overlay: '#262626', border: '#262626', accent: '#78a9ff', accent2: '#be95ff', muted: '#6f6f6f' },
      background: '#161616', foreground: '#f2f4f8', cursor: '#f2f4f8', selectionBackground: '#393939',
      black: '#262626', red: '#ee5396', green: '#42be65', yellow: '#ffe97b', blue: '#33b1ff', magenta: '#ff7eb6', cyan: '#3ddbd9', white: '#dde1e6',
      brightBlack: '#525252', brightRed: '#ee5396', brightGreen: '#42be65', brightYellow: '#ffe97b', brightBlue: '#78a9ff', brightMagenta: '#be95ff', brightCyan: '#08bdba', brightWhite: '#ffffff'
    },
    'osaka-jade': {
      name: 'Osaka Jade',
      ui: { crust: '#0b1411', surface: '#15231e', overlay: '#1f3329', border: '#1f3329', accent: '#2dd5b7', accent2: '#e5c736', muted: '#53685b' },
      background: '#111c18', foreground: '#c1c497', cursor: '#2dd5b7', selectionBackground: '#23372b',
      black: '#23372b', red: '#db5a4a', green: '#63b07a', yellow: '#e5c736', blue: '#509475', magenta: '#d2689c', cyan: '#2dd5b7', white: '#c1c497',
      brightBlack: '#53685b', brightRed: '#ff6b5a', brightGreen: '#78c48d', brightYellow: '#f0d750', brightBlue: '#6cbf99', brightMagenta: '#e47fae', brightCyan: '#4be3c6', brightWhite: '#e6e6c0'
    },
    'catppuccin-latte': {
      name: 'Catppuccin Latte',
      light: true,
      ui: { crust: '#dce0e8', surface: '#e6e9ef', overlay: '#ccd0da', border: '#ccd0da', accent: '#8839ef', accent2: '#1e66f5', muted: '#8c8fa1' },
      background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', selectionBackground: '#bcc0cc',
      black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d', blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
      brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc'
    },
    'rose-pine-dawn': {
      name: 'Rosé Pine Dawn',
      light: true,
      ui: { crust: '#f2e9e1', surface: '#fffaf3', overlay: '#f2e9e1', border: '#dfdad9', accent: '#d7827e', accent2: '#907aa9', muted: '#9893a5' },
      background: '#faf4ed', foreground: '#575279', cursor: '#575279', selectionBackground: '#dfdad9',
      black: '#f2e9e1', red: '#b4637a', green: '#286983', yellow: '#ea9d34', blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279',
      brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34', brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#575279'
    },
    'flexoki-light': {
      name: 'Flexoki Light',
      light: true,
      ui: { crust: '#f2f0e5', surface: '#fffcf0', overlay: '#e6e4d9', border: '#dad8ce', accent: '#205ea6', accent2: '#a02f6f', muted: '#878580' },
      background: '#fffcf0', foreground: '#100f0f', cursor: '#100f0f', selectionBackground: '#dad8ce',
      black: '#100f0f', red: '#af3029', green: '#66800b', yellow: '#ad8301', blue: '#205ea6', magenta: '#a02f6f', cyan: '#24837b', white: '#9f9d96',
      brightBlack: '#575653', brightRed: '#d14d41', brightGreen: '#879a39', brightYellow: '#d0a215', brightBlue: '#4385be', brightMagenta: '#ce5d97', brightCyan: '#3aa99f', brightWhite: '#cecdc3'
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = themes;
  else root.LumenThemes = themes;
})(typeof window !== 'undefined' ? window : globalThis);
