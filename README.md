# ТАНИЛ — Firebase шинэчилсэн хувилбар

Энэ хувилбарт:
- Firebase бүртгэл ба утас + 6 оронтой PIN нэвтрэлт
- Бүх төхөөрөмжөөс нэвтрэх
- Профайл хайлт
- Like
- Premium эрхтэй Firebase чат
- Төлбөрийн хүсэлт
- Админ төлбөр баталгаажуулалт
- PIN сэргээх хүсэлт

## GitHub-д оруулах
ZIP-ийг задлаад доторх файлуудыг `Tanilts` repository-ийн үндсэн хэсэгт upload хийнэ. Ижил нэртэй файлууд автоматаар шинэчлэгдэнэ.

## Firestore Rules
Firebase Console → Firestore Database → Rules хэсэгт `firestore.rules` файлын агуулгыг тавиад Publish дар.

## Анхаарах зүйл
Админ ажиллуулахын тулд Firestore-ийн `admins` collection-д админы Firebase UID нэртэй document үүсгэж `active: true` boolean field нэмэх шаардлагатай.
