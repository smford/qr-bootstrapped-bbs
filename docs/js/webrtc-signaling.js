/**
 * RETRO-NET BBS - Serverless Optical QR WebRTC Signaling Engine
 * Uses Compression Streams API (deflate), animated QR code chunk streams,
 * native BarcodeDetector with jsQR fallback, and BroadcastChannel local pairing.
 */

import qrcode from './vendor/qrcode.js';
import { retroAudio } from './audio.js';

// Configuration
export const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 2
};

const CHUNK_SIZE = 190; // Optimal payload per QR frame for high-speed scanning
const ANIMATION_INTERVAL = 300; // ms per QR frame

/**
 * Base64URL encoding / decoding utilities
 */
export function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Native Compression Streams API (deflate)
 */
export async function compressString(text) {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(text);

  if ('CompressionStream' in window) {
    try {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(inputBytes);
      writer.close();

      const chunks = [];
      const reader = cs.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks
      let totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      let combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return toBase64Url(combined);
    } catch (e) {
      console.warn('CompressionStream failed, using raw base64:', e);
    }
  }
  return toBase64Url(inputBytes);
}

/**
 * Native Decompression Streams API (deflate)
 */
export async function decompressString(base64url) {
  const bytes = fromBase64Url(base64url);

  if ('DecompressionStream' in window) {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();

      const chunks = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      let totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      let combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder().decode(combined);
    } catch (e) {
      console.warn('DecompressionStream failed, fallback to TextDecoder:', e);
    }
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Slice payload into BBS QR chunks:
 * Protocol: BBS:v1:<type>:<sid>:<index>:<total>:<data>
 */
export function slicePayload(type, sid, payloadString, chunkSize = CHUNK_SIZE) {
  const rawChunks = [];
  for (let i = 0; i < payloadString.length; i += chunkSize) {
    rawChunks.push(payloadString.slice(i, i + chunkSize));
  }
  const total = rawChunks.length;
  return rawChunks.map((chunk, idx) => `BBS:v1:${type}:${sid}:${idx + 1}:${total}:${chunk}`);
}

/**
 * Parse a scanned chunk string
 */
export function parseChunk(chunkStr) {
  if (!chunkStr || !chunkStr.startsWith('BBS:v1:')) return null;
  const parts = chunkStr.split(':');
  if (parts.length < 7) return null;

  const [_, __, type, sid, idxStr, totalStr, ...dataParts] = parts;
  const index = parseInt(idxStr, 10);
  const total = parseInt(totalStr, 10);
  const data = dataParts.join(':');

  if (isNaN(index) || isNaN(total) || !data) return null;
  return { type, sid, index, total, data };
}

/**
 * Wait for WebRTC ICE gathering to complete so the SDP contains all candidates
 */
export function waitForIceGatheringComplete(pc, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      pc.removeEventListener('icecandidate', onCandidate);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      clearTimeout(timer);
      resolve();
    };

    const onCandidate = (e) => {
      if (e.candidate === null) cleanup();
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') cleanup();
    };

    pc.addEventListener('icecandidate', onCandidate);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    const timer = setTimeout(cleanup, timeoutMs);
  });
}

/**
 * Render QR Code onto a canvas
 */
export function renderQrCode(canvas, text, cellSize = 5, margin = 3) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const size = (count + margin * 2) * cellSize;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // High contrast crisp rendering for optical scanning
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
  } catch (err) {
    console.error('Failed to render QR Code:', err);
  }
}

/**
 * Animated QR Code Stream Player
 */
export class AnimatedQrPlayer {
  constructor(canvasElement, counterElement, progressElement) {
    this.canvas = canvasElement;
    this.counterEl = counterElement;
    this.progressEl = progressElement;
    this.chunks = [];
    this.currentIndex = 0;
    this.timer = null;
    this.interval = ANIMATION_INTERVAL;
    this.isPlaying = false;
  }

  load(chunks) {
    this.stop();
    this.chunks = chunks || [];
    this.currentIndex = 0;
    if (this.chunks.length > 0) {
      this.renderCurrent();
      if (this.chunks.length > 1) {
        this.play();
      }
    }
  }

