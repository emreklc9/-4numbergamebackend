# Sayı Avı Backend

NestJS + PostgreSQL API. Tüm HTTP yolları `/v1` altındadır. Varsayılan port `3003`.

Mobil uygulama kardeş dizindedir: `../../+4numbergame/-4numbergame`.

## Kurulum

```bash
npm install
cp .env.example .env
npm run start:dev
```

`.env` değerlerini kendin doldur. Örnek dosyadaki veritabanı parolası yer tutucu olmalı; gerçek parola oraya yazılmaz. Zorunlu alanlar: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET` (en az 16 karakter), `GOOGLE_CLIENT_ID` (web, Android ve iOS kimlikleri virgülle ayrılabilir).

`GOOGLE_CLIENT_SECRET` bu sürümde kullanılmaz. Giriş, Google kimlik belirtecini `GOOGLE_CLIENT_ID` kitlesine göre doğrular.

Tablolar geliştirmede `synchronize` ile açılır. Üretimde (`NODE_ENV=production`) bu kapalıdır; migration eklenmeden şema değişmez.

```bash
npm test
npm run start:prod
```

## HTTP

| Metot | Yol | Auth | Açıklama |
|---|---|---|---|
| GET | /v1/health | – | Sağlık ve veritabanı |
| POST | /v1/auth/guest | – | Misafir oturumu |
| POST | /v1/auth/register | – | E-posta/şifre kayıt |
| POST | /v1/auth/login | – | Giriş |
| POST | /v1/auth/refresh | – | Erişim belirteci yenile |
| POST | /v1/auth/logout | – | Yenileme anahtarını iptal et |
| POST | /v1/auth/google | – | Google kimlik belirteci |
| POST | /v1/auth/google/link | JWT | Misafiri Google hesabına bağla |
| POST | /v1/auth/upgrade | JWT | Misafiri e-posta hesabına çevir |
| POST | /v1/auth/password | JWT | Şifre değiştir |
| GET | /v1/auth/me | JWT | Mevcut kullanıcı |
| PATCH | /v1/auth/me | JWT | Ad ve avatar |
| POST | /v1/games | JWT | Oyun aç (`digits` 3, 4 veya 5) |
| GET | /v1/games/:id | JWT | Oyun durumu (bitmeden gizli sayı yok) |
| POST | /v1/games/:id/guesses | JWT | Tahmin |
| POST | /v1/games/:id/hints | JWT | `reveal` veya `eliminate`, 1 altın |
| GET | /v1/records | JWT | Kendi rekorların |
| POST | /v1/records/offline | JWT | Çevrimdışı rekor ve harcama; doğrulanmamış |
| GET | /v1/leaderboard?digits=4 | – | Doğrulanmış en iyi skorlar |
| GET | /v1/store | JWT | Altın, envanter, donatma |
| POST | /v1/store/purchase | JWT | Satın al |
| PUT | /v1/store/equip | JWT | Donat |

Çevrimiçi galibiyet rekoru oyun servisi yazar. Ayrı bir `POST /records` yoktur.

## PvP

Socket.IO namespace: `/pvp`. Bağlantıda `auth.token` erişim belirtecidir.

İstemci olayları: `queue`, `cancel`, `guess`.

Sunucu olayları: `queued`, `matchStart`, `opponentProgress`, `opponentConnection`, `matchEnd`, `error`.

4 basamak, ortak gizli sayı, kazanana 15 altın. Tahmin yoksa 30 sn, kopunca 60 sn. Kuyruk ve aktif maç süreç belleğindedir; birden fazla sunucu örneği aynı kuyruğu paylaşmaz.

WebSocket paketleri şu an `devDependencies` içindedir. Üretim kurulumunda `dependencies`e alınmalıdır.

## Diğer

- CORS herkese açık. Üretimden önce kısıtla.
- Misafir hesaplar `GUEST_RETENTION_DAYS` (varsayılan 180) gün kullanılmazsa silinir. `0` kapatır.
- Altın hareketi `gold_transactions` içine yazılır. Aynı `(userId, ref)` ikinci kez uygulanmaz.
