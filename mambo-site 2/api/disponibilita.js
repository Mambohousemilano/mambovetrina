// ============================================================================
//  Mambo House — Verifica disponibilità (versione B1: legge dal gestionale)
//  Fonte dati: Supabase del gestionale MamboHouse.
//   - capienze        -> tabella "apartments" (colonna capienza)
//   - occupazioni      -> tabella "bookings" (Airbnb/Booking/diretti/blocchi)
//  NB: legge soltanto. Non scrive mai nulla, né su DB né sui portali.
//  Considera occupato QUALSIASI booking che si sovrappone alle date richieste.
//  end_date è l'ULTIMA notte occupata (inclusivo): il giorno di check-out è libero.
// ============================================================================
const { createClient } = require('@supabase/supabase-js');

// Opzioni
const MARGINE = 0;   // 0 = capienza esatta, nessuna tolleranza

const reDate = /^\d{4}-\d{2}-\d{2}$/;

// Combinazione di alloggi liberi che copre 'guests' (min alloggi, poi min sprechi)
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
    const { checkin, checkout, guests } = req.query || {};
    if (!reDate.test(checkin || '') || !reDate.test(checkout || ''))
      return res.status(400).json({ errore: 'Date non valide (formato YYYY-MM-DD)' });
    if (checkout <= checkin)
      return res.status(400).json({ errore: 'Il check-out deve essere dopo il check-in' });
    const g = parseInt(guests, 10);
    if (!g || g < 1) return res.status(400).json({ errore: 'Numero ospiti non valido' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(500).json({ errore: 'Configurazione Supabase mancante' });

    const sb = createClient(url, key, { auth: { persistSession: false } });

    // 1) alloggi verificabili (hanno capienza + almeno un iCal collegato)
    const { data: apts, error: e1 } = await sb
      .from('apartments').select('id,name,capienza,ical_airbnb,ical_booking');
    if (e1) throw e1;
    const verificabili = (apts || [])
      .filter(a => a.capienza && (a.ical_airbnb || a.ical_booking))
      .map(a => ({ id: a.id, nome: a.name, capienza: a.capienza }));

    // 2) alloggi occupati nelle date richieste
    //    conflitto: start_date < checkout  AND  end_date >= checkin
    const { data: busy, error: e2 } = await sb
      .from('bookings').select('apt_id')
      .lt('start_date', checkout)
      .gte('end_date', checkin);
    if (e2) throw e2;
    const occupati = new Set((busy || []).map(b => b.apt_id));

    // 3) liberi + combinazione
    const free = verificabili.filter(a => !occupati.has(a.id));
    const combo = bestCombo(free, g);

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
    return res.status(500).json({ errore: 'Errore interno', dettaglio: String((e && e.message) || e) });
  }
};
