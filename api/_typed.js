/*
 * Réponses tapées (blind test) : correction tolérante et « réponses drôles ».
 * On ignore majuscules, accents, ponctuation, articles en tête (« les », « the »…) et les petites fautes de frappe.
 */
const STOP = new Set(["le", "la", "les", "l", "the", "a", "un", "une", "des", "du", "de", "d"]);

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " et ").replace(/['’`]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
// sans les articles en tête : « The Fugees » = « Fugees », « Les Rita Mitsouko » = « Rita Mitsouko »
function core(s) {
  const w = norm(s).split(" ").filter(Boolean);
  while (w.length > 1 && STOP.has(w[0])) w.shift();
  return w.join(" ");
}

// formes acceptées d'une réponse : telle quelle, sans la parenthèse, la parenthèse seule, chaque artiste d'un duo
function variants(target) {
  const t = String(target || ""), out = new Set();
  const add = (x) => { const c = core(x); if (c.replace(/ /g, "").length >= 3) out.add(c); };
  add(t);
  add(t.replace(/\(.*?\)|\[.*?\]/g, " "));
  const inner = /\((.*?)\)/.exec(t);
  if (inner) add(inner[1]);
  const parts = t.split(/\s*(?:&|\+|,|\bfeat\.?|\bft\.?|\bx\b)\s*/i).filter(Boolean);
  if (parts.length > 1) parts.forEach(add);
  if (!out.size && core(t)) out.add(core(t)); // réponse très courte (« U2 ») : telle quelle
  return [...out];
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// fautes tolérées selon la longueur : 0 jusqu'à 3 lettres, 1 jusqu'à 9, 2 jusqu'à 14, 3 au-delà
function tolerance(len) { return len <= 3 ? 0 : len <= 9 ? 1 : len <= 14 ? 2 : 3; }

function isRight(text, targets) {
  const a = core(text).replace(/ /g, "");
  if (!a) return false;
  for (const t of targets) {
    for (const v of variants(t)) {
      const b = v.replace(/ /g, "");
      if (a === b || lev(a, b) <= tolerance(b.length)) return true;
    }
  }
  return false;
}

// Réponses drôles : fausses, différentes les unes des autres, sans grossièretés, tirées au hasard
const BAD = /\b(con|conne|connard|connasse|pute|putain|salope|encul\w*|bite|couilles?|nique\w*|fdp|ntm|pd|batard|chier|chatte|merde|cul|zob|teub|tg|gueule|sexe|porno?|nazi\w*|negr\w*|bougnoul\w*)\b/;
function funny(wrong, max) {
  const seen = new Set(), pool = [];
  for (const w of wrong) {
    const text = String(w.text || "").trim(), k = core(text);
    if (text.length < 2 || text.length > 40 || !/[a-z]/.test(k) || BAD.test(norm(text)) || seen.has(k)) continue;
    seen.add(k);
    pool.push({ name: w.name, text });
  }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, max || 4);
}

module.exports = { norm, core, variants, isRight, funny };
