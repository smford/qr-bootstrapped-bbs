/**
 * RETRO-NET BBS - Main Application Controller
 * Orchestrates Terminal, WebRTC Signaling, P2P Mesh Network, Audio, and BBS Services.
 */

import { retroAudio } from './audio.js';
import { Terminal } from './terminal.js';
import {
  compressString,
  decompressString,
  slicePayload,
  waitForIceGatheringComplete,
  AnimatedQrPlayer,
  OpticalScanner
} from './webrtc-signaling.js';
import { MeshNetwork } from './mesh.js';
import { BBSBoard, FileTransferManager } from './bbs.js';

class App {
  constructor() {
    this.nodeId = 'NODE-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    this.callsign = this.nodeId;

    // Load saved callsign if available
    try {
      const saved = localStorage.getItem('bbs_callsign');
      if (saved) this.callsign = saved.toUpperCase();
    } catch (e) {}

    // Core subsystems
    this.terminal = new Terminal('terminal-output', 'command-input', 'terminal-prompt');
    this.mesh = new MeshNetwork(this.nodeId, this.callsign);
    this.bbs = new BBSBoard();
    this.fileManager = new FileTransferManager(this.mesh, this.terminal);

    // Optical Signaling Elements
    this.modal = document.getElementById('signaling-modal');
    this.qrCanvas = document.getElementById('qr-canvas');
    this.qrCounter = document.getElementById('qr-counter');
    this.qrProgress = document.getElementById('qr-progress-bar');

    this.qrPlayer = new AnimatedQrPlayer(this.qrCanvas, this.qrCounter, this.qrProgress);

    // Host scanner (scans joiner answer)
    this.hostScanner = new OpticalScanner(
      document.getElementById('scanner-video'),
      document.getElementById('scanner-canvas'),
      document.getElementById('scanner-hud')
    );

    // Joiner scanner (scans host offer)
    this.joinScanner = new OpticalScanner(
      document.getElementById('join-scanner-video'),
      document.getElementById('join-scanner-canvas'),
      document.getElementById('join-scanner-hud')
    );

    // Local Dual-Tab BroadcastChannel Pairing
    this.bc = new BroadcastChannel('retro-bbs-signaling');
    this.pendingSignaling = null; // { peer, dc, sid, role }

    this.init();
  }

  init() {
    this.terminal.setCallsign(this.callsign);
    this.terminal.printBanner();

    this._registerCommands();
    this._bindMeshEvents();
    this._bindBroadcastChannel();
    this._bindUIControls();
    this._bindFilePicker();

    // Auto-focus terminal input
    setTimeout(() => {
      const input = document.getElementById('command-input');
      if (input) input.focus();
    }, 100);
  }

