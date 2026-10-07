# Sayı Avı Backend

NestJS + PostgreSQL REST API (`/v1`).

## Kurulum
```
npm install
cp .env.example .env   # değerleri doldur (DB_NAME=numbergame)
npm run start:dev
```
Tablolar geliştirme modunda otomatik oluşur (`synchronize`); üretimde migration kullanılmalı.

## Uç noktalar
| Metot | Yol | Auth | Açıklama |
|---|---|---|---|
| GET | /v1/health | – | Sağlık + DB kontrolü |
| POST | /v1/auth/guest | – | Misafir oturumu |
| POST | /v1/auth/register | – | E-posta/şifre kayıt |
| POST | /v1/auth/login | – | Giriş |
| POST | /v1/auth/upgrade | JWT | Misafiri e-posta hesabına dönüştür |
| GET | /v1/auth/me | JWT | Mevcut kullanıcı |
| POST | /v1/records | JWT | `{digits: 3\|4\|5, attempts}` rekor kaydet |
| GET | /v1/records | JWT | Kendi rekorların |
| GET | /v1/leaderboard?digits=4 | – | Skor tablosu |
