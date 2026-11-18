# Provjera servera (P-0.4)

`checkHealth` šalje jedan `GET /api/v1/health` (`platform.health.get`) bez kolačića i bez predmemorije te čita odgovor. Ne baca: mreža, preusmjerenje, drugi status ili medijski tip i tijelo izvan oblika iz ugovora daju `null` (server nije dostupan).

Preusmjerenje se ne slijedi (`redirect: 'manual'`, DAN-934-3a): zdravlje vrijedi samo za izravan odgovor rute iz ugovora. Test je `test/health-redirect.test.ts`.

Tip tijela je `Operations['platform.health.get']['success']['body']` iz `@ductura/contracts` (samo tip). Stranica `checkHealth` još ne uključuje.
