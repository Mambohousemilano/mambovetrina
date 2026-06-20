// ============================================================================
//  Mambo House — Verifica disponibilità on-demand
//  Sincronizza gli iCal (Airbnb + Booking) SOLO quando il cliente clicca,
//  calcola gli alloggi liberi nelle date scelte e propone la combinazione
//  che copre il numero di ospiti.
// ============================================================================

// >>> CONFIGURA QUI <<<
//  capienza = numero massimo di ospiti per alloggio  (DA CONFERMARE, ora sono ipotesi)
//  ical     = lista di link iCal (Airbnb e/o Booking). Lascia [] se non disponibile.
const APARTMENTS = [
  { id: 'm1', nome: 'Mambo House 1', capienza: 2, ical: [
      'https://www.airbnb.com/calendar/ical/1040443639575212518.ics?t=cb534ef3e53f49b58ea4f3ea06aa978c&locale=it',
      // TODO: aggiungi qui il link iCal BOOKING di Mambo House 1 (mancante)
      // 'https://ical.booking.com/v1/export?t=...........',
  ]},
  { id: 'm2', nome: 'Mambo House 2', capienza: 3, ical: [
      'https://www.airbnb.com/calendar/ical/1044232260714779347.ics?t=6653476011a44c5cb2031e9025da3aae&locale=it',
      'https://ical.booking.com/v1/export?t=69483c18-e8c7-4127-88e2-ddad551b3dd7',
  ]},
  { id: 'm3', nome: 'Mambo House 3', capienza: 3, ical: [
      'https://www.airbnb.com/calendar/ical/1044248521487616039.ics?t=5056dbc90c704ecea4ed8a81348fa773&locale=it',
      'https://ical.booking.com/v1/export?t=8b8ae554-c242-4c84-abfa-7ef0b9b5cf74',
  ]},
  { id: 'm5', nome: 'Mambo House 5', capienza: 6, ical: [
      'https://www.airbnb.com/calendar/ical/1129119681695105539.ics?t=a5d099cae4d14e4492935ba65adfc991&locale=it',
      'https://ical.booking.com/v1/export?t=d94d2151-f1d1-4a11-834a-97cfd736df96',
  ]},
  { id: 'm6', nome: 'Mambo House 6', capienza: 2, ical: [
      'https://www.airbnb.com/calendar/ical/1136075904640248820.ics?t=3ac12d50bc3147d39492c9a0a3e8a583&locale=it',
      'https://ical.booking.com/v1/export?t=25d6c9b2-5363-44c5-9935-f781cd08c34c',
  ]},
  { id: 'm7', nome: 'Mambo House 7 (Villa)', capienza: 5, ical: [
      'https://www.airbnb.com/calendar/ical/970211876621915441.ics?t=bc3564b22ba94c81877c07752a82c294&locale=it',
      'https://ical.booking.com/v1/export?t=4b75cb5f-c943-4229-87eb-8e8e5c2df277',
  ]},
  // Villa 400€: aggiungi qui i suoi iCal quando li hai (ora esclusa dal calcolo automatico)
  { id: 'm0', nome: 'Mambo House 0 (Villa)', capienza: 10, ical: [] },
];

// >>> OPZIONI <<<
const PREFERENZA = 'minimo';   // 'minimo' = meno alloggi possibile (poi meno sprechi)
const MARGINE    = 0;          // 0 = capienza esatta, nessuna tolleranza

// ---------------------------------------------------------------------------
function parseDateInput(s) {            // 'YYYY-MM-DD' -> ms UTC midnight
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function parseICalDate(v) {              // '20260815' o '20260815T120000Z' -> ms UTC
  const m = /(\d{4})(\d{2})(\d{2})/.exec(v || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function parseBusy(text) {               // -> [{start,end}] (end ESCLUSIVO)
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let cur = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) cur = {};
    else if (line.startsWith('END:VEVENT')) { if (cur && cur.start != null && cur.end != null) out.push(cur); cur = null; }
    else if (cur) {
      if (line.startsWith('DTSTART')) cur.start = parseICalDate(line.split(':').pop());
      else if (line.startsWith('DTEND')) cur.end = parseICalDate(line.split(':').pop());
    }
  }
  return out;
}
function overlaps(aS, aE, bS, bE) { return aS < bE && aE > bS; }   // [aS,aE) vs [bS,bE)

async function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'MamboHouse/1.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// È libero se NESSUN evento di NESSUN iCal si sovrappone alle date richieste.
async function isFree(ap, ci, co) {
  if (!ap.ical || ap.ical.length === 0) return null;   // sconosciuto -> escluso
  for (const url of ap.ical) {
    if (!url || !/^https?:\/\//.test(url)) continue;
    let text;
    try { text = await fetchText(url); }
    catch (e) { return false; }                        // in dubbio: prudenza = occupato
    if (parseBusy(text).some(ev => overlaps(ev.start, ev.end, ci, co))) return false;
  }
  return true;
}

// Combinazione di alloggi liberi che copre 'guests' (forza bruta, max 7 -> 128 casi)
function bestCombo(free, guests) {
  const need = guests - MARGINE;
  const n = free.length; let best = null;
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0, count = 0; const sel = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += free[i].capienza; count++; sel.push(free[i]); }
    if (sum >= need) {
      const waste = sum - guests;
      if (!best || count < best.count || (count === best.count && waste < best.waste))
        best = { count, sum, waste, sel };
    }
  }
  return best ? best.sel : null;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const ci = parseDateInput(q.checkin);
    const co = parseDateInput(q.checkout);
    const guests = parseInt(q.guests, 10);
    if (ci == null || co == null || !guests || guests < 1)
      return res.status(400).json({ errore: 'Parametri non validi' });
    if (co <= ci)
      return res.status(400).json({ errore: 'Il check-out deve essere dopo il check-in' });

    const checked = await Promise.all(APARTMENTS.map(async ap => ({ ap, free: await isFree(ap, ci, co) })));
    const free = checked.filter(x => x.free === true).map(x => x.ap);

    const combo = bestCombo(free, guests);
    if (combo) {
      return res.status(200).json({
        disponibile: true,
        combo: combo.map(c => ({ id: c.id, nome: c.nome, capienza: c.capienza })),
        totale: combo.reduce((s, c) => s + c.capienza, 0),
      });
    }
    return res.status(200).json({
      disponibile: false,
      liberi: free.map(c => c.nome),
      capienzaTotaleLibera: free.reduce((s, c) => s + c.capienza, 0),
    });
  } catch (e) {
    return res.status(500).json({ errore: 'Errore interno', dettaglio: String(e && e.message || e) });
  }
};

// esportate per i test locali
module.exports.parseBusy = parseBusy;
module.exports.overlaps = overlaps;
module.exports.bestCombo = bestCombo;
module.exports.parseDateInput = parseDateInput;