  _bindMeshEvents() {
    this.mesh.onPeerConnected = (peer) => {
      this.terminal.printSuccess(`WebRTC DataChannel established with peer: ${peer.callsign} (${peer.id})!`);
      this.terminal.println(`[MESH] Connection latency: ${peer.latency || 'measuring...'} | Candidate: ${peer.candidateType}`, 'info');
      this._updateStatusBadge();

      // Send recent BBS posts to the newly connected peer
      this.mesh.broadcast({
        type: 'post_sync',
        posts: this.bbs.posts.slice(0, 10)
      });
    };

    this.mesh.onPeerDisconnected = (peer) => {
      this.terminal.printWarn(`Peer disconnected from mesh: ${peer.callsign} (${peer.id})`);
      this._updateStatusBadge();
    };

    this.mesh.onChatMessage = (msg) => {
      this.terminal.println(`<${msg.author}> ${msg.text}`, 'chat-line');
      retroAudio.playBlip();
    };

    this.mesh.onPostMessage = (packet) => {
      if (packet.post && this.bbs.mergePost(packet.post)) {
        this.terminal.println(`\n[BULLETIN] New post #${packet.post.id} from ${packet.post.author}: "${packet.post.subject}"`, 'bulletin-notify');
        this.terminal.println(`Type /read ${packet.post.id} to view full post content.`, 'dim');
        retroAudio.playBell(850);
      }
    };

    this.mesh.onWhisperMessage = (msg) => {
      this.terminal.println(`[WHISPER from ${msg.author}] ${msg.text}`, 'whisper-line');
      retroAudio.playBell(1000);
    };

    this.mesh.onFilePacket = (packet, peer) => {
      this.fileManager.handlePacket(packet, peer);
    };

    this.mesh.onPeerListChange = () => {
      this._updateStatusBadge();
    };

    // Terminal public chat handler
    this.terminal.onCommandExecute = (text) => {
      if (this.mesh.getConnectedCount() === 0) {
        this.terminal.printWarn('No peers connected! Your message was echoed locally. Type /connect or /pair to link peers.');
      }
      this.mesh.broadcast({
        id: `M-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: 'chat',
        author: this.callsign,
        text,
        timestamp: Date.now(),
        hops: 0
      });
    };

    // Terminal drag-and-drop file handler
    this.terminal.onFileDropped = (file) => {
      this.fileManager.sendFile(file);
    };
  }

  _updateStatusBadge() {
    const badge = document.getElementById('peer-count-badge');
    const count = this.mesh.getConnectedCount();
    if (badge) {
      badge.textContent = `${count} PEER${count === 1 ? '' : 'S'}`;
      if (count > 0) {
        badge.classList.add('online');
      } else {
        badge.classList.remove('online');
      }
    }
  }

  _registerCommands() {
    // /help
    this.terminal.registerCommand(
      '/help',
      'Display command index and BBS instructions',
      '/help',
      () => {
        this.terminal.println('AVAILABLE RETRO-NET BBS COMMANDS:', 'cmd-header');
        const commands = [
          ['/help', 'Display this command manual'],
          ['/who', 'List all connected mesh nodes, latency, and ICE types'],
          ['/connect', 'Open Optical QR Handshake modal (Air-gapped webcam signaling)'],
          ['/pair', 'Instant 1-click WebRTC pairing across local browser tabs'],
          ['/post <subj> | <msg>', 'Publish a new bulletin to the public BBS board'],
          ['/read [id or page]', 'Read BBS bulletin posts (default: latest page 1)'],
          ['/msg <callsign> <text>', 'Send encrypted private P2P whisper to a specific peer'],
          ['/dropfile', 'Open file picker to beam file to peers (or drag & drop on screen)'],
          ['/ansi', 'Cycle phosphor color (P1 Green, Amber, Cyan, Paper White)'],
          ['/sound', 'Toggle mechanical keyboard clicks & dial-up modem sound'],
          ['/nick <callsign>', 'Change your node callsign'],
          ['/status', 'Display node diagnostics, memory, and packet counters'],
          ['/clear', 'Clear CRT terminal screen buffer']
        ];
        this.terminal.printTable(['COMMAND', 'DESCRIPTION'], commands);
        this.terminal.println('\nTIP: Simply type plain text and hit Enter to broadcast public chat to all connected nodes!', 'dim');
      }
    );

    // /who
    this.terminal.registerCommand(
      '/who',
      'List connected mesh peers',
      '/who',
      () => {
        const peers = this.mesh.getPeerList();
        if (peers.length === 0) {
          this.terminal.println('No peers currently connected to the local mesh.', 'dim');
          this.terminal.println('Use /connect to start an optical QR handshake or /pair to link with a local tab.', 'dim');
          return;
        }
        this.terminal.println(`ACTIVE MESH PEERS (${peers.length} NODES):`, 'cmd-header');
        const rows = peers.map(p => [p.callsign, p.id, p.candidateType, p.latency, p.state]);
        this.terminal.printTable(['CALLSIGN', 'PEER ID', 'ICE TYPE', 'LATENCY', 'STATUS'], rows);
      }
    );

    // /post
    this.terminal.registerCommand(
      '/post',
      'Post a bulletin to the BBS board',
      '/post <subject> | <message>',
      (args) => {
        if (!args || !args.includes('|')) {
          this.terminal.printError('Syntax: /post <subject> | <message>');
          this.terminal.println('Example: /post HARDWARE SWAP | Looking for VT220 terminal keyboards in sector 7.', 'dim');
          return;
        }
        const pipeIdx = args.indexOf('|');
        const subject = args.slice(0, pipeIdx).trim();
        const body = args.slice(pipeIdx + 1).trim();

        if (!subject || !body) {
          this.terminal.printError('Subject and message body cannot be blank.');
          return;
        }

        const post = this.bbs.createPost(this.callsign, subject, body);
        this.terminal.printSuccess(`Bulletin #${post.id} published to BBS board!`);

        // Broadcast to mesh
        this.mesh.broadcast({
          id: `POST-${post.id}-${Date.now()}`,
          type: 'post',
          post,
          hops: 0
        });
      }
    );

    // /read
    this.terminal.registerCommand(
      '/read',
      'Read BBS bulletins',
      '/read [post_id or page_number]',
      (args) => {
        const arg = args.trim();

        // Check if viewing single post by ID
        if (arg && !isNaN(arg) && Number(arg) >= 100) {
          const post = this.bbs.getPostById(arg);
          if (!post) {
            this.terminal.printError(`Bulletin #${arg} not found.`);
            return;
          }
          this.terminal.println('──────────────────────────────────────────────────────────────────────────', 'dim');
          this.terminal.println(`BULLETIN #${post.id}: ${post.subject}`, 'cmd-header');
          this.terminal.println(`AUTHOR : ${post.author}    DATE: ${new Date(post.timestamp).toLocaleString()}`, 'dim');
          this.terminal.println('──────────────────────────────────────────────────────────────────────────', 'dim');
          this.terminal.println(post.body);
          this.terminal.println('──────────────────────────────────────────────────────────────────────────', 'dim');
          return;
        }

        // List posts paginated
        const page = (!arg || isNaN(arg)) ? 1 : Math.max(1, parseInt(arg, 10));
        const res = this.bbs.getPosts(page, 5);

        this.terminal.println(`\nRETRO-NET BBS BULLETIN BOARD — PAGE ${res.page}/${res.totalPages} (${res.totalPosts} TOTAL POSTS)`, 'cmd-header');
        this.terminal.println('──────────────────────────────────────────────────────────────────────────', 'dim');

        if (res.posts.length === 0) {
          this.terminal.println('No bulletins on this page.', 'dim');
        } else {
          res.posts.forEach(p => {
            const dateStr = new Date(p.timestamp).toLocaleDateString();
            this.terminal.println(`[#${p.id}] ${p.subject.padEnd(40)} | By: ${p.author.padEnd(12)} (${dateStr})`);
          });
        }

        this.terminal.println('──────────────────────────────────────────────────────────────────────────', 'dim');
        this.terminal.println(`Use "/read <id>" to read full post. Use "/read ${res.page < res.totalPages ? res.page + 1 : 1}" for more pages.`, 'dim');
      }
    );

    // /msg
    this.terminal.registerCommand(
      '/msg',
      'Send private whisper to a peer',
      '/msg <callsign> <message>',
      (args, parts) => {
        if (!parts || parts.length < 2) {
          this.terminal.printError('Syntax: /msg <callsign> <message>');
          return;
        }
        const target = parts[0].toUpperCase();
        const text = args.slice(parts[0].length).trim();

        if (!text) {
          this.terminal.printError('Message text cannot be empty.');
          return;
        }

        this.terminal.println(`[WHISPER to ${target}] ${text}`, 'whisper-sent');

        this.mesh.broadcast({
          id: `W-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'whisper',
          to: target,
          author: this.callsign,
          text,
          hops: 0
        });
      }
    );

    // /dropfile
    this.terminal.registerCommand(
      '/dropfile',
      'Send a file to all connected mesh peers',
      '/dropfile',
      () => {
        const picker = document.getElementById('hidden-file-input');
        if (picker) {
          picker.click();
        }
      }
    );

    // /ansi or /theme
    this.terminal.registerCommand(
      '/ansi',
      'Cycle CRT phosphor color palette',
      '/ansi',
      () => {
        this.terminal.cycleTheme();
      }
    );
    this.terminal.registerCommand(
      '/theme',
      'Cycle CRT phosphor color palette',
      '/theme',
      () => {
        this.terminal.cycleTheme();
      }
    );

    // /sound
    this.terminal.registerCommand(
      '/sound',
      'Toggle mechanical keyboard and modem sounds',
      '/sound',
      () => {
        const enabled = retroAudio.toggle();
        this.terminal.println(`[AUDIO] Sound effects: ${enabled ? 'ENABLED [ON]' : 'MUTED [OFF]'}`, 'system');
        const soundBtn = document.getElementById('btn-sound');
        if (soundBtn) {
          soundBtn.textContent = enabled ? 'SOUND: ON' : 'SOUND: OFF';
        }
      }
    );

    // /clear
    this.terminal.registerCommand(
      '/clear',
      'Clear screen buffer',
      '/clear',
      () => {
        this.terminal.clear();
      }
    );

    // /connect
    this.terminal.registerCommand(
      '/connect',
      'Open Optical QR Handshake signaling modal',
      '/connect',
      () => {
        this.openSignalingModal();
      }
    );

    // /pair
    this.terminal.registerCommand(
      '/pair',
      'Instantly pair with another local tab via BroadcastChannel',
      '/pair',
      () => {
        this.startBroadcastChannelPairing();
      }
    );

    // /nick
    this.terminal.registerCommand(
      '/nick',
      'Change your node callsign',
      '/nick <new_callsign>',
      (args) => {
        const newNick = (args || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!newNick || newNick.length < 3 || newNick.length > 16) {
          this.terminal.printError('Callsign must be 3-16 alphanumeric characters.');
          return;
        }
        const oldNick = this.callsign;
        this.callsign = newNick;
        try {
          localStorage.setItem('bbs_callsign', newNick);
        } catch (e) {}

        this.terminal.setCallsign(newNick);
        this.mesh.setCallsign(newNick);
        this.terminal.printSuccess(`Callsign changed from ${oldNick} to ${newNick}`);
      }
    );

    // /status
    this.terminal.registerCommand(
      '/status',
      'Display node diagnostic status',
      '/status',
      () => {
        this.terminal.println('\nNODE DIAGNOSTIC STATUS:', 'cmd-header');
        const diagnostics = [
          ['NODE ID', this.nodeId],
          ['CALLSIGN', this.callsign],
          ['CONNECTED PEERS', String(this.mesh.getConnectedCount())],
          ['TOTAL BULLETINS', String(this.bbs.posts.length)],
          ['PHOSPHOR THEME', this.terminal.currentTheme.toUpperCase()],
          ['AUDIO SYNTH', retroAudio.enabled ? 'ENABLED' : 'DISABLED'],
          ['OPTICAL SCANNER', 'BarcodeDetector / jsQR fallback ready'],
          ['COMPRESSION', 'Compression Streams API (deflate)']
        ];
        this.terminal.printTable(['PROPERTY', 'VALUE'], diagnostics);
      }
    );
  }

  _bindUIControls() {
    // Top bezel quick buttons
    const btnConnect = document.getElementById('btn-connect');
    if (btnConnect) btnConnect.addEventListener('click', () => this.openSignalingModal());

    const btnPair = document.getElementById('btn-pair');
    if (btnPair) btnPair.addEventListener('click', () => this.startBroadcastChannelPairing());

    const btnTheme = document.getElementById('btn-theme');
    if (btnTheme) btnTheme.addEventListener('click', () => this.terminal.cycleTheme());

    const btnSound = document.getElementById('btn-sound');
    if (btnSound) {
      btnSound.textContent = retroAudio.enabled ? 'SOUND: ON' : 'SOUND: OFF';
      btnSound.addEventListener('click', () => {
        const en = retroAudio.toggle();
        btnSound.textContent = en ? 'SOUND: ON' : 'SOUND: OFF';
        this.terminal.println(`[AUDIO] Sound effects: ${en ? 'ENABLED [ON]' : 'MUTED [OFF]'}`, 'system');
      });
    }

    const btnHelp = document.getElementById('btn-help');
    if (btnHelp) btnHelp.addEventListener('click', () => {
      const helpCmd = this.terminal.commands.get('/help');
      if (helpCmd) helpCmd.handler();
    });

    const btnClear = document.getElementById('btn-clear');
    if (btnClear) btnClear.addEventListener('click', () => this.terminal.clear());

    // Modal close button
    const btnCloseModal = document.getElementById('btn-close-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => this.closeSignalingModal());

    // Modal mode tabs
    const tabHost = document.getElementById('tab-mode-host');
    const tabJoin = document.getElementById('tab-mode-join');
    const tabLocal = document.getElementById('tab-mode-local');
    const tabManual = document.getElementById('tab-mode-manual');

    if (tabHost) tabHost.addEventListener('click', () => this._switchSignalingTab('host'));
    if (tabJoin) tabJoin.addEventListener('click', () => this._switchSignalingTab('join'));
    if (tabLocal) tabLocal.addEventListener('click', () => this._switchSignalingTab('local'));
    if (tabManual) tabManual.addEventListener('click', () => this._switchSignalingTab('manual'));

    // Host subflow button: "Switch to Scan Answer"
    const btnHostScanAnswer = document.getElementById('btn-host-scan-answer');
    if (btnHostScanAnswer) {
      btnHostScanAnswer.addEventListener('click', () => {
        this._startScanningForAnswer();
      });
    }

    const btnLocalPair = document.getElementById('btn-run-local-pair');
    if (btnLocalPair) {
      btnLocalPair.addEventListener('click', () => {
        this.startBroadcastChannelPairing();
      });
    }

    // Manual signaling buttons
    const btnCopyOffer = document.getElementById('btn-copy-offer');
    if (btnCopyOffer) {
      btnCopyOffer.addEventListener('click', () => {
        const text = document.getElementById('manual-offer-text')?.value;
        if (text) {
          navigator.clipboard.writeText(text);
          this.terminal.printSuccess('Offer SDP copied to clipboard!');
        }
      });
    }

    const btnApplyAnswer = document.getElementById('btn-apply-answer');
    if (btnApplyAnswer) {
      btnApplyAnswer.addEventListener('click', async () => {
        const text = document.getElementById('manual-answer-text')?.value.trim();
        if (!text) return;
        await this._applyManualAnswer(text);
      });
    }

    const btnApplyOffer = document.getElementById('btn-apply-offer');
    if (btnApplyOffer) {
      btnApplyOffer.addEventListener('click', async () => {
        const text = document.getElementById('manual-join-offer-text')?.value.trim();
        if (!text) return;
        await this._applyManualOfferAndCreateAnswer(text);
      });
    }
  }

  _bindFilePicker() {
    const hiddenInput = document.getElementById('hidden-file-input');
    if (hiddenInput) {
      hiddenInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.fileManager.sendFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
  }

  // ==========================================
  // OPTICAL QR SIGNALING HANDSHAKE WORKFLOW
  // ==========================================

  openSignalingModal() {
    if (this.modal) {
      this.modal.showModal();
      this._switchSignalingTab('host');
      this.startHostOffer();
    }
  }

  closeSignalingModal() {
    this.qrPlayer.stop();
    if (this.hostScanner) this.hostScanner.stop();
    if (this.joinScanner) this.joinScanner.stop();
    if (this.modal) this.modal.close();
  }

  _switchSignalingTab(tabName) {
    const tabs = ['host', 'join', 'local', 'manual'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-mode-${t}`);
      const sec = document.getElementById(`section-${t}`);
      if (btn) btn.classList.toggle('active', t === tabName);
      if (sec) sec.classList.toggle('hidden', t !== tabName);
    });

    // Reset scanners / players
    this.qrPlayer.stop();
    if (this.hostScanner) this.hostScanner.stop();
    if (this.joinScanner) this.joinScanner.stop();

    if (tabName === 'host') {
      const hostQrSection = document.getElementById('host-qr-box');
      const hostCamSection = document.getElementById('host-cam-box');
      if (hostQrSection) hostQrSection.classList.remove('hidden');
      if (hostCamSection) hostCamSection.classList.add('hidden');
      this.startHostOffer();
    } else if (tabName === 'join') {
      this.startJoinScan();
    }
  }

  async startHostOffer() {
    this.qrPlayer.stop();
    if (this.hostScanner) this.hostScanner.stop();
    if (this.joinScanner) this.joinScanner.stop();

    const hostStatus = document.getElementById('host-status-text');
    if (hostStatus) hostStatus.textContent = 'GENERATING WEBRTC OFFER & GATHERING ICE CANDIDATES...';

    // 1. Create Peer Connection
    const peer = this.mesh.createPeer();
    const dc = peer.pc.createDataChannel('bbs-mesh', { ordered: true });
    this.mesh.setupDataChannel(peer, dc);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete so all candidates are baked into SDP
    await waitForIceGatheringComplete(peer.pc);

    const fullSdp = peer.pc.localDescription.sdp;
    const sid = Math.random().toString(16).substring(2, 6);
    this.pendingSignaling = { peer, dc, sid, role: 'host' };

    // 2. Deflate compress SDP
    const compressed = await compressString(JSON.stringify({ sdp: fullSdp, type: 'offer', callsign: this.callsign }));

    // 3. Slice into chunks
    const chunks = slicePayload('O', sid, compressed, 190);

    // 4. Start animated QR stream
    this.qrPlayer.load(chunks);

    if (hostStatus) {
      hostStatus.textContent = `BROADCASTING OFFER [${chunks.length} CHUNKS]. POINT JOINER WEBCAM AT SCREEN.`;
    }

    // Populate manual offer textarea
    const manualOfferEl = document.getElementById('manual-offer-text');
    if (manualOfferEl) {
      manualOfferEl.value = JSON.stringify({ sdp: fullSdp, type: 'offer', callsign: this.callsign });
    }
  }

  _startScanningForAnswer() {
    this.qrPlayer.stop();
    const hostQrSection = document.getElementById('host-qr-box');
    const hostCamSection = document.getElementById('host-cam-box');
    if (hostQrSection) hostQrSection.classList.add('hidden');
    if (hostCamSection) hostCamSection.classList.remove('hidden');

    this.hostScanner.start('A'); // Look for Answer chunks
    this.hostScanner.onComplete = async (payload) => {
      this.terminal.printSuccess('Optical Answer received from peer!');
      if (this.pendingSignaling && this.pendingSignaling.peer) {
        await this.pendingSignaling.peer.pc.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: payload.sdp
        }));
        this.closeSignalingModal();
      }
    };
  }

  async startJoinScan() {
    this.qrPlayer.stop();
    if (this.hostScanner) this.hostScanner.stop();
    if (this.joinScanner) this.joinScanner.stop();

    const joinQrBox = document.getElementById('join-qr-box');
    const joinCamBox = document.getElementById('join-cam-box');
    if (joinQrBox) joinQrBox.classList.add('hidden');
    if (joinCamBox) joinCamBox.classList.remove('hidden');

    this.joinScanner.start('O'); // Look for Offer chunks
    this.joinScanner.onComplete = async (payload) => {
      this.terminal.printSuccess(`Optical Offer received from ${payload.callsign || 'Host'}! Generating Answer...`);
      await this._createJoinerAnswer(payload);
    };
  }

  async _createJoinerAnswer(offerPayload) {
    const peer = this.mesh.createPeer();

    peer.pc.ondatachannel = (e) => {
      this.mesh.setupDataChannel(peer, e.channel);
    };

    await peer.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: offerPayload.sdp
    }));

    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(peer.pc);

    const fullSdp = peer.pc.localDescription.sdp;
    const sid = Math.random().toString(16).substring(2, 6);

    // Compress answer
    const compressed = await compressString(JSON.stringify({ sdp: fullSdp, type: 'answer', callsign: this.callsign }));
    const chunks = slicePayload('A', sid, compressed, 190);

    // Switch Joiner view to show Answer QR animation stream
    const joinCamBox = document.getElementById('join-cam-box');
    const joinQrBox = document.getElementById('join-qr-box');
    if (joinCamBox) joinCamBox.classList.add('hidden');
    if (joinQrBox) joinQrBox.classList.remove('hidden');

    const joinQrCanvas = document.getElementById('join-qr-canvas');
    const joinQrCounter = document.getElementById('join-qr-counter');
    const joinQrProgress = document.getElementById('join-qr-progress-bar');
    const joinPlayer = new AnimatedQrPlayer(joinQrCanvas, joinQrCounter, joinQrProgress);
    joinPlayer.load(chunks);

    // Close automatically once data channel connects
    const checkTimer = setInterval(() => {
      if (peer.dc && peer.dc.readyState === 'open') {
        clearInterval(checkTimer);
        joinPlayer.stop();
        this.closeSignalingModal();
      }
    }, 500);
  }

  // ==========================================
  // BROADCAST CHANNEL LOCAL TAB PAIRING
  // ==========================================

  _bindBroadcastChannel() {
    this.bc.onmessage = async (event) => {
      const data = event.data;
      if (!data || data.senderId === this.nodeId) return;

      // 1. Peer sends PAIR_OFFER
      if (data.type === 'PAIR_OFFER') {
        this.terminal.println(`[LOCAL PAIR] Received pairing request from local tab (${data.callsign})!`, 'info');
        const peer = this.mesh.createPeer();

        peer.pc.ondatachannel = (e) => {
          this.mesh.setupDataChannel(peer, e.channel);
        };

        await peer.pc.setRemoteDescription(new RTCSessionDescription({
          type: 'offer',
          sdp: data.sdp
        }));

        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(peer.pc);

        this.bc.postMessage({
          type: 'PAIR_ANSWER',
          senderId: this.nodeId,
          targetId: data.senderId,
          callsign: this.callsign,
          sdp: peer.pc.localDescription.sdp
        });
        return;
      }

      // 2. Peer sends PAIR_ANSWER
      if (data.type === 'PAIR_ANSWER' && data.targetId === this.nodeId) {
        if (this.pendingSignaling && this.pendingSignaling.peer) {
          await this.pendingSignaling.peer.pc.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: data.sdp
          }));
          this.terminal.printSuccess(`Local tab pairing completed with ${data.callsign}!`);
          this.closeSignalingModal();
        }
      }
    };
  }

  async startBroadcastChannelPairing() {
    this.terminal.println('[LOCAL PAIR] Broadcasting WebRTC pairing signal over BroadcastChannel...', 'info');

    const peer = this.mesh.createPeer();
    const dc = peer.pc.createDataChannel('bbs-mesh', { ordered: true });
    this.mesh.setupDataChannel(peer, dc);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(peer.pc);

    this.pendingSignaling = { peer, dc, role: 'host' };

    this.bc.postMessage({
      type: 'PAIR_OFFER',
      senderId: this.nodeId,
      callsign: this.callsign,
      sdp: peer.pc.localDescription.sdp
    });

    this.terminal.println('[LOCAL PAIR] Offer broadcast! If another tab is open, it will auto-connect in < 1 second.', 'dim');
  }

  // ==========================================
  // MANUAL CLIPBOARD SIGNALING FALLBACK
  // ==========================================

  async _applyManualAnswer(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (this.pendingSignaling && this.pendingSignaling.peer) {
        await this.pendingSignaling.peer.pc.setRemoteDescription(new RTCSessionDescription({
          type: 'answer',
          sdp: parsed.sdp || parsed
        }));
        this.terminal.printSuccess('Manual answer applied! Establishing data channel...');
        this.closeSignalingModal();
      }
    } catch (e) {
      alert(`Invalid Answer JSON: ${e.message}`);
    }
  }

  async _applyManualOfferAndCreateAnswer(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const peer = this.mesh.createPeer();

      peer.pc.ondatachannel = (e) => {
        this.mesh.setupDataChannel(peer, e.channel);
      };

      await peer.pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: parsed.sdp || parsed
      }));

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(peer.pc);

      const answerJson = JSON.stringify({
        type: 'answer',
        sdp: peer.pc.localDescription.sdp,
        callsign: this.callsign
      });

      const outEl = document.getElementById('manual-join-answer-output');
      if (outEl) {
        outEl.value = answerJson;
      }
      this.terminal.printSuccess('Answer generated! Copy the Answer text back to the host.');
    } catch (e) {
      alert(`Invalid Offer JSON: ${e.message}`);
    }
  }
}

// Start app on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.bbsApp = new App();
});
