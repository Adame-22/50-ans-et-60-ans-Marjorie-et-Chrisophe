/*
 * Outils partagés par les fonctions /api (Vercel Functions, Node).
 * Les fichiers préfixés par « _ » ne sont pas exposés comme routes.
 *
 * Stockage, par ordre de priorité :
 *   1. Postgres / Supabase (POSTGRES_URL, ajoutée par l'intégration Supabase de Vercel) — voir _pg.js
 *   2. Redis / Upstash (KV_REST_API_URL + KV_REST_API_TOKEN)
 *   3. En local uniquement : un fichier JSON de secours.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const SEED = require("./_seed");
const PG = require("./_pg");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const K = {
  users: "mc:users",
  rsvps: "mc:rsvps",
  seating: "mc:seating",
  secret: "mc:secret",
  fail: (u) => "mc:fail:" + u,
};

/* ───────── Stockage ───────── */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function redis(command) {
  if (PG.enabled) return PG.pgCommand(command);
  if (REDIS_URL && REDIS_TOKEN) {
    const r = await fetch(REDIS_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error("Redis : " + (data.error || r.status));
    return data.result;
  }
  if (process.env.VERCEL) {
    throw new HttpError(503, "Base de données non connectée. Reliez Supabase au projet Vercel puis redéployez.");
  }
  return localRedis(command);
}

// Base de secours pour le développement local uniquement.
const LOCAL_DB = process.env.MC_LOCAL_DB || path.join(require("os").tmpdir(), "mc5060-db.json");
function localRedis([cmd, key, ...args]) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(LOCAL_DB, "utf8")); } catch (e) { /* vide */ }
  const save = () => fs.writeFileSync(LOCAL_DB, JSON.stringify(db));
  const h = () => (db[key] = db[key] && typeof db[key] === "object" ? db[key] : {});
  switch (cmd) {
    case "GET": return db[key] === undefined ? null : db[key];
    case "SET": db[key] = args[0]; save(); return "OK";
    case "SETNX": if (db[key] !== undefined) return 0; db[key] = args[0]; save(); return 1;
    case "DEL": delete db[key]; save(); return 1;
    case "INCR": db[key] = (parseInt(db[key], 10) || 0) + 1; save(); return db[key];
    case "EXPIRE": return 1;
    case "HGET": return h()[args[0]] === undefined ? null : h()[args[0]];
    case "HSET": h()[args[0]] = args[1]; save(); return 1;
    case "HSETNX": if (h()[args[0]] !== undefined) return 0; h()[args[0]] = args[1]; save(); return 1;
    case "HDEL": delete h()[args[0]]; save(); return 1;
    case "HINCRBY": h()[args[0]] = String((parseInt(h()[args[0]], 10) || 0) + parseInt(args[1], 10)); save(); return parseInt(h()[args[0]], 10);
    case "HLEN": return Object.keys(h()).length;
    case "HGETALL": return Object.entries(h()).flat();
    default: throw new Error("Commande locale non gérée : " + cmd);
  }
}

function pairsToObject(arr) {
  const out = {};
  for (let i = 0; arr && i < arr.length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
}

async function hgetallJson(key) {
  const obj = pairsToObject(await redis(["HGETALL", key]));
  for (const k in obj) obj[k] = JSON.parse(obj[k]);
  return obj;
}

/* ───────── Comptes ───────── */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

// Code provisoire lisible (sans 0/O, 1/I/L) : ex. « K7PQ2-XR9MB ».
function tempCode() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () => Array.from(crypto.randomBytes(5), (b) => A[b % A.length]).join("");
  return pick() + "-" + pick();
}

async function ensureSeed() {
  const n = await redis(["HLEN", K.users]);
  if (n > 0) return;
  const now = new Date().toISOString();
  for (const u of SEED) {
    await redis(["HSETNX", K.users, u.username, JSON.stringify({
      username: u.username, name: u.name, role: u.role, hash: u.hash, mustChange: true, createdAt: now,
    })]);
  }
}

async function getUser(username) {
  const raw = await redis(["HGET", K.users, username]);
  return raw ? JSON.parse(raw) : null;
}

async function saveUser(user) {
  await redis(["HSET", K.users, user.username, JSON.stringify(user)]);
}

function publicUser(u) {
  return { username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange, createdAt: u.createdAt, lastLogin: u.lastLogin || null };
}

/* ───────── Sessions (cookie signé HMAC) ───────── */

const COOKIE = "mc_session";
const SESSION_DAYS = 30;

async function secret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  await redis(["SETNX", K.secret, crypto.randomBytes(32).toString("hex")]);
  return redis(["GET", K.secret]);
}

const b64 = (s) => Buffer.from(s).toString("base64url");

async function signSession(username, version) {
  const payload = b64(JSON.stringify({ u: username, v: version, exp: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = crypto.createHmac("sha256", await secret()).update(payload).digest("base64url");
  return payload + "." + sig;
}

async function readSession(req) {
  const m = String(req.headers.cookie || "").match(/(?:^|;\s*)mc_session=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", await secret()).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch (e) { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = await getUser(data.u);
  // Un changement de mot de passe invalide les anciennes sessions.
  if (!user || (user.hash || "").slice(0, 12) !== data.v) return null;
  return user;
}

function sessionCookie(req, token, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.VERCEL ? "; Secure" : "";
  return COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + secure;
}

async function requireUser(req, { admin = false, allowMustChange = false } = {}) {
  await ensureSeed();
  const user = await readSession(req);
  if (!user) throw new HttpError(401, "Veuillez vous connecter.");
  if (user.mustChange && !allowMustChange) throw new HttpError(403, "Choisissez d'abord un nouveau mot de passe.");
  if (admin && user.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs.");
  return user;
}

/* ───────── HTTP ───────── */

/* ───────── Limite de débit ───────── */

// Sur Vercel, x-real-ip contient l'IP réelle du visiteur (non falsifiable par le client).
function clientIp(req) {
  return String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || (req.socket && req.socket.remoteAddress) || "?").trim();
}

// Au plus `max` requêtes par IP et par fenêtre de `windowSec` secondes pour un même « seau ».
// Les seuils sont larges : le jour J, toute la salle peut partager la même IP (wifi, 4G).
async function rateLimit(req, bucket, max, windowSec) {
  const key = "mc:rl:" + bucket + ":" + clientIp(req);
  const hits = await redis(["INCR", key]);
  if (hits === 1) await redis(["EXPIRE", key, windowSec]);
  if (hits > max) throw new HttpError(429, "Trop de demandes. Réessayez dans un instant.");
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; } }
    return req.body || {};
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch (e) { return {}; }
}

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const h in headers) res.setHeader(h, headers[h]);
  res.end(JSON.stringify(data));
}

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: "Erreur interne. Réessayez dans un instant." });
    }
  };
}

function query(req) {
  return new URL(req.url, "http://x").searchParams;
}

function str(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

module.exports = {
  K, HttpError, redis, hgetallJson, hashPassword, verifyPassword, tempCode,
  ensureSeed, getUser, saveUser, publicUser, signSession, sessionCookie, requireUser,
  readBody, send, handler, query, str, clientIp, rateLimit,
};
