/*
 * Tables et « qui est assis où ».
 *
 * - mc:seating      → { tables: [{ id, name, seats }], updatedAt, updatedBy } (la liste des tables)
 * - mc:assign       → hash  invitéId → JSON { t: tableId, at, src: "invite" | "equipage" }
 *
 * Les affectations sont écrites une par une (HSET), pour que les invités qui
 * s'installent en même temps et l'équipage qui corrige ne s'écrasent jamais.
 * Les anciennes versions stockaient `assign` dans mc:seating : migration auto.
 */
const L = require("./_lib");

const K_ASSIGN = "mc:assign";

function defaultTables() {
  return Array.from({ length: 10 }, (_, i) => ({ id: "t" + (i + 1), name: "Table " + (i + 1), seats: 8 }));
}

async function getPlan() {
  const raw = await L.redis(["GET", L.K.seating]);
  const plan = raw ? JSON.parse(raw) : { tables: defaultTables() };
  if (plan.assign && Object.keys(plan.assign).length) {
    // migration de l'ancien format
    for (const [id, t] of Object.entries(plan.assign)) {
      await L.redis(["HSETNX", K_ASSIGN, id, JSON.stringify({ t, at: plan.updatedAt || new Date().toISOString(), src: "equipage" })]);
    }
    delete plan.assign;
    await L.redis(["SET", L.K.seating, JSON.stringify(plan)]);
  }
  if (!Array.isArray(plan.tables)) plan.tables = defaultTables();
  return plan;
}

async function saveTables(tables, by) {
  const plan = await getPlan();
  plan.tables = tables;
  plan.updatedAt = new Date().toISOString();
  plan.updatedBy = by;
  await L.redis(["SET", L.K.seating, JSON.stringify(plan)]);
  // retire les affectations vers des tables supprimées
  const ids = new Set(tables.map((t) => t.id));
  const assign = await getAssignFull();
  for (const [pid, a] of Object.entries(assign)) {
    if (!ids.has(a.t)) await L.redis(["HDEL", K_ASSIGN, pid]);
  }
  return plan;
}

async function getAssignFull() {
  const out = {};
  const arr = await L.redis(["HGETALL", K_ASSIGN]);
  for (let i = 0; arr && i < arr.length; i += 2) {
    try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch (e) { out[arr[i]] = { t: arr[i + 1] }; }
  }
  return out;
}

// Forme simple { invitéId: tableId }, utilisée par l'admin (plan, constellation, export)
async function getAssign() {
  const full = await getAssignFull();
  const out = {};
  for (const [pid, a] of Object.entries(full)) out[pid] = a.t;
  return out;
}

async function setAssign(pid, tableId, src) {
  if (!tableId) return L.redis(["HDEL", K_ASSIGN, pid]);
  return L.redis(["HSET", K_ASSIGN, pid, JSON.stringify({ t: tableId, at: new Date().toISOString(), src })]);
}

module.exports = { getPlan, saveTables, getAssign, getAssignFull, setAssign, defaultTables, K_ASSIGN };
