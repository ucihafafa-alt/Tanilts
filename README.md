# ТАНИЛ — Firebase + Админ самбар

GitHub repository-ийн үндсэн хэсэгт бүх файлыг upload хийнэ.

Админ хуудас:

`https://ucihafafa-alt.github.io/Tanilts/admin.html`

Админ эрх үүсгэх:

1. Firebase Authentication → Users дээр өөрийн User UID-г хуул.
2. Firestore Data үндсэн түвшинд `admins` collection үүсгэнэ.
3. Document ID = тухайн User UID.
4. `active` талбар: boolean, `true`.
5. Firestore Rules дээр энэ багцын `firestore.rules` кодыг Publish хийнэ.
