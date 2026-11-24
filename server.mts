// Prototype server: Next.js pages + a tiny WebSocket relay in one process.
// - HTTP  on PORT (3000):        for the laptop (http://localhost:3000) or a tunnel.
// - HTTPS on HTTPS_PORT (3443):  for phones on the same Wi-Fi (https://<LAN IP>:3443), only if
//   certs/ exists (run `bun run cert`). Phones need HTTPS for motion sensors and camera.
//   This port is a plain TLS pass-through into the HTTP port: Next's dev hot-reload socket
//   hangs when handed a TLS socket directly, and without it the page never hydrates.
// Run with `bun dev` (Node runs this .mts file directly).
// Why `ws` and not Socket.IO: we only need rooms + broadcast, which is ~40 lines here;
// Socket.IO would add a protocol layer, a client library and polling fallbacks we don't use.
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { createServer as createTlsServer } from "node:tls";
import next from "next";
import { WebSocketServer } from "ws";
import { lanIps } from "./src/lib/lan.ts";
import { type JoinMsg, type Msg, makeMsg } from "./src/lib/relay/protocol.ts";
import { type Peer, Rooms } from "./src/lib/relay/rooms.ts";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const httpsPort = Number.parseInt(process.env.HTTPS_PORT || "3443", 10);
const CERT = "certs/lan-cert.pem";
const KEY = "certs/lan-key.pem";
const hasCert = existsSync(CERT) && existsSync(KEY);
const phoneUrls = hasCert
  ? lanIps().map((ip) => `https://${ip}:${httpsPort}`)
  : [];
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, port });
const handle = app.getRequestHandler();
await app.prepare();
const nextUpgrade = app.getUpgradeHandler();

const rooms = new Rooms();
const wss = new WebSocketServer({ noServer: true });

function onRequest(req: IncomingMessage, res: ServerResponse) {
  // The pairing QR asks where phones can reach us (the laptop itself may be on localhost).
  if (req.url === "/__lan") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ phoneUrls }));
  }
  handle(req, res);
}

function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (req.url?.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else {
    nextUpgrade(req, socket, head); // Next's own dev socket (hot reload)
  }
}

const server = createServer(onRequest);
server.on("upgrade", onUpgrade);

wss.on("connection", (ws) => {
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  // A phone that goes to sleep often never sends a TCP close. Ping every 5 s and drop
  // sockets that miss one, so the screen learns quickly that the phone is gone.
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 5000);

  const peer: Peer = {
    send: (text) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    kick: (reason) => {
      peer.send(
        JSON.stringify(
          makeMsg("error", "", {
            code: reason,
            message: "HP lain bergabung ke ruang ini.",
          }),
        ),
      );
      ws.close(4000, reason);
    },
  };

  ws.on("message", (data) => {
    const text = data.toString();
    let msg: Msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return peer.send(
        JSON.stringify(
          makeMsg("error", "", { code: "bad-message", message: "Bukan JSON" }),
        ),
      );
    }
    if (msg.type === "join") {
      const { role, roomId } = (msg as JoinMsg).payload;
      const res = rooms.join(peer, role, roomId);
      if (res.ok)
        peer.send(
          JSON.stringify(
            makeMsg("joined", res.roomId, { role, roomId: res.roomId }),
          ),
        );
      else
        peer.send(
          JSON.stringify(
            makeMsg("error", "", { code: res.code, message: res.message }),
          ),
        );
      return;
    }
    rooms.relay(peer, text);
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    rooms.leave(peer);
  });
});

server.listen(port, () => {
  console.log(
    `> Rehat prototype on http://localhost:${port} (${dev ? "dev" : "production"})`,
  );
});

if (hasCert) {
  // Decrypt, then pipe the raw bytes into our own HTTP port. Requests and WebSockets (relay and
  // Next's HMR) behave exactly as on plain HTTP; the Host/Origin headers keep the LAN address.
  const secure = createTlsServer(
    { cert: readFileSync(CERT), key: readFileSync(KEY) },
    (tls) => {
      const plain = connect(port, "127.0.0.1");
      tls.pipe(plain).pipe(tls);
      tls.on("error", () => plain.destroy());
      plain.on("error", () => tls.destroy());
    },
  );
  secure.listen(httpsPort, () => {
    for (const url of phoneUrls) console.log(`> Phones (same Wi-Fi): ${url}`);
  });
} else {
  console.log(
    "> No certs/ found: run `bun run cert` to serve HTTPS for phones on the LAN.",
  );
}
