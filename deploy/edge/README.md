# deploy/edge

Rubna konfiguracija preloadera (P-0.10). Zasad sadrži samo graditelja zaglavlja `Content-Security-Policy` za izgrađeni `dist/index.html` (DAN-995), prenesenog iz Ductusa (`src/server/http/content-security-policy.ts`).

- `contentSecurityPolicyFor(html)` uzima tekst jedine `<script>` i jedine `<style>` iz stranice i vraća politiku koja dopušta samo njihove `sha256` hasheve. Nema `'unsafe-inline'`, `'unsafe-eval'`, noncea ni `*`.
- Stranica s drugom skriptom ili stilom, atributom na tim tagovima, HTML komentarom ili znakom NUL se odbija (baca grešku).
- Kod radi i u rubnom runtimeu: samo Web Crypto, bez `node:` uvoza.

Objava na rubu, hosting i proxy nisu ovdje (DAN-939). Test je `test/csp.test.ts`.
