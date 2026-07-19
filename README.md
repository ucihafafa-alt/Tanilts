# ТАНИЛ — Firebase холболттой хувилбар

## GitHub-д оруулах
ZIP-ийг задлаад дараах файлуудыг `Tanilts` repository-ийн үндсэн хэсэгт upload хийнэ:

- `index.html`
- `firebase-config.js`
- `firebase-bridge.js`
- `.nojekyll`

ZIP файлыг өөрийг нь GitHub-д бүү оруул.

## Firebase дээр хийх 2 тохиргоо

### 1. Firestore дүрэм
Firebase Console → Firestore Database → Rules руу орж `firestore.rules` файлын бүх агуулгыг хуулж тавиад **Publish** дар.

### 2. GitHub домэйн зөвшөөрөх
Firebase Console → Authentication → Settings → Authorized domains → Add domain:

`ucihafafa-alt.github.io`

## Ашиглалт
- Бүртгэл: 8 оронтой утас + 6 оронтой PIN
- Нэвтрэлт: өөр утас, өөр browser-оос ажиллана
- Профайл зураг: жижигрүүлэгдээд Firestore-д хадгалагдана
- Firebase Storage шаардлагагүй

Анхаар: хуучин localStorage бүртгэл Firebase рүү автоматаар шилжихгүй. Шинэ хувилбар тавьсны дараа дахин бүртгүүлнэ.