  play() {
    if (this.isPlaying || this.chunks.length <= 1) return;
    this.isPlaying = true;
    this.timer = setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.chunks.length;
      this.renderCurrent();
    }, this.interval);
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  renderCurrent() {
    if (this.chunks.length === 0) return;
    const chunk = this.chunks[this.currentIndex];
    renderQrCode(this.canvas, chunk);

    const currentNum = this.currentIndex + 1;
    const totalNum = this.chunks.length;

    if (this.counterEl) {
      this.counterEl.textContent = `[${currentNum}/${totalNum}]`;
    }
    if (this.progressEl) {
      const pct = Math.round((currentNum / totalNum) * 100);
      this.progressEl.style.width = `${pct}%`;
    }
  }

  setSpeed(ms) {
    this.interval = ms;
    if (this.isPlaying) {
      this.stop();
      this.play();
    }
  }
}

/**
 * Optical Webcam Scanner with BarcodeDetector and jsQR fallback
 */
export class OpticalScanner {
  constructor(videoElement, canvasElement, hudElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.hud = hudElement;
    this.stream = null;
    this.active = false;
    this.detector = null;

    this.expectedType = null; // 'O' or 'A'
    this.targetSid = null;
    this.receivedChunks = new Map();
    this.totalExpected = 0;

    this.onProgress = null; // (receivedCount, totalCount)
    this.onComplete = null; // (decompressedSdp)
    this.onError = null;

    this._initDetector();
  }

  async _initDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch (e) {
        this.detector = null;
      }
    }
  }

  async start(expectedType = null) {
    this.stop();
    this.expectedType = expectedType;
    this.targetSid = null;
    this.receivedChunks.clear();
    this.totalExpected = 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.active = true;
      this._scanLoop();
      if (this.hud) this.hud.textContent = 'CAMERA ACTIVE: POINT AT PEER QR CODE...';
    } catch (err) {
      const msg = `Camera access error: ${err.name || err.message}`;
      if (this.hud) this.hud.textContent = msg;
      if (this.onError) this.onError(new Error(msg));
    }
  }

  stop() {
    this.active = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  async _scanLoop() {
    if (!this.active) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      let rawValues = [];

      // Method 1: Native BarcodeDetector
      if (this.detector) {
        try {
          const barcodes = await this.detector.detect(this.video);
          for (const b of barcodes) {
            if (b.rawValue) rawValues.push(b.rawValue);
          }
        } catch (e) {}
      }

      // Method 2: jsQR fallback
      if (rawValues.length === 0 && window.jsQR && this.canvas) {
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.canvas.width = this.video.videoWidth || 640;
        this.canvas.height = this.video.videoHeight || 480;
        ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        const imgData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const code = window.jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
          rawValues.push(code.data);
        }
      }

      // Process detected values
      for (const val of rawValues) {
        this._handleScannedString(val);
      }
    }

    if (this.active) {
      requestAnimationFrame(() => this._scanLoop());
    }
  }

  _handleScannedString(rawString) {
    const chunk = parseChunk(rawString);
    if (!chunk) return;

    // Filter by type if expected
    if (this.expectedType && chunk.type !== this.expectedType) {
      return;
    }

    // Lock session ID
    if (!this.targetSid) {
      this.targetSid = chunk.sid;
      this.totalExpected = chunk.total;
    } else if (chunk.sid !== this.targetSid) {
      // Chunk from different session, ignore
      return;
    }

    // Record chunk
    const isNew = !this.receivedChunks.has(chunk.index);
    if (isNew) {
      this.receivedChunks.set(chunk.index, chunk.data);
      retroAudio.playBlip();

      const count = this.receivedChunks.size;
      const total = this.totalExpected;

      if (this.hud) {
        this.hud.textContent = `CAPTURING CHUNKS: [${count}/${total}] gathered (${Math.round((count / total) * 100)}%)`;
      }
      if (this.onProgress) {
        this.onProgress(count, total, this.receivedChunks);
      }

      // Check if all chunks gathered
      if (count === total) {
        this._assembleAndComplete();
      }
    }
  }

  async _assembleAndComplete() {
    this.stop();
    let reassembled = '';
    for (let i = 1; i <= this.totalExpected; i++) {
      reassembled += this.receivedChunks.get(i) || '';
    }

    try {
      const decompressedJson = await decompressString(reassembled);
      const parsed = JSON.parse(decompressedJson);
      if (this.hud) this.hud.textContent = 'OPTICAL HANDSHAKE PAYLOAD ASSEMBLED!';
      if (this.onComplete) {
        this.onComplete(parsed);
      }
    } catch (err) {
      if (this.hud) this.hud.textContent = `DECODE ERROR: ${err.message}`;
      if (this.onError) this.onError(err);
    }
  }
}
