/**
 * RETRO-NET BBS - VT100 / ANSI CRT Terminal Interface Engine
 * Manages CRT display buffer, command history, tab autocomplete, and phosphor themes.
 */

import { retroAudio } from './audio.js';

export const THEMES = {
  green: {
    id: 'green',
    name: 'P1 Green Phosphor',
    class: 'theme-green',
    color: '#33ff33'
  },
  amber: {
    id: 'amber',
    name: 'Amber CRT',
    class: 'theme-amber',
    color: '#ffb000'
  },
  cyan: {
    id: 'cyan',
    name: 'Cyberpunk Cyan',
    class: 'theme-cyan',
    color: '#00f3ff'
  },
  white: {
    id: 'white',
    name: 'Paper White Monochrome',
    class: 'theme-white',
    color: '#e0e0e0'
  }
};

export class Terminal {
  constructor(containerId, inputId, promptId) {
    this.container = document.getElementById(containerId);
    this.input = document.getElementById(inputId);
    this.promptEl = document.getElementById(promptId);

    this.history = [];
    this.historyIndex = -1;
    this.commands = new Map(); // name -> { desc, usage, handler }
    this.callsign = 'NODE-0000';
    this.currentTheme = 'green';

    this.onCommandExecute = null;
    this.onFileDropped = null;

    this._initTheme();
    this._bindEvents();
  }

  _initTheme() {
    try {
      const saved = localStorage.getItem('bbs_theme');
      if (saved && THEMES[saved]) {
        this.setTheme(saved, false);
      } else {
        this.setTheme('green', false);
      }
    } catch (e) {
      this.setTheme('green', false);
    }
  }

  setTheme(themeId, echo = true) {
    if (!THEMES[themeId]) return;
    this.currentTheme = themeId;
    try {
      localStorage.setItem('bbs_theme', themeId);
    } catch (e) {}

    // Update CRT element class
    const crtScreen = document.querySelector('.crt-screen') || document.body;
    Object.values(THEMES).forEach(t => crtScreen.classList.remove(t.class));
    crtScreen.classList.add(THEMES[themeId].class);

    if (echo) {
      this.println(`[DISPLAY] Phosphor palette switched to: ${THEMES[themeId].name}`, 'system');
      retroAudio.playBlip();
    }
  }

  cycleTheme() {
    const themeKeys = Object.keys(THEMES);
    const currentIndex = themeKeys.indexOf(this.currentTheme);
    const nextTheme = themeKeys[(currentIndex + 1) % themeKeys.length];
    this.setTheme(nextTheme, true);
    return THEMES[nextTheme];
  }

  setCallsign(callsign) {
    this.callsign = callsign;
    if (this.promptEl) {
      this.promptEl.textContent = `[${this.callsign}] >`;
    }
  }

  registerCommand(name, desc, usage, handler) {
    this.commands.set(name.toLowerCase(), { desc, usage, handler });
  }

  _bindEvents() {
    // Focus input on click anywhere inside screen
    if (this.container) {
      this.container.addEventListener('click', () => {
        if (this.input) this.input.focus();
      });

      // Drag and drop file handling
      this.container.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.container.classList.add('dragover');
      });

