Claude: Plan Format (v1)

1) Executive summary (max 6 riviä)

Mitä ollaan toteuttamassa (1–2 lausetta)

Mitä endpointteja/ominaisuuksia tulee

Mitkä riippuvuudet/patternit hyödynnetään

Mitä ei tehdä (scope rajoitteet)

2) Task list (täsmällinen)

TASK 01: Nimi

Kuvaus (1–2 riviä)

Deliverables: tiedostot, funktiot, endpointit

TASK 02: Nimi

...

3) API contract (jos koskee endpointteja)

Endpointit + methodit

Request/response esimerkit (pienet, mutta oikeat)

Error envelope + error code -lista

4) Dependencies & Reuse

Existing modules to use:
- path/to/module - function/reason
- path/to/module - function/reason

Existing patterns to follow:
- Pattern name (link to example)

5) Files to create/modify

CREATE:
- path/to/file - purpose

MODIFY:
- path/to/file - what changes (1 line)

DELETE:
- path/to/file - reason

6) Implementation notes

Tärkeitä päätöksiä tai epäselvyyksiä

AuthZ-ratkaisut (read vs admin)

Error handling -strategia

Output truncation / limitointi

Polling-strategia (jos async)

7) Verification plan

Testikattavuus:

Unit testit (mitä testataan)

Integration testit (happy path)

Edge case testit

Manual test -komennot

8) Rollback plan

Miten feature pois käytöstä (jos menee pieleen)

Mikä poistetaan / miten revertoidaan

9) Edge cases & limits (pakollinen)

Timeout behavior

Max sizes / limits

AuthZ: read vs admin

Error handling: miten virheet palautetaan

10) Phase D proof (jos gateway-endpointteja)

A) "Proof of binding/ID correlation"

Mitä ID:tä/inputtia käytetään ja miten se näkyy responsessa

B) "Pending/timeout handling"

Miten timeout tilanne näkyy responsessa

C) "AuthZ enforcement"

Mitä roolia tarvitaan ja mitä tapahtuu väärällä roolilla



Save plan to: `docs/plans/<task-num(if has, (zeropad 3))>-<taskname>-<phase(if has)>-plan.md` 
  - **example:** `docs/plans/024-agent-tools-api-phase-4-plan.md`