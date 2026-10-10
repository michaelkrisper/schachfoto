# Schachfoto

Schachbrett fotografieren, Stellung erkennen lassen, die besten Züge sehen.
Eine PWA für Android und iPhone auf Cloudflare Pages:
**https://schachfoto.pages.dev**

## So funktioniert's

1. **Foto:** Das Handy verkleinert das Bild auf 1568 px und schickt es an
   `functions/api/recognize.js`.
2. **Erkennung:** Die Funktion fragt Gemini im Free Tier und bekommt die
   Stellung als acht Reihen-Strings zurück (Structured Output). Sie probiert
   die Modelle der Reihe nach: 3.6 Flash, 3 Flash Preview, 3.8 Flash. Ist eins
   überlastet (503) oder am Limit (429), kommt das nächste dran, denn jedes hat
   ein eigenes Kontingent. Liest das Modell ein Foto von der schwarzen Seite
   kopfüber, dreht `orientByPawns` die Stellung anhand der Bauern zurück.
3. **Prüfen:** Die erkannte Stellung lässt sich auf dem Brett korrigieren,
   unsichere Felder sind gelb markiert. Wer am Zug ist und welche Rochaden noch
   erlaubt sind, sieht man auf einem Foto nicht, das wählst du selbst.
4. **Züge:** Stockfish 19 (lite, single-threaded, WASM) rechnet im Browser die
   drei besten Züge mit Bewertung und Fortsetzung. Das funktioniert offline und
   braucht keine Cross-Origin-Isolation, läuft also auch auf iOS.

Im Free Tier darf Google die hochgeladenen Fotos zum Training verwenden.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `public/` | Statische PWA, Vanilla-ES-Module ohne Build |
| `public/js/position.js` | Brettmodell, FEN, Plausibilitätsprüfung, Ausrichtung |
| `public/js/engine.js` | UCI-Wrapper um den Stockfish-Worker |
| `functions/api/recognize.js` | Pages Function: Zugangscode, Gemini-Aufruf, Validierung |
| `tests/` | `node:test` für Brettlogik, UCI-Parser und die Function (mit gemocktem `fetch`) |
| `scripts/browser-check.mjs` | Smoke-Test in headless Chrome: Stellung bauen, analysieren, Pfeile prüfen |

## Entwickeln

Voraussetzung: Node 24.

    npm install
    cp .dev.vars.example .dev.vars    # GEMINI_API_KEY und ACCESS_CODE eintragen
    npm run dev                       # http://localhost:8793
    npm run check                     # Biome (Lint + Format) und Tests
    npm run lint:fix                  # Biome-Fixes anwenden
    node scripts/browser-check.mjs    # gegen den laufenden Dev-Server

## Deployment

Jeder Push auf `main` läuft durch die GitHub Action `CI` (Lint und Tests) und
geht danach auf Cloudflare Pages, sofern das Repo-Secret
`CLOUDFLARE_API_TOKEN` gesetzt ist. Von Hand geht es mit `npm run deploy`.

Die Secrets der Pages-Funktion werden in einem echten Terminal gesetzt, nicht
über eine Pipe ohne TTY, sonst landet ein leerer Wert:

    npx wrangler pages secret put GEMINI_API_KEY --project-name schachfoto
    npx wrangler pages secret put ACCESS_CODE --project-name schachfoto

Ohne `GEMINI_API_KEY` antwortet die Erkennung mit 503, das Brett lässt sich
aber weiterhin von Hand aufbauen und analysieren. `ACCESS_CODE` schützt das
Gratis-Kontingent vor fremden Aufrufen.

## Lizenz

Der eigene Code steht unter der [MIT-Lizenz](LICENSE). Mitgelieferte Dateien
behalten ihre Lizenzen:

- [Stockfish](https://github.com/official-stockfish/Stockfish) in der
  WASM-Fassung von [stockfish.js](https://github.com/nmrugg/stockfish.js):
  GPLv3, siehe `public/vendor/STOCKFISH-COPYING.txt`
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause, siehe
  `public/vendor/CHESSJS-LICENSE.txt`
- Figurensatz „cburnett“ von Colin M.L. Burnett: CC BY-SA 3.0
