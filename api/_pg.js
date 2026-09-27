/*
 * Stockage Postgres (Supabase) exposant les mêmes commandes que Redis
 * utilisées par _lib.js. La table est créée automatiquement au premier appel,
 * dans un schéma « mc » non exposé par l'API publique de Supabase, avec la
 * sécurité par ligne (RLS) activée et aucune règle : seul le serveur y accède.
 */
const { Pool } = require("pg");

function connectionString() {
  const env = process.env;
  const direct = env.POSTGRES_URL || env.DATABASE_URL || env.SUPABASE_DB_URL || env.POSTGRES_URL_NON_POOLING;
  if (direct) return direct;
  // Intégration Vercel avec un préfixe personnalisé (ex. « STORAGE_POSTGRES_URL »)
  const key = Object.keys(env).find((k) => /POSTGRES_URL$/.test(k)) || Object.keys(env).find((k) => /POSTGRES_URL_NON_POOLING$/.test(k));
  return key ? env[key] : null;
}

const URL_ = connectionString();

let pool;
let ready;

function getPool() {
  if (!pool) {
    // sslmode est retiré de l'URL : le certificat de Supabase n'est pas dans
    // le magasin par défaut de Node, on garde le chiffrement sans vérifier la chaîne.
    const cs = URL_.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(cs);
    pool = new Pool({ connectionString: cs, ssl: local ? false : { rejectUnauthorized: false }, max: 2, idleTimeoutMillis: 10000 });
  }
  if (!ready) {
    ready = pool.query(`
      create schema if not exists mc;
      create table if not exists mc.kv (
        k text not null,
        f text not null default '',
        v text,
        exp timestamptz,
        primary key (k, f)
      );
      alter table mc.kv enable row level security;
    `).catch((e) => { ready = null; throw e; });
  }
  return ready.then(() => pool);
}

const LIVE = "(exp is null or exp > now())";

async function pgCommand([cmd, key, ...args]) {
  const db = await getPool();
  const q = (sql, params) => db.query(sql, params);
  switch (cmd) {
    case "GET": {
      const r = await q(`select v from mc.kv where k = $1 and f = '' and ${LIVE}`, [key]);
      return r.rows[0] ? r.rows[0].v : null;
    }
    case "SET":
      await q(`insert into mc.kv (k, f, v) values ($1, '', $2) on conflict (k, f) do update set v = excluded.v, exp = null`, [key, args[0]]);
      return "OK";
    case "SETNX": {
      await q(`delete from mc.kv where k = $1 and f = '' and not ${LIVE}`, [key]);
      const r = await q(`insert into mc.kv (k, f, v) values ($1, '', $2) on conflict do nothing`, [key, args[0]]);
      return r.rowCount;
    }
    case "DEL":
      await q(`delete from mc.kv where k = $1`, [key]);
      return 1;
    case "INCR": {
      const r = await q(`
        insert into mc.kv (k, f, v) values ($1, '', '1')
        on conflict (k, f) do update set
          v = case when mc.kv.exp is not null and mc.kv.exp <= now() then '1' else (coalesce(mc.kv.v, '0')::int + 1)::text end,
          exp = case when mc.kv.exp is not null and mc.kv.exp <= now() then null else mc.kv.exp end
        returning v`, [key]);
      return parseInt(r.rows[0].v, 10);
    }
    case "EXPIRE":
      await q(`update mc.kv set exp = now() + make_interval(secs => $2) where k = $1`, [key, Number(args[0])]);
      return 1;
    case "HGET": {
      const r = await q(`select v from mc.kv where k = $1 and f = $2`, [key, args[0]]);
      return r.rows[0] ? r.rows[0].v : null;
    }
    case "HSET":
      await q(`insert into mc.kv (k, f, v) values ($1, $2, $3) on conflict (k, f) do update set v = excluded.v`, [key, args[0], args[1]]);
      return 1;
    case "HSETNX": {
      const r = await q(`insert into mc.kv (k, f, v) values ($1, $2, $3) on conflict do nothing`, [key, args[0], args[1]]);
      return r.rowCount;
    }
    case "HDEL":
      await q(`delete from mc.kv where k = $1 and f = $2`, [key, args[0]]);
      return 1;
    case "HINCRBY": {
      const r = await q(`
        insert into mc.kv (k, f, v) values ($1, $2, $3::text)
        on conflict (k, f) do update set v = (coalesce(mc.kv.v, '0')::int + $3::int)::text
        returning v`, [key, args[0], parseInt(args[1], 10)]);
      return parseInt(r.rows[0].v, 10);
    }
    case "HLEN": {
      const r = await q(`select count(*)::int as n from mc.kv where k = $1 and f <> ''`, [key]);
      return r.rows[0].n;
    }
    case "HGETALL": {
      const r = await q(`select f, v from mc.kv where k = $1 and f <> '' order by f`, [key]);
      return r.rows.flatMap((row) => [row.f, row.v]);
    }
    default:
      throw new Error("Commande non gérée : " + cmd);
  }
}

module.exports = { enabled: !!URL_, pgCommand };