      this.container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        this.container.classList.remove('dragover');
      });

      this.container.addEventListener('drop', (e) => {
        e.preventDefault();
        this.container.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          if (this.onFileDropped) {
            this.onFileDropped(file);
          }
        }
      });
    }

    if (this.input) {
      this.input.addEventListener('keydown', (e) => this._handleKeyDown(e));
      this.input.addEventListener('input', () => {
        retroAudio.playKeyClick();
      });
    }
  }

  _handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const rawText = this.input.value;
      this.input.value = '';
      this._execute(rawText);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.history.length === 0) return;
      if (this.historyIndex === -1) {
        this.historyIndex = this.history.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
      this.input.value = this.history[this.historyIndex] || '';
      retroAudio.playKeyClick();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.historyIndex !== -1) {
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.input.value = this.history[this.historyIndex];
        } else {
          this.historyIndex = -1;
          this.input.value = '';
        }
        retroAudio.playKeyClick();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this._handleTabComplete();
    } else if (e.key === 'c' && e.ctrlKey) {
      // Ctrl+C clear line
      this.println(`${this.promptEl ? this.promptEl.textContent : '>'} ${this.input.value}^C`, 'dim');
      this.input.value = '';
    } else if (e.key === 'l' && e.ctrlKey) {
      // Ctrl+L clear screen
      e.preventDefault();
      this.clear();
    }
  }

  _handleTabComplete() {
    const val = this.input.value.trimStart();
    if (!val.startsWith('/')) return;

    const query = val.toLowerCase();
    const matches = Array.from(this.commands.keys()).filter(cmd => cmd.startsWith(query));

    if (matches.length === 1) {
      this.input.value = matches[0] + ' ';
      retroAudio.playKeyClick();
    } else if (matches.length > 1) {
      this.println(`[AUTOCOMPLETE] ${matches.join('   ')}`, 'info');
      retroAudio.playBlip();
    }
  }

  _execute(rawText) {
    const line = rawText.trim();
    if (!line) return;

    // Save to history
    this.history.push(line);
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = -1;

    // Echo input line
    this.println(`${this.promptEl ? this.promptEl.textContent : '>'} ${line}`, 'echo-line');

    // Check if command
    if (line.startsWith('/')) {
      const parts = line.split(/\s+/);
      const cmdName = parts[0].toLowerCase();
      const args = line.slice(parts[0].length).trim();

      const cmd = this.commands.get(cmdName);
      if (cmd) {
        try {
          cmd.handler(args, parts.slice(1));
        } catch (err) {
          this.printError(`Error executing command ${cmdName}: ${err.message}`);
        }
      } else {
        this.printError(`Unknown command: "${cmdName}". Type /help for command index.`);
      }
    } else {
      // Public broadcast chat
      if (this.onCommandExecute) {
        this.onCommandExecute(line);
      }
    }

    this.scrollToBottom();
  }

  print(text, className = '') {
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    this.container.appendChild(span);
    this.scrollToBottom();
  }

  println(text = '', className = '') {
    const div = document.createElement('div');
    div.className = `term-line ${className}`.trim();
    div.textContent = text;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  printHtml(htmlString, className = '') {
    const div = document.createElement('div');
    div.className = `term-line ${className}`.trim();
    div.innerHTML = htmlString;
    this.container.appendChild(div);
    this.scrollToBottom();
  }

  printSuccess(text) {
    this.println(`[+] ${text}`, 'success');
  }

  printError(text) {
    this.println(`[!] ${text}`, 'error');
    retroAudio.playBell(440);
  }

  printWarn(text) {
    this.println(`[*] ${text}`, 'warning');
  }

  printInfo(text) {
    this.println(`[i] ${text}`, 'info');
  }

  printBanner() {
    const banner = [
      ' ██████╗ ███████╗████████╗██████╗  ██████╗       ███╗   ██╗███████╗████████╗',
      ' ██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗      ████╗  ██║██╔════╝╚══██╔══╝',
      ' ██████╔╝█████╗     ██║   ██████╔╝██║   ██║█████╗██╔██╗ ██║█████╗     ██║   ',
      ' ██╔══██╗██╔══╝     ██║   ██╔══██╗██║   ██║╚════╝██║╚██╗██║██╔══╝     ██║   ',
      ' ██║  ██║███████╗   ██║   ██║  ██║╚██████╔╝      ██║ ╚████║███████╗   ██║   ',
      ' ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝       ╚═╝  ╚═══╝╚══════╝   ╚═╝   ',
      ' ──────────────────────────────────────────────────────────────────────────',
      '  RETRO-NET BBS v2.4 (AIR-GAPPED NODE) — SERVERLESS WEBRTC OPTICAL MESH',
      '  Zero Cloud Dependencies • Pure P2P DataChannels • Optical QR Handshakes',
      ' ──────────────────────────────────────────────────────────────────────────',
      '  Type /help for command index. Type /connect to begin optical QR handshake.',
      '  Fast Test: Click "Pair Tab" or type /pair to test with another local tab!'
    ];
    banner.forEach(l => this.println(l, 'banner-line'));
    this.println('');
  }

  printTable(headers, rows) {
    // Calculate column widths
    const colWidths = headers.map((h, i) => {
      let max = h.length;
      rows.forEach(r => {
        const val = String(r[i] ?? '');
        if (val.length > max) max = val.length;
      });
      return max + 2;
    });

    const formatRow = (cols) => {
      return cols.map((c, i) => String(c).padEnd(colWidths[i], ' ')).join(' ');
    };

    const separator = colWidths.map(w => '─'.repeat(w)).join('─');

    this.println(formatRow(headers), 'table-header');
    this.println(separator, 'dim');
    rows.forEach(r => {
      this.println(formatRow(r), 'table-row');
    });
  }

  printProgressBar(id, label, percent, details = '') {
    const barWidth = 24;
    const filled = Math.min(barWidth, Math.max(0, Math.round((percent / 100) * barWidth)));
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    const text = `${label.padEnd(16)} [${bar}] ${String(percent).padStart(3)}% ${details}`;

    // Update existing line if id matches
    let lineEl = document.getElementById(`prog-${id}`);
    if (!lineEl) {
      lineEl = document.createElement('div');
      lineEl.id = `prog-${id}`;
      lineEl.className = 'term-line progress-line';
      this.container.appendChild(lineEl);
    }
    lineEl.textContent = text;
    this.scrollToBottom();
  }

  clear() {
    this.container.innerHTML = '';
    this.printBanner();
  }

  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
