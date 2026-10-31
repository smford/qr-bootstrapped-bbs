/**
 * RETRO-NET BBS - Message Board and File Drop Engine
 * Manages public bulletin posts, pagination, 16KB chunk file slicing,
 * ASCII progress bars, and Blob/Streams API reassembly.
 */

import { retroAudio } from './audio.js';

export const INITIAL_POSTS = [
  {
    id: 101,
    author: 'SYSOP-ALPHA',
    subject: 'WELCOME TO RETRO-NET BBS (AIR-GAPPED NODE)',
    body: 'Greetings operator! You have entered an air-gapped serverless terminal BBS.\n' +
          'All communication runs purely peer-to-peer over WebRTC data channels.\n' +
          'No central servers, no databases, no tracking. Type /help to see available commands.',
    timestamp: Date.now() - 3600000 * 4
  },
  {
    id: 102,
    author: 'NET-WIZARD',
    subject: 'OPTICAL SIGNALING PROTOCOL v2.4 SPEC',
    body: 'Signaling is achieved without Internet infrastructure using dynamic optical QR codes.\n' +
          'SDP offers and answers are compressed via CompressionStream("deflate") and animated at ~300ms/frame.\n' +
          'To link a node, type /connect or click [OPTICAL CONNECT] on the control bezel.',
    timestamp: Date.now() - 3600000 * 2
  },
  {
    id: 103,
    author: 'PHREAK-01',
    subject: 'HIGH-SPEED FILE DROP ACTIVE',
    body: 'You can drag and drop any file directly onto this CRT terminal screen, or use /dropfile!\n' +
          'Files are sliced into 16KB chunks and streamed over encrypted WebRTC DataChannels.\n' +
          'Try dropping an image, audio file, or text document.',
    timestamp: Date.now() - 1800000
  }
];

export class BBSBoard {
  constructor() {
    this.posts = [];
    this._loadInitial();
  }

  _loadInitial() {
    try {
      const stored = localStorage.getItem('bbs_posts');
      if (stored) {
        this.posts = JSON.parse(stored);
      } else {
        this.posts = [...INITIAL_POSTS];
      }
    } catch (e) {
      this.posts = [...INITIAL_POSTS];
    }
  }

  _save() {
    try {
      localStorage.setItem('bbs_posts', JSON.stringify(this.posts));
    } catch (e) {}
  }

  createPost(author, subject, body) {
    const nextId = this.posts.reduce((max, p) => Math.max(max, p.id || 0), 100) + 1;
    const post = {
      id: nextId,
      author: author || 'ANONYMOUS',
      subject: (subject || 'NO SUBJECT').trim().toUpperCase(),
      body: (body || '').trim(),
      timestamp: Date.now()
    };
    this.posts.unshift(post);
    this._save();
    return post;
  }

  mergePost(post) {
    if (!post || !post.id) return false;
    const exists = this.posts.some(p => p.id === post.id);
    if (!exists) {
      this.posts.unshift(post);
      // Sort descending by id
      this.posts.sort((a, b) => b.id - a.id);
      this._save();
      return true;
    }
    return false;
  }

  getPosts(page = 1, pageSize = 5) {
    const total = this.posts.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(totalPages, Math.max(1, page));
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return {
      posts: this.posts.slice(start, end),
      page: currentPage,
      totalPages,
      totalPosts: total
    };
  }

  getPostById(id) {
    return this.posts.find(p => p.id === Number(id));
  }
}

const FILE_CHUNK_SIZE = 16384; // 16KB per chunk

export class FileTransferManager {
  constructor(mesh, terminal) {
    this.mesh = mesh;
    this.terminal = terminal;
    this.incomingTransfers = new Map(); // fileId -> { name, size, mime, totalChunks, chunks, author }
  }

