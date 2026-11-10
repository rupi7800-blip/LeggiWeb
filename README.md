# LeggiWeb

Web app (PWA) che apre una pagina web, ne estrae il testo dell'articolo e lo **legge ad alta voce in italiano o in spagnolo**.

## Funzioni
- Incolli il link (o usi **Condividi → LeggiWeb** dal browser Android dopo aver installato l'app) oppure incolli un testo.
- Riconoscimento automatico della lingua (italiano / spagnolo), con cambio manuale in un tocco.
- Voce italiana e spagnola a scelta tra quelle del dispositivo, velocità e tono regolabili.
- Evidenzia la frase in lettura, tocchi una frase per partire da lì, frase precedente/successiva.
- Libreria delle pagine aperte con ripresa dal punto in cui eri arrivato.
- Timer di spegnimento, schermo sempre acceso durante la lettura, comandi sulla schermata di blocco (sperimentale).
- Tema automatico / chiaro / seppia / scuro, dimensione del testo regolabile.
- Sistema di aggiornamento con tasto "Aggiorna" e notifica (come AgendApp).

## Pubblicazione su GitHub Pages
1. Crea il repository `LeggiWeb` e carica tutti i file mantenendo le cartelle (`css`, `js`, `icons`).
2. Settings → Pages → Branch `main` / root → Save.
3. Apri l'indirizzo da Chrome sul telefono → menu ⋮ → **Installa app**.

## Rilasciare un aggiornamento
Ad ogni modifica aumenta il numero di versione **in due punti uguali**:
- `version.json` → `"version"` (e le note)
- `index.html` → `data-version` dello script `js/aggiornamenti.js`

## Come legge le pagine
Il testo viene estratto tramite il servizio gratuito `r.jina.ai`; se non risponde, l'app usa un proxy CORS pubblico
(allorigins, corsproxy.io, codetabs) ed estrae l'articolo direttamente nel telefono. Le pagine dietro login o paywall
non sono leggibili: in quel caso copia il testo e usa "Incolla testo".

## Voci mancanti
- Android: Impostazioni → Sistema → Lingue → Output sintesi vocale → Motore Google → Installa dati vocali (Italiano, Español).
- iPhone: Impostazioni → Accessibilità → Contenuto letto → Voci.
