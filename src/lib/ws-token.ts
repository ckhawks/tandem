import crypto from "node:crypto";

// HMAC-signed short-lived token granting WS access to one document.
// Avoids having to decrypt the Auth.js JWE in the standalone ws server.

const ALGO = "sha256";
const TTL_MS = 60_000; // 60s — client opens WS right after fetching token

export type WsTokenPayload = {
  uid: string;
  did: string;
  name: string;
  color: string;
  role: "owner" | "editor";
  exp: number; // ms epoch
};

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signWsToken(p: Omit<WsTokenPayload, "exp">): string {
  const payload: WsTokenPayload = { ...p, exp: Date.now() + TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(crypto.createHmac(ALGO, secret()).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyWsToken(tok: string): WsTokenPayload | null {
  const ix = tok.indexOf(".");
  if (ix < 0) return null;
  const body = tok.slice(0, ix);
  const mac = tok.slice(ix + 1);
  const expected = b64url(crypto.createHmac(ALGO, secret()).update(body).digest());
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  let payload: WsTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}
