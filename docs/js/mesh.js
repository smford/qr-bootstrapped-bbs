/**
 * RETRO-NET BBS - WebRTC P2P Mesh Network & Multi-Peer Relay Engine
 * Handles DataChannels, mesh flooding relay with deduplication, and RTT latency pings.
 */

import { retroAudio } from './audio.js';
import { ICE_CONFIG } from './webrtc-signaling.js';

export class MeshNetwork {
  constructor(nodeId, callsign) {
    this.nodeId = nodeId;
    this.callsign = callsign;
    this.peers = new Map(); // peerId -> { id, pc, dc, callsign, candidateType, latency, state }
    this.seenMessageIds = new Set();
    this.maxSeenCache = 1000;

    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onChatMessage = null;
    this.onPostMessage = null;
    this.onWhisperMessage = null;
    this.onFilePacket = null;
    this.onPeerListChange = null;

    this.pingInterval = null;
    this._startPingLoop();
  }

  setCallsign(newCallsign) {
    this.callsign = newCallsign;
    this.broadcast({
      type: 'hello',
      nodeId: this.nodeId,
      callsign: this.callsign
    });
  }

  _startPingLoop() {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [peerId, peer] of this.peers.entries()) {
        if (peer.dc && peer.dc.readyState === 'open') {
          peer.lastPingTs = now;
          this.sendPacket(peer.dc, {
            type: 'ping',
            pingId: `${this.nodeId}-${now}`,
            ts: now
          });
        }
      }
    }, 6000);
  }

  createPeer(peerId = null) {
    const id = peerId || `PEER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const pc = new RTCPeerConnection(ICE_CONFIG);

    const peerInfo = {
      id,
      pc,
      dc: null,
      callsign: 'UNKNOWN',
      candidateType: 'unknown',
      latency: null,
      state: 'connecting',
      connectedAt: null
    };

    // Track ICE candidate types (host vs srflx/relay)
    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate && e.candidate.type) {
        if (peerInfo.candidateType === 'unknown' || e.candidate.type === 'srflx') {
          peerInfo.candidateType = e.candidate.type;
        }
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      peerInfo.state = pc.connectionState;
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._removePeer(id);
      }
    });

    this.peers.set(id, peerInfo);
    return peerInfo;
  }

  setupDataChannel(peerInfo, dc) {
    peerInfo.dc = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      peerInfo.state = 'connected';
      peerInfo.connectedAt = Date.now();

      // Exchange identity
      this.sendPacket(dc, {
        type: 'hello',
        nodeId: this.nodeId,
        callsign: this.callsign
      });

      retroAudio.playModemConnect();

      if (this.onPeerConnected) {
        this.onPeerConnected(peerInfo);
      }
      if (this.onPeerListChange) {
        this.onPeerListChange(this.getPeerList());
      }
    };

    dc.onclose = () => {
      this._removePeer(peerInfo.id);
    };

    dc.onerror = (err) => {
      console.warn(`DataChannel error with peer ${peerInfo.id}:`, err);
    };

    dc.onmessage = (event) => {
      this._handleIncomingData(peerInfo, event.data);
    };
  }

  _removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;

    try {
      if (peer.dc) peer.dc.close();
      if (peer.pc) peer.pc.close();
    } catch (e) {}

    this.peers.delete(id);

    if (this.onPeerDisconnected) {
      this.onPeerDisconnected(peer);
    }
    if (this.onPeerListChange) {
      this.onPeerListChange(this.getPeerList());
    }
  }

  sendPacket(dc, packet) {
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(JSON.stringify(packet));
        return true;
      } catch (err) {
        console.error('Failed to send packet over DataChannel:', err);
      }
    }
    return false;
  }

  broadcast(packet, excludePeerId = null) {
    let sentCount = 0;
    const json = JSON.stringify(packet);
    for (const [id, peer] of this.peers.entries()) {
      if (id !== excludePeerId && peer.dc && peer.dc.readyState === 'open') {
        try {
          peer.dc.send(json);
          sentCount++;
        } catch (e) {}
      }
    }
    return sentCount;
  }

  _markSeen(msgId) {
    if (!msgId) return false;
    if (this.seenMessageIds.has(msgId)) return true;
    this.seenMessageIds.add(msgId);
    if (this.seenMessageIds.size > this.maxSeenCache) {
      const first = this.seenMessageIds.values().next().value;
      this.seenMessageIds.delete(first);
    }
    return false;
  }

  _handleIncomingData(peer, data) {
    if (typeof data !== 'string') {
      // Binary data handling if needed
      return;
    }

    let packet;
    try {
      packet = JSON.parse(data);
    } catch (e) {
      return;
    }

    if (!packet || !packet.type) return;

    // 1. Keepalive & Latency Ping/Pong
    if (packet.type === 'ping') {
      this.sendPacket(peer.dc, {
        type: 'pong',
        pingId: packet.pingId,
        ts: packet.ts
      });
      return;
    }

    if (packet.type === 'pong') {
      if (packet.ts) {
        peer.latency = Math.max(1, Date.now() - packet.ts);
      }
      return;
    }

    // 2. Identity Hello
    if (packet.type === 'hello') {
      if (packet.callsign) {
        peer.callsign = packet.callsign;
      }
      if (this.onPeerListChange) {
        this.onPeerListChange(this.getPeerList());
      }
      return;
    }

    // Deduplication check for routed/flooded messages
    if (packet.id && this._markSeen(packet.id)) {
      return; // Already processed
    }

    // 3. Public Chat Message
    if (packet.type === 'chat') {
      if (this.onChatMessage) {
        this.onChatMessage(packet);
      }
      // Mesh Relay Flooding: forward to other peers
      if ((packet.hops || 0) < 5) {
        this.broadcast({ ...packet, hops: (packet.hops || 0) + 1 }, peer.id);
      }
      return;
    }

    // 4. Bulletin Board Post
    if (packet.type === 'post') {
      if (this.onPostMessage) {
        this.onPostMessage(packet);
      }
      if ((packet.hops || 0) < 5) {
        this.broadcast({ ...packet, hops: (packet.hops || 0) + 1 }, peer.id);
      }
      return;
    }

    // 5. Private Whisper
    if (packet.type === 'whisper') {
      const target = (packet.to || '').toUpperCase();
      const me = this.callsign.toUpperCase();

      if (target === me) {
        if (this.onWhisperMessage) {
          this.onWhisperMessage(packet);
        }
      } else if ((packet.hops || 0) < 5) {
        // Multi-hop relay forwarding
        this.broadcast({ ...packet, hops: (packet.hops || 0) + 1 }, peer.id);
      }
      return;
    }

    // 6. File Transfer Packets
    if (packet.type.startsWith('file_')) {
      if (this.onFilePacket) {
        this.onFilePacket(packet, peer);
      }
      return;
    }
  }

  getPeerList() {
    return Array.from(this.peers.values()).map(p => ({
      id: p.id,
      callsign: p.callsign || 'UNKNOWN',
      candidateType: p.candidateType || 'host',
      latency: p.latency !== null ? `${p.latency}ms` : 'pending',
      state: p.dc && p.dc.readyState === 'open' ? 'ONLINE' : p.state
    }));
  }

  getConnectedCount() {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.dc && peer.dc.readyState === 'open') count++;
    }
    return count;
  }
}
