# Serverless WebRTC QR-Bootstrapped Terminal BBS

> An air-gapped, zero-backend, retro-styled Bulletin Board System (BBS) and peer-to-peer file-drop establishing encrypted mesh networks between browsers using purely optical QR code handshakes.

**Live Site:** [https://stephenford.org/qr-bootstrapped-bbs/](https://stephenford.org/qr-bootstrapped-bbs/)

---

## Concept

Modern WebRTC applications depend on centralized cloud infrastructure (signaling servers, WebSockets, Firebase, or STUN/TURN relays) just to exchange the initial SDP (Session Description Protocol) offers and answers. 

**RETRO-NET BBS** eliminates cloud signaling entirely. Window A creates an `RTCPeerConnection`, compresses its full SDP offer with ICE candidates into a tight binary payload using the native browser **Compression Streams API** (`deflate`), and streams it as an animated sequence of high-density QR codes cycling on-screen at ~300ms per frame. Window B uses its webcam and the native **BarcodeDetector API** (with a client-side JS fallback) to capture, reassemble, and decompress the offer in memory, generating an SDP answer stream for Window A to scan.

Once the `RTCDataChannel` connection opens, optical signaling shuts down and chat, bulletin boards, whispers, and binary file drops propagate directly peer-to-peer over an air-gapped mesh network.

---

## Why It's Quirky

1. **True Air-Gapped Optical Handshakes:** Replaces cloud signaling servers with raw light photons passing between laptop screens and webcams.
2. **Zero-Dependency Native Browser APIs:**
   - **WebRTC DataChannels** for encrypted peer-to-peer messaging and file streaming.
   - **Compression Streams API** (`CompressionStream("deflate")` & `DecompressionStream("deflate")`) to shrink SDP payloads by over 65%.
   - **BarcodeDetector API** for hardware-accelerated QR decoding directly on video frames.
   - **Streams & Blob APIs** for memory-efficient binary file slice reassembly.
   - **Web Audio API** for synthesized mechanical keyboard switch thuds, terminal bell chimes, and authentic 1200/2400 baud modem handshake squeals.
3. **VT100 CRT Aesthetic:** Authentic curved CRT scanlines, phosphor glow, subtle flicker, blinking block cursor, command history, and dynamic phosphor palette switching (P1 Green, Amber CRT, Cyberpunk Cyan, Paper White).
4. **Multi-Peer Mesh Relay & Gossip:** Connected nodes chain together, automatically relaying public chat, BBS posts, and whispers across the mesh up to 5 hops with automatic loop prevention and deduplication.

---

## BBS Commands

| Command | Syntax | Description |
|---|---|---|
| `/help` | `/help` | Displays complete command index and keyboard shortcuts |
| `/who` | `/who` | Lists all connected mesh peers, ICE types (host/srflx), and RTT latency |
| `/connect` | `/connect` | Launches the Optical QR Handshake modal (Host offer / Joiner camera scan) |
| `/pair` | `/pair` | **Instant 1-click test pairing** across two local tabs via `BroadcastChannel` |
| `/post` | `/post <subject> \| <message>` | Publishes a bulletin to the public BBS board and broadcasts to the mesh |
| `/read` | `/read [id or page]` | Browses paginated bulletin board posts or reads a single bulletin by ID |
| `/msg` | `/msg <callsign> <message>` | Sends a private P2P whisper across the mesh directly to a target peer |
| `/dropfile` | `/dropfile` | Slices any file into 16KB binary chunks, streams over RTCDataChannel, and renders an ASCII download link |
| `/ansi` | `/ansi` (or `/theme`) | Cycles phosphor colors: P1 Green, Amber, Cyberpunk Cyan, Paper White |
| `/sound` | `/sound` | Toggles mechanical keyboard click synthesis and dial-up modem audio |
| `/nick` | `/nick <callsign>` | Customizes your node callsign (e.g. `PHREAK-99`) |
| `/status` | `/status` | Displays node diagnostics, active DataChannels, and memory counters |
| `/clear` | `/clear` | Clears the terminal screen buffer and reprints the ASCII splash banner |

> **Pro-Tip:** Drag-and-drop any file directly onto the CRT terminal monitor to trigger instant 16KB binary chunk streaming to all connected peers!

---

## Testing Options

### 1. Optical Handshake (Two Devices with Webcams)
1. Open the app on Device A and Device B.
2. Device A: Click **[OPTICAL CONNECT]** &rarr; select **Host (Generate Offer)**. Device A displays an animated QR stream.
3. Device B: Click **[OPTICAL CONNECT]** &rarr; select **Join (Scan Offer)**. Point Device B's camera at Device A's screen.
4. Device B captures the chunks and automatically displays an **Answer QR stream**.
5. Device A: Click **[SWITCH TO SCAN JOINER'S ANSWER QR]** and point Device A's camera at Device B's screen.
6. The `RTCDataChannel` connects! Optical modal closes automatically with an authentic modem handshake squeal.

### 2. Dual-Tab BroadcastChannel Auto-Pairing (Single Computer / Quick Test)
To test peer-to-peer functionality without pointing cameras at screens:
1. Open [https://stephenford.org/qr-bootstrapped-bbs/](https://stephenford.org/qr-bootstrapped-bbs/) in Tab 1.
2. Open the same link in Tab 2 side-by-side.
3. Click **[PAIR TAB]** on either tab (or type `/pair`).
4. Both tabs negotiate WebRTC DataChannels over a local `BroadcastChannel` in under 1 second.
5. You can now chat, post bulletins, whisper, and drop files between the two tabs!

### 3. Manual Clipboard Fallback
If cameras are unavailable or restricted by permissions:
1. Open **[OPTICAL CONNECT]** &rarr; **Manual / Clipboard**.
2. Copy Offer SDP from Host &rarr; Paste into Joiner &rarr; Generate Answer &rarr; Copy Answer back to Host.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   RETRO-NET BBS                        │
│                                                        │
│  ┌───────────────────────┐    ┌─────────────────────┐  │
│  │   VT100 CRT Terminal  │    │  Web Audio Engine   │  │
│  │  - Scanlines & Glow   │    │  - Keyboard Clicks  │  │
│  │  - History & Autocmpl │    │  - Dial-up Modem    │  │
│  │  - Phosphor Themes    │    │  - Bell Chimes      │  │
│  └───────────┬───────────┘    └──────────┬──────────┘  │
│              │                           │             │
│  ┌───────────┴───────────────────────────┴──────────┐  │
│  │                App Orchestrator                  │  │
│  └───────┬───────────────────────────────┬──────────┘  │
│          │                               │             │
│  ┌───────┴───────────────┐     ┌─────────┴──────────┐  │
│  │ Optical QR Signaling  │     │   P2P Mesh Relay   │  │
│  │ - Deflate Compression │     │ - RTCDataChannels  │  │
│  │ - Animated QR Stream  │     │ - Multi-Hop Flood  │  │
│  │ - BarcodeDetector     │     │ - Ping / Latency   │  │
│  │ - BroadcastChannel    │     │ - 16KB File Drops  │  │
│  └───────────────────────┘     └────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- **Compression Streams API:** Native streaming deflate reduces typical SDP offers (~1800 bytes) to ~650 bytes.
- **Slicing Protocol:** Payloads are framed as `BBS:v1:<type>:<sid>:<index>:<total>:<data>` with ~190 characters per frame, ensuring fast camera capture without dense module blur.
- **Mesh Flooding:** Packets carry a TTL hop counter (`hops < 5`) and unique message IDs. Nodes cache seen message IDs to avoid loops and broadcast to neighboring peers.
- **File Transfer:** Binary files are read into `ArrayBuffer`, sliced into 16KB chunks, encoded as Base64 packets, and reassembled on the receiver into a native `Blob` URL for instant download.

---

## Local Development

Serve the repository with any static file server:

```bash
# Clone the repository
git clone https://github.com/stephenford/qr-bootstrapped-bbs.git
cd qr-bootstrapped-bbs

# Run with Python 3
python3 -m http.server 8080 --directory docs

# Or run with Node.js npx
npx serve docs
```

Open `http://localhost:8080` in your browser.

---

## License

MIT
