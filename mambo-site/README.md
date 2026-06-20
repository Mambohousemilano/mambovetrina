# Mambo House Milano — sito + verifica disponibilità

Sito statico (`index.html`) + una funzione serverless (`api/disponibilita.js`) che,
SOLO quando il cliente clicca "Verifica disponibilità", legge gli iCal di Airbnb e
Booking, controlla quali alloggi sono liberi nelle date scelte e propone la
combinazione che copre il numero di ospiti. Se è fattibile, apre WhatsApp con la
combinazione già scritta.

## Pubblicare su Vercel (consigliato)
1. Vai su https://vercel.com → accedi (con GitHub va benissimo).
2. "Add New… → Project". Puoi:
   - trascinare questa cartella, **oppure**
   - caricarla prima su un repository GitHub e importarla.
3. Vercel riconosce da solo `index.html` (sito) e `api/disponibilita.js` (funzione).
   Nessuna configurazione, nessun "build". Premi **Deploy**.
4. In pochi secondi avrai un link tipo `mambo-house.vercel.app`. Prova il pulsante.
5. Per usare il tuo dominio: Project → Settings → Domains → aggiungi `mambohouse.it`
   e imposta nei DNS i record che Vercel ti mostra.

> Aprendo `index.html` con doppio clic sul PC la verifica NON funziona (manca la
> parte server): in quel caso il pulsante apre direttamente WhatsApp. Online su
> Vercel funziona tutto.

## Cosa configurare in `api/disponibilita.js`
In cima al file c'è l'elenco `APARTMENTS`. Per ciascuno:
- **capienza**: numero massimo di ospiti (ORA SONO IPOTESI — vanno messi quelli veri).
- **ical**: i link Airbnb e Booking (già inseriti, tranne dove indicato).

Note:
- **Mambo House 1**: manca il link iCal **Booking** (inserirlo nella riga indicata).
- **Mambo House 0 (Villa 400€)**: mancano entrambi gli iCal → ora è esclusa dal
  calcolo automatico finché non li aggiungi.

## Opzioni (in cima al file)
- `PREFERENZA = 'minimo'` → propone il minor numero di alloggi, poi il minor spreco.
- `MARGINE = 0` → capienza esatta, nessuna tolleranza.

## Limiti onesti
- Gli iCal danno solo libero/occupato (non i prezzi) e si aggiornano ogni poche ore.
- La prenotazione vera avviene poi via WhatsApp / Airbnb / Booking.