  async sendFile(file) {
    if (!file) return;
    if (this.mesh.getConnectedCount() === 0) {
      this.terminal.printError('Cannot send file: No peers connected to the mesh! Link peers with /connect or /pair first.');
      return;
    }

    const fileId = `F-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const totalChunks = Math.ceil(bytes.byteLength / FILE_CHUNK_SIZE);

    this.terminal.println(`\n[TRANSFER] Outbound file: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
    this.terminal.printProgressBar(fileId, 'SENDING', 0, `0/${totalChunks} chunks`);

    // 1. Announce file
    this.mesh.broadcast({
      type: 'file_start',
      fileId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      totalChunks,
      author: this.mesh.callsign
    });

    // 2. Stream chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * FILE_CHUNK_SIZE;
      const end = Math.min(start + FILE_CHUNK_SIZE, bytes.byteLength);
      const slice = bytes.subarray(start, end);

      // Convert slice to binary string for btoa
      let binary = '';
      for (let j = 0; j < slice.length; j++) {
        binary += String.fromCharCode(slice[j]);
      }
      const base64Data = btoa(binary);

      this.mesh.broadcast({
        type: 'file_chunk',
        fileId,
        index: i,
        data: base64Data
      });

      const pct = Math.round(((i + 1) / totalChunks) * 100);
      this.terminal.printProgressBar(fileId, 'SENDING', pct, `${i + 1}/${totalChunks} chunks`);

      // Gentle pause to avoid buffer saturation
      if (i % 4 === 0) {
        await new Promise(r => setTimeout(r, 12));
      }
    }

    // 3. Complete
    this.mesh.broadcast({
      type: 'file_end',
      fileId
    });

    this.terminal.printSuccess(`File "${file.name}" successfully transmitted to all connected peers!`);
    retroAudio.playBell(900);
  }

  handlePacket(packet, peer) {
    if (packet.type === 'file_start') {
      this.incomingTransfers.set(packet.fileId, {
        fileId: packet.fileId,
        name: packet.name,
        size: packet.size,
        mime: packet.mime,
        totalChunks: packet.totalChunks,
        author: packet.author,
        chunks: new Array(packet.totalChunks)
      });

      this.terminal.println(`\n[TRANSFER] Incoming file from ${packet.author}: "${packet.name}" (${(packet.size / 1024).toFixed(1)} KB)`);
      this.terminal.printProgressBar(packet.fileId, 'RECEIVING', 0, `0/${packet.totalChunks} chunks`);
      retroAudio.playBlip();
      return;
    }

    if (packet.type === 'file_chunk') {
      const transfer = this.incomingTransfers.get(packet.fileId);
      if (!transfer) return;

      transfer.chunks[packet.index] = packet.data;
      const receivedCount = transfer.chunks.filter(Boolean).length;
      const pct = Math.round((receivedCount / transfer.totalChunks) * 100);

      this.terminal.printProgressBar(packet.fileId, 'RECEIVING', pct, `${receivedCount}/${transfer.totalChunks} chunks`);
      return;
    }

    if (packet.type === 'file_end') {
      const transfer = this.incomingTransfers.get(packet.fileId);
      if (!transfer) return;

      this._assembleFile(transfer);
      this.incomingTransfers.delete(packet.fileId);
      return;
    }
  }

  _assembleFile(transfer) {
    try {
      const byteArrays = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        const b64 = transfer.chunks[i] || '';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) {
          bytes[j] = binary.charCodeAt(j);
        }
        byteArrays.push(bytes);
      }

      const blob = new Blob(byteArrays, { type: transfer.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      this.terminal.printSuccess(`Download ready: "${transfer.name}" (${(transfer.size / 1024).toFixed(1)} KB)`);
      this.terminal.printHtml(
        `[DOWNLOAD] &rArr; <a href="${url}" download="${transfer.name}" class="download-link" target="_blank">CLICK HERE TO SAVE FILE: ${transfer.name}</a>`,
        'success'
      );

      retroAudio.playBell(1050);
    } catch (err) {
      this.terminal.printError(`Failed to reassemble file "${transfer.name}": ${err.message}`);
    }
  }
}
