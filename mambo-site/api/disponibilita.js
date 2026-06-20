// ============================================================================
//  Mambo House — Verifica disponibilità (logica allineata al gestionale)
//  Fonte dati: Supabase (apartments.capacity + bookings).
//  - FASE A: soluzione DIRETTA (stessi alloggi per tutto il periodo)
//  - FASE B: soluzione SPEZZATA (il gruppo cambia alloggio, max 2 cambi)
//  Criteri combinazione: copre gli ospiti -> meno spreco -> meno alloggi.
//  Legge soltanto: non scrive mai né sul DB né sui portali.
//  Nota: la capienza usata QUI (capacity) può differire dal testo descrittivo
//  mostrato sulle card del sito (volutamente).
// ============================================================================
const { createClient } = require('@supabase/supabase-js');

const MAX_CHANGES = 2;
const reDate = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// libero per TUTTE le notti del periodo [dIn, dOut)  (la notte del check-out non conta)
const aptFreeInRange = (isOccupied, aptId, dIn, dOut) => {
  let d = dIn;
  while (d < dOut) { if (isOccupied(aptId, d)) return false; d = addDays(d, 1); }
  return true;
};

// combinazione migliore: copre -> meno spreco -> meno alloggi (forza bruta, <=127 casi)
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

// soluzione spezzata: il gruppo resta unito ma cambia alloggio (max MAX_CHANGES cambi)
const splitStay = (apts, isOccupied, guests, dIn, dOut) => {
  const usable = apts.filter(a => a.capacity > 0);
  // 1) confini: inizio, fine e ogni giorno in cui cambia la disponibilità
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
  // 2) segmenti grezzi
  const rawSegs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const sIn = bounds[i], sOut = bounds[i + 1];
    const freeSeg = usable
      .filter(a => aptFreeInRange(isOccupied, a.id, sIn, sOut))
      .sort((a, b) => b.capacity - a.capacity);
    const combo = bestCombo(freeSeg, guests);
    if (!combo) return null;
    rawSegs.push({ sIn, sOut, combo });
  }
  if (rawSegs.length === 0) return null;
  // 3) fondi segmenti consecutivi con la stessa combinazione
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

// motore: FASE A poi (se serve) FASE B
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

module.exports = async (req, res) => {
  try {
    const { checkin, checkout, guests } = req.query || {};
    if (!reDate.test(checkin || '') || !reDate.test(checkout || ''))
      return res.status(400).json({ errore: 'Date non valide (YYYY-MM-DD)' });
    if (checkout <= checkin)
      return res.status(400).json({ errore: 'Il check-out deve essere dopo il check-in' });
    const g = parseInt(guests, 10);
    if (!g || g < 1) return res.status(400).json({ errore: 'Numero ospiti non valido' });

    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(500).json({ errore: 'Configurazione Supabase mancante' });
    const sb = createClient(url, key, { auth: { persistSession: false } });

    // apartments (capienza = capacity, canonica del gestionale)
    const { data: apts, error: e1 } = await sb.from('apartments').select('id,name,capacity');
    if (e1) throw e1;
    const lista = (apts || []).filter(a => a.capacity > 0);

    // bookings che toccano il periodo [checkin, checkout)
    const lastNight = addDays(checkout, -1);
    const { data: bk, error: e2 } = await sb.from('bookings')
      .select('apt_id,start_date,end_date')
      .lte('start_date', lastNight)
      .gte('end_date', checkin);
    if (e2) throw e2;
    const byApt = {};
    for (const b of (bk || [])) (byApt[b.apt_id] = byApt[b.apt_id] || []).push([b.start_date, b.end_date]);
    const isOccupied = (aptId, day) => (byApt[aptId] || []).some(([s, e]) => s <= day && day <= e);

    const { freeApts, best, split } = solve(lista, isOccupied, g, checkin, checkout);

    if (best) {
      return res.status(200).json({
        disponibile: true, tipo: 'diretta',
        combo: best.combo.map(fmtApt),
        totale: best.totCap, spreco: best.waste,
      });
    }
    if (split) {
      return res.status(200).json({
        disponibile: true, tipo: 'spezzata', cambi: split.changes,
        segmenti: split.segments.map(s => ({ dal: s.sIn, al: s.sOut, alloggi: s.combo.combo.map(fmtApt) })),
      });
    }
    return res.status(200).json({
      disponibile: false,
      liberiPeriodo: freeApts.map(fmtApt),
      capienzaTotaleLibera: freeApts.reduce((s, a) => s + a.capacity, 0),
    });
  } catch (e) {
    return res.status(500).json({ errore: 'Errore interno', dettaglio: String((e && e.message) || e) });
  }
};

// esportate per i test locali
module.exports._test = { addDays, aptFreeInRange, bestCombo, splitStay, solve };
