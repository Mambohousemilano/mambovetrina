// ============================================================================
//  Mambo House — Verifica disponibilità (logica allineata al gestionale)
//  Fonte dati: Supabase via REST (NESSUNA libreria da installare -> fetch nativo).
//  - FASE A: soluzione DIRETTA (stessi alloggi per tutto il periodo)
//  - FASE B: soluzione SPEZZATA (il gruppo cambia alloggio, max 2 cambi)
//  Criteri combinazione: copre gli ospiti -> meno spreco -> meno alloggi.
//  Legge soltanto: non scrive mai né sul DB né sui portali.
// ============================================================================

const MAX_CHANGES = 2;
const reDate = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

const aptFreeInRange = (isOccupied, aptId, dIn, dOut) => {
  let d = dIn;
  while (d < dOut) { if (isOccupied(aptId, d)) return false; d = addDays(d, 1); }
  return true;
};

const bestCombo = (freeApts, guests) => {
  let best = null; const n = freeApts.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    let cap = 0, count = 0; const combo = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { cap += freeApts[i].capacity; count++; combo.push(freeApts[i]); }
    if (cap < guests) continue;
    const waste = cap - guests;
    if (!best || waste < best.waste || (waste === best.waste && count < best.count))
      best = { combo, totCap: cap, waste, count };
  }
  return best;
};

const splitStay = (apts, isOccupied, guests, dIn, dOut) => {
  const usable = apts.filter(a => a.capacity > 0);
  const points = new Set([dIn, dOut]);
  let d = dIn;
  while (d < dOut) {
    const prev = addDays(d, -1);
    for (const a of usable) {
      const freeToday = !isOccupied(a.id, d);
      const freePrev = d === dIn ? null : !isOccupied(a.id, prev);
      if (freePrev !== null && freeToday !== freePrev) { points.add(d); break; }
    }
    d = addDays(d, 1);
  }
  const bounds = [...points].sort();
  const rawSegs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const sIn = bounds[i], sOut = bounds[i + 1];
    const freeSeg = usable.filter(a => aptFreeInRange(isOccupied, a.id, sIn, sOut)).sort((a, b) => b.capacity - a.capacity);
    const combo = bestCombo(freeSeg, guests);
    if (!combo) return null;
    rawSegs.push({ sIn, sOut, combo });
  }
  if (rawSegs.length === 0) return null;
  const merged = [];
  for (const seg of rawSegs) {
    const key = seg.combo.combo.map(a => a.id).sort().join(',');
    const last = merged[merged.length - 1];
    if (last && last.key === key) last.sOut = seg.sOut;
    else merged.push({ sIn: seg.sIn, sOut: seg.sOut, combo: seg.combo, key });
  }
  const changes = merged.length - 1;
  if (changes > MAX_CHANGES) return null;
  return { segments: merged, changes };
};

const solve = (apts, isOccupied, guests, dIn, dOut) => {
  const freeApts = apts
    .filter(a => a.capacity > 0)
    .filter(a => aptFreeInRange(isOccupied, a.id, dIn, dOut))
    .sort((a, b) => b.capacity - a.capacity);
  const best = bestCombo(freeApts, guests);
  let split = null;
  if (!best) split = splitStay(apts, isOccupied, guests, dIn, dOut);
  return { freeApts, best, split };
};

const fmtApt = a => ({ id: a.id, nome: a.name, capienza: a.capacity });

// --- Supabase via REST (PostgREST), senza librerie ---
async function sbGet(base, key, path) {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

module.exports = async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query || {};
    if (!reDate.test(checkin || '') || !reDate.test(checkout || ''))
      return res.status(400).json({ errore: 'Date non valide (YYYY-MM-DD)' });
    if (checkout <= checkin)
      return res.status(400).json({ errore: 'Il check-out deve essere dopo il check-in' });
    const g = parseInt(guests, 10);
    if (!g || g < 1) return res.status(400).json({ errore: 'Numero ospiti non valido' });

    const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return res.status(500).json({ errore: 'Configurazione Supabase mancante' });

    const apts = await sbGet(base, key, 'apartments?select=id,name,capacity');
    const lista = (apts || []).filter(a => a.capacity > 0);

    const lastNight = addDays(checkout, -1);
    const bk = await sbGet(base, key,
      `bookings?select=apt_id,start_date,end_date&start_date=lte.${lastNight}&end_date=gte.${checkin}`);
    const byApt = {};
    for (const b of (bk || [])) (byApt[b.apt_id] = byApt[b.apt_id] || []).push([b.start_date, b.end_date]);
    const isOccupied = (aptId, day) => (byApt[aptId] || []).some(([s, e]) => s <= day && day <= e);

    const { freeApts, best, split } = solve(lista, isOccupied, g, checkin, checkout);

    if (best) return res.status(200).json({
      disponibile: true, tipo: 'diretta', combo: best.combo.map(fmtApt), totale: best.totCap, spreco: best.waste,
    });
    if (split) return res.status(200).json({
      disponibile: true, tipo: 'spezzata', cambi: split.changes,
      segmenti: split.segments.map(s => ({ dal: s.sIn, al: s.sOut, alloggi: s.combo.combo.map(fmtApt) })),
    });
    return res.status(200).json({
      disponibile: false, liberiPeriodo: freeApts.map(fmtApt),
      capienzaTotaleLibera: freeApts.reduce((s, a) => s + a.capacity, 0),
    });
  } catch (e) {
    return res.status(500).json({ errore: 'Errore interno', dettaglio: String((e && e.message) || e) });
  }
};

module.exports._test = { addDays, aptFreeInRange, bestCombo, splitStay, solve };
