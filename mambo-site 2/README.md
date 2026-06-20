# Mambo House Milano — sito vetrina + verifica disponibilità (B1)

Sito statico (`index.html`) + funzione serverless (`api/disponibilita.js`).
La funzione, SOLO al clic del cliente, legge dal **gestionale Supabase**:
- le **capienze** dalla tabella `apartments` (colonna `capienza`)
- le **occupazioni** dalla tabella `bookings` (Airbnb/Booking/diretti/blocchi)
calcola gli alloggi liberi nelle date scelte e propone la combinazione che copre
il numero di ospiti. Se fattibile, apre WhatsApp con la combinazione già scritta.
Legge soltanto: non scrive mai né sul DB né sui portali.

## Variabili d'ambiente (su Vercel: Settings → Environment Variables)
Sono le STESSE del gestionale:
- `SUPABASE_URL`               = https://ijfbeszcyfwryyyjcecq.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`  = (la service role key del progetto Supabase)

> La service role key sta in Supabase → Project Settings → API → service_role.
> Va messa SOLO come variabile d'ambiente su Vercel (lato server), MAI nel codice
> del sito o in pagina: bypassa la sicurezza RLS, quindi deve restare segreta.

## Pubblicare su Vercel
1. Carica questa cartella su un repo GitHub (consigliato) e importala su Vercel,
   oppure trascina la cartella nel progetto Vercel.
2. Framework Preset = "Other". Vercel installa da solo @supabase/supabase-js,
   serve `index.html` e crea la funzione `api/disponibilita.js`.
3. Aggiungi le due variabili d'ambiente qui sopra.
4. Deploy. Avrai un URL `…vercel.app`: prova "Verifica disponibilità".
5. Dominio: Project → Settings → Domains → aggiungi `mambohouse.it` e imposta i
   record DNS che Vercel mostra (su Wix, sostituendo quelli esistenti).

## Note
- La villa **MAMBOHOUSE 0** non ha ancora iCal: è esclusa dal calcolo automatico
  (resta visibile sul sito). Appena ha gli iCal nel gestionale, entra da sola.
- `end_date` in `bookings` è l'ultima notte occupata: il giorno di check-out resta
  libero per un nuovo check-in (gestito correttamente).
- Aprendo `index.html` in locale la verifica non funziona (manca il server): in quel
  caso il pulsante apre direttamente WhatsApp come ripiego.
