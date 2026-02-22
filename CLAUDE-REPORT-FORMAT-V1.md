Claude: Pakollinen raporttiformaatti (v1)

1) Executive summary (max 6 riviä)

Mitä muuttui (1–2 lausetta)

Mitä endpointteja/ominaisuuksia tuli

Mitkä riskit jäi auki

2) Change list (täsmällinen)

CHANGED FILES

path/to/file

change type: CREATE|MODIFY|DELETE

miksi muuttui (1 rivi)

tärkein uusi export/funktio (jos relevantti)

3) API contract (jos koskee endpointteja)

Endpointit + methodit

Request/response esimerkit (pienet, mutta oikeat)

Error envelope + error code -lista

4) Verification (ei “tests passed” ilman todisteita)

COMMANDS RUN

komento

exit code

oleellinen output (max 10 riviä / komento)

Esimerkki:

npm --prefix app test
exit=0
PASS agent_tools.specs.test.js
PASS agent_tools.invoke_batch.test.js
Tests: 12 passed, 0 failed
5) Manual test steps (jos relevantti)

curl-komennot joilla näen itse

expected output (1–2 riviä)

6) Diff highlights (pakollinen)

3–8 bulletia, jotka kuvaa konkreettisesti mitä koodi tekee nyt eri tavalla

jokaisessa bulletissa vähintään yksi symboli tai tiedostopolku (ei markkinointipuhetta)

7) Edge cases & limits (pakollinen)

wait_ms timeout behavior

pending-semanttiikka

max output size / truncation

authz: read vs admin

rate limiting / body limit jos koskee

8) Rollback plan (pakollinen, yksi kappale)

miten palaan edelliseen turvallisesti

mikä commit / mikä togglet / miten disabletaan feature

Tiukennukset Phase D:lle (gateway endpointit)

Lisäksi Phase D -tasolla vaadi:

A) “Proof of call_id binding”

Raporttiin yksi testiajo, jossa näkyy:

input call_id

response tool_call_id täsmää

B) “Pending on timeout”

Yksi testiajo:

mode: sync, wait_ms liian pieni

response sisältää pending:true (tai sovitun mallin)

C) “AuthZ mismatch”

Yksi testiajo:

read-key yrittää ajaa admin-toolia

response: 403 + error code (sovitun mukaan)


Save report to: `docs/reports/<task-num(if has (zeropad 3))>-<taskname>-<phase(if has)>-report.md` 
  - **example:** `docs/reports/024-agent-tools-api-phase-4-report.md`