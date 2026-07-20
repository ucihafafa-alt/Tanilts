# ТАНИЛ — Firebase чат + админ операторын inbox

Энэ хувилбар нь дараах хоёр сувгийг тусад нь хэрэгжүүлнэ.

1. **Гишүүн ↔ гишүүн чат** — хоёр жинхэнэ бүртгэлтэй хэрэглэгч хоорондоо шууд харилцана. Админ энэ чатад нэвтрэх, хэрэглэгчийн өмнөөс бичих эрхгүй.
2. **Гишүүн ↔ ТАНИЛ багийн удирдлагатай профайл** — админ самбарын оператор тухайн профайлын нэрээр хариулж болно. Хэрэглэгчийн профайл болон чатны толгой хэсэгт энэ нөхцөл ил тод харагдана.

## Шинэчлэгдсэн файлууд

- `index.html` — хуурамч статик профайл болон санамсаргүй автомат хариултыг устгасан; Firestore профайл, чат, “Миний чат” цэс ашиглана.
- `firebase-bridge.js` — Firebase Authentication, хэрэглэгчийн профайл, төлбөр, лайк, гишүүн хоорондын чат, удирдлагатай профайлын чат.
- `admin.html` — төлбөр, PIN хүсэлт, удирдлагатай профайл үүсгэх, операторын real-time inbox.
- `firestore.rules` — хэрэглэгчийн эрх, админы эрх, чатны хоёр төрлийг тусгаарласан дүрэм.
- `storage.rules` — хэрэглэгч зөвхөн өөрийн зургийн замд зураг upload хийх дүрэм.
- `firebase-config.js` — одоогийн Firebase төслийн тохиргоо.

## Суулгах

1. Эдгээр файлыг GitHub repository-ийн үндсэн хэсэгт upload хийнэ.
2. Firebase Console → Authentication → Sign-in method → **Email/Password**-ийг идэвхжүүлнэ.
3. Firebase Console → Firestore Database → Rules хэсэгт `firestore.rules`-ийн агуулгыг Publish хийнэ.
4. Firebase Console → Storage → Rules хэсэгт `storage.rules`-ийн агуулгыг Publish хийнэ.
5. GitHub Pages-ээ дахин deploy хийнэ.

Админ хуудас:

`https://ucihafafa-alt.github.io/Tanilts/admin.html`

## Админ эрх үүсгэх

1. Энгийн хэрэглэгчийн бүртгэл үүсгэнэ.
2. Firebase Authentication → Users хэсгээс тухайн бүртгэлийн UID-г хуулна.
3. Firestore-ийн үндсэн түвшинд `admins` collection үүсгэнэ.
4. Document ID-г тухайн UID болгоно.
5. `active` нэртэй boolean талбарыг `true` болгоно.

## Удирдлагатай профайл үүсгэх

1. `admin.html` руу админ бүртгэлээр нэвтэрнэ.
2. “Удирдлагатай профайл үүсгэх” хэсгийн мэдээлэл, зургийг оруулна.
3. Үүссэн профайл `managedProfiles` collection-д хадгалагдана.
4. Хэрэглэгч тухайн профайл дээр чат эхлүүлэхэд `chats/{chatId}` болон `messages` дэд collection үүснэ.
5. Админ “Операторын чат inbox”-оос хариу бичнэ.

## Firestore бүтэц

```text
users/{uid}
publicProfiles/{uid}
managedProfiles/{profileId}
admins/{uid}
likes/{fromUid_toUid}
chats/{chatId}
  messages/{messageId}
paymentRequests/{requestId}
pinResetRequests/{requestId}
```

### Удирдлагатай чат

```js
{
  mode: "managed",
  memberUids: ["USER_UID"],
  managedProfileId: "PROFILE_ID",
  disclosureVersion: "2026-07-20",
  updatedAt: Timestamp,
  lastMessage: "...",
  adminUnread: true,
  userUnread: false
}
```

Операторын мессеж:

```js
{
  senderType: "managed_profile",
  senderProfileId: "PROFILE_ID",
  text: "Сайн байна уу...",
  createdAt: Timestamp
}
```

Хэрэглэгчийн мессеж:

```js
{
  senderType: "user",
  senderUid: "USER_UID",
  text: "Сайн уу...",
  createdAt: Timestamp
}
```

## Аюулгүй байдлын гол нөхцөл

- Админ зөвхөн `mode == "managed"` чат уншиж, удирдлагатай профайлын өмнөөс хариулна.
- Админ гишүүн ↔ гишүүн чатыг унших эсвэл тэдний өмнөөс мессеж бичих эрхгүй.
- Хэрэглэгч өөрийн `membershipUntil`, `premium` талбарыг өөрөө нэмэгдүүлэх боломжгүй.
- Төлбөрийн багцын ID болон үнэ Firestore Rules дээр баталгаажна.
- Мессеж засах, устгахыг хориглосон.
- Хуучин `localStorage` автомат хариулт болон кодонд бичсэн админ PIN урсгалыг идэвхгүй болгосон.

## PIN сэргээх

Одоогийн client-only хувилбарт админ Firebase Authentication хэрэглэгчийн нууц үгийг браузераас шууд өөрчлөх боломжгүй. PIN хүсэлтийг `admin.html` дээр харж, Firebase Console → Authentication → Users хэсгээс гараар шинэчилнэ. Production хувилбарт Firebase Admin SDK бүхий Cloud Function ашиглах нь зөв.
