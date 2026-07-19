(() => {
  'use strict';
  const cfg = window.TANIL_FIREBASE_CONFIG || {};
  const configured = cfg.apiKey && !String(cfg.apiKey).startsWith('PASTE_');
  if (!configured) {
    console.warn('Firebase тохиргоо оруулаагүй байна. firebase-config.js файлыг бөглөнө үү.');
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  let cachedUser = null;
  let unsubscribeProfiles = null;
  let unsubscribeMyProfile = null;

  const phoneEmail = phone => `${String(phone).replace(/\D/g, '')}@tanil.app`;
  const cleanPhone = value => String(value || '').replace(/\D/g, '');
  const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
  const escSafe = text => typeof esc === 'function' ? esc(String(text ?? '')) : String(text ?? '');

  async function compressProfileImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 720;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.76;
        let out = canvas.toDataURL('image/jpeg', quality);
        while (out.length > 620000 && quality > 0.38) {
          quality -= 0.08;
          out = canvas.toDataURL('image/jpeg', quality);
        }
        if (out.length > 850000) return reject(new Error('Зургийн хэмжээ хэт том байна. Өөр зураг сонгоно уу.'));
        resolve(out);
      };
      img.onerror = () => reject(new Error('Зургийг боловсруулах боломжгүй байна.'));
      img.src = dataUrl;
    });
  }

  function firebaseError(err) {
    console.error(err);
    const map = {
      'auth/email-already-in-use': 'Энэ утасны дугаар бүртгэлтэй байна.',
      'auth/invalid-credential': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/wrong-password': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/user-not-found': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/weak-password': 'PIN заавал 6 оронтой байна.',
      'auth/network-request-failed': 'Интернэт холболтоо шалгана уу.',
      'auth/operation-not-allowed': 'Firebase дээр Email/Password нэвтрэлтийг идэвхжүүлнэ үү.'
    };
    return map[err?.code] || err?.message || 'Алдаа гарлаа. Дахин оролдоно уу.';
  }

  function applyMyProfile(uid, data) {
    cachedUser = data ? { uid, ...data } : null;
    if (cachedUser) {
      localStorage.setItem('tanilUser', JSON.stringify(cachedUser));
      localStorage.setItem('tanilSessionPhone', cachedUser.phone || '');
      if (typeof updateMembershipBar === 'function' && !main.classList.contains('hidden')) updateMembershipBar();
    }
    return cachedUser;
  }

  async function readMyProfile(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return applyMyProfile(uid, snap.exists ? snap.data() : null);
  }

  function watchMyProfile(uid) {
    if (unsubscribeMyProfile) unsubscribeMyProfile();
    unsubscribeMyProfile = db.collection('users').doc(uid).onSnapshot(snap => {
      applyMyProfile(uid, snap.exists ? snap.data() : null);
    }, console.error);
  }

  currentUser = function () { return cachedUser; };
  usersDB = function () { return cachedUser ? [cachedUser] : []; };
  saveUsers = function () {};

  registerUser = async function () {
    const age = +myage.value;
    const pin = myPin.value.trim();
    const ph = cleanPhone(phone.value);
    if (!myname.value.trim() || !/^\d{8}$/.test(ph) || !/^\d{6}$/.test(pin) || age < 18 || age > 80 || !mygender.value || !mycity.value || !mygoal.value || !signupPhotoData || !agree.checked) {
      regerr.textContent = 'Бүх мэдээллээ бөглөж, 6 оронтой PIN болон профайл зургаа оруулна уу.';
      return;
    }
    regerr.textContent = 'Бүртгэл үүсгэж байна...';
    let credential;
    try {
      credential = await auth.createUserWithEmailAndPassword(phoneEmail(ph), pin);
      const uid = credential.user.uid;
      const photoURL = await compressProfileImage(signupPhotoData);
      const data = {
        phone: ph,
        name: myname.value.trim(),
        age,
        gender: mygender.value,
        city: mycity.value,
        job: myjob.value.trim() || 'Мэдээлээгүй',
        goal: mygoal.value,
        bio: mybio.value.trim() || 'Танилцаж, ярилцах хүсэлтэй.',
        photo: photoURL,
        membershipUntil: 0,
        status: 'Идэвхтэй',
        createdAt: serverTime()
      };
      await db.collection('users').doc(uid).set(data);
      await db.collection('publicProfiles').doc(uid).set({
        name: data.name,
        age: data.age,
        gender: data.gender,
        city: data.city,
        job: data.job,
        goal: data.goal,
        bio: data.bio,
        photo: data.photo,
        status: data.status,
        createdAt: serverTime()
      });
      await readMyProfile(uid);
      await loadFirebaseProfiles();
      regerr.textContent = '';
      startApp();
    } catch (err) {
      if (credential?.user) {
        try { await credential.user.delete(); } catch (_) {}
      }
      regerr.textContent = firebaseError(err);
    }
  };

  loginUser = async function () {
    const ph = cleanPhone(loginPhone.value);
    const pin = loginPin.value.trim();
    if (!/^\d{8}$/.test(ph) || !/^\d{6}$/.test(pin)) {
      loginErr.textContent = '8 оронтой утас, 6 оронтой PIN оруулна уу.';
      return;
    }
    loginErr.textContent = 'Нэвтэрч байна...';
    try {
      const credential = await auth.signInWithEmailAndPassword(phoneEmail(ph), pin);
      await readMyProfile(credential.user.uid);
      await loadFirebaseProfiles();
      loginErr.textContent = '';
      startApp();
    } catch (err) {
      loginErr.textContent = firebaseError(err);
    }
  };

  logoutUser = async function () {
    await auth.signOut();
    cachedUser = null;
    if (unsubscribeMyProfile) { unsubscribeMyProfile(); unsubscribeMyProfile = null; }
    localStorage.removeItem('tanilSessionPhone');
    localStorage.removeItem('tanilUser');
    location.reload();
  };

  initAuth = function () {
    register.classList.remove('hidden');
    main.classList.add('hidden');
    nav.classList.add('hidden');
    auth.onAuthStateChanged(async user => {
      if (!user) {
        cachedUser = null;
        showAuth('login');
        return;
      }
      try {
        await readMyProfile(user.uid);
        watchMyProfile(user.uid);
        await loadFirebaseProfiles();
        startApp();
      } catch (err) {
        console.error(err);
        showAuth('login');
      }
    });
  };

  async function loadFirebaseProfiles() {
    if (unsubscribeProfiles) unsubscribeProfiles();
    return new Promise((resolve, reject) => {
      unsubscribeProfiles = db.collection('publicProfiles').orderBy('createdAt', 'desc').limit(300)
        .onSnapshot(snap => {
          for (let i = profiles.length - 1; i >= 0; i--) {
            if (profiles[i].isRealUser) profiles.splice(i, 1);
          }
          snap.forEach(doc => {
            const u = doc.data();
            profiles.push({
              id: `fb_${doc.id}`,
              uid: doc.id,
              name: u.name || 'Гишүүн', age: Number(u.age || 18), gender: u.gender || '',
              city: u.city || '', job: u.job || 'Мэдээлээгүй', goal: u.goal || '',
              interests: ['Шинэ гишүүн'], status: u.status || 'Идэвхтэй', bio: u.bio || '',
              photos: [], userPhoto: u.photo || '', isRealUser: true
            });
          });
          if (!main.classList.contains('hidden')) performSearch();
          resolve();
        }, reject);
    });
  }
  syncUserProfiles = function () {};

  forgotPin = async function () {
    const ph = cleanPhone(loginPhone.value);
    if (!/^\d{8}$/.test(ph)) return alert('Бүртгэлтэй утасны дугаараа оруулна уу.');
    try {
      await db.collection('pinResetRequests').add({ phone: ph, status: 'pending', createdAt: serverTime() });
      alert('PIN сэргээх хүсэлт админд илгээгдлээ.');
    } catch (err) { alert(firebaseError(err)); }
  };

  submitPayment = async function () {
    const u = currentUser();
    const plan = plans.find(x => x.id === selectedPlan);
    if (!u || !plan) return alert('Багцаа сонгоно уу.');
    try {
      const existing = await db.collection('paymentRequests')
        .where('uid', '==', u.uid).where('status', '==', 'pending').limit(1).get();
      if (existing.empty) {
        await db.collection('paymentRequests').add({
          uid: u.uid, phone: u.phone, planId: plan.id, planType: plan.type,
          duration: plan.duration, price: plan.price, status: 'pending', createdAt: serverTime()
        });
      }
      payContent.innerHTML = '<h2>Төлбөр шалгагдаж байна</h2><span class="state pending">ХҮЛЭЭГДЭЖ БУЙ</span><div class="notice" style="margin-top:12px">Админ таны утасны дугаараар гүйлгээг шалгаж зөвшөөрсний дараа эрх нээгдэнэ.</div><button class="btn secondary full" onclick="closeModal(\'payModal\')">Хаах</button>';
    } catch (err) { alert(firebaseError(err)); }
  };

  showRequests = async function () {
    const u = currentUser();
    genericModal.classList.add('show');
    genericContent.innerHTML = '<h2>Миний төлбөрийн хүсэлт</h2><div class="notice">Уншиж байна...</div>';
    try {
      const snap = await db.collection('paymentRequests').where('uid', '==', u.uid).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      genericContent.innerHTML = `<h2>Миний төлбөрийн хүсэлт</h2>${rows.length ? rows.map(r => `<div class="adminItem"><b>${escSafe(r.phone)}</b><br><span class="small">${escSafe(r.planType)} · ${escSafe(r.duration)} · ${money(r.price)}</span><br><span class="state ${r.status}">${r.status==='pending'?'ХҮЛЭЭГДЭЖ БУЙ':r.status==='approved'?'ЭРХ ИДЭВХЖСЭН':'ТАТГАЛЗСАН'}</span></div>`).join('') : '<div class="notice">Одоогоор хүсэлт байхгүй.</div>'}<button class="btn secondary full" onclick="closeModal('genericModal')">Хаах</button>`;
    } catch (err) { genericContent.innerHTML = `<div class="notice">${escSafe(firebaseError(err))}</div>`; }
  };

  async function isAdmin(uid) {
    const snap = await db.collection('admins').doc(uid).get();
    return snap.exists && snap.data().active === true;
  }

  openAdmin = function () {
    genericContent.innerHTML = '<h2>Админ нэвтрэх</h2><input id="adminPhone" class="field" inputmode="numeric" placeholder="Админ утас"><input id="adminPin" class="field" type="password" inputmode="numeric" placeholder="6 оронтой PIN"><button class="btn full" onclick="adminLogin()">Нэвтрэх</button>';
    genericModal.classList.add('show');
  };

  adminLogin = async function () {
    try {
      const credential = await auth.signInWithEmailAndPassword(phoneEmail(cleanPhone(adminPhone.value)), adminPin.value.trim());
      if (!(await isAdmin(credential.user.uid))) throw new Error('Энэ бүртгэл админ эрхгүй байна.');
      await readMyProfile(credential.user.uid);
      await renderAdmin();
    } catch (err) { alert(firebaseError(err)); }
  };

  renderAdmin = async function () {
    genericContent.innerHTML = '<h2>Төлбөрийн хүсэлтүүд</h2><div class="notice">Уншиж байна...</div>';
    try {
      if (!auth.currentUser || !(await isAdmin(auth.currentUser.uid))) throw new Error('Админ эрхгүй байна.');
      const [paySnap, pinSnap] = await Promise.all([
        db.collection('paymentRequests').orderBy('createdAt','desc').limit(200).get(),
        db.collection('pinResetRequests').where('status','==','pending').limit(100).get()
      ]);
      const reqs = paySnap.docs.map(d => ({id:d.id,...d.data()}));
      const pins = pinSnap.docs.map(d => ({id:d.id,...d.data()}));
      genericContent.innerHTML = `<h2>Төлбөрийн хүсэлтүүд</h2><div class="notice">Админд хэрэглэгч зөвхөн утасны дугаараар харагдана.</div>${reqs.length ? reqs.map(r => `<div class="adminItem"><b>📱 ${escSafe(r.phone)}</b><br><span class="small">${escSafe(r.duration)} · ${money(r.price)}</span><br><span class="state ${r.status}">${r.status==='pending'?'ХҮЛЭЭГДЭЖ БУЙ':r.status==='approved'?'ЗӨВШӨӨРСӨН':'ТАТГАЛЗСАН'}</span>${r.status==='pending'?`<div style="display:flex;gap:8px"><button class="btn green full" onclick="setReqStatus('${r.id}','approved')">Зөвшөөрөх</button><button class="btn red full" onclick="setReqStatus('${r.id}','rejected')">Татгалзах</button></div>`:''}</div>`).join('') : '<div class="notice">Төлбөрийн хүсэлт алга.</div>'}<h3>PIN сэргээх хүсэлт</h3>${pins.length ? pins.map(x => `<div class="adminItem"><b>📱 ${escSafe(x.phone)}</b><br><span class="small">Firebase Authentication дээр тухайн хэрэглэгчийн PIN-ийг админ өөрчилнө.</span></div>`).join('') : '<div class="small">Хүсэлт алга.</div>'}`;
    } catch (err) { genericContent.innerHTML = `<div class="notice">${escSafe(firebaseError(err))}</div>`; }
  };

  setReqStatus = async function (id, status) {
    try {
      if (!auth.currentUser || !(await isAdmin(auth.currentUser.uid))) throw new Error('Админ эрхгүй байна.');
      const ref = db.collection('paymentRequests').doc(id);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Хүсэлт олдсонгүй.');
        const r = snap.data();
        tx.update(ref, { status, reviewedAt: serverTime(), reviewedBy: auth.currentUser.uid });
        if (status === 'approved') {
          const userRef = db.collection('users').doc(r.uid);
          const userSnap = await tx.get(userRef);
          const oldUntil = Number(userSnap.data()?.membershipUntil || 0);
          const start = Math.max(Date.now(), oldUntil);
          tx.update(userRef, { membershipUntil: start + durationDays(r.planId) * 86400000 });
        }
      });
      await readMyProfile(auth.currentUser.uid);
      await renderAdmin();
    } catch (err) { alert(firebaseError(err)); }
  };

  // Original page initAuth() already ran before this file loaded. Re-run using Firebase.
  initAuth();
})();

/* ===== TANIL Firebase нэмэлт боломжууд: Like + Chat ===== */
(() => {
  'use strict';
  if (!window.firebase || !firebase.apps.length) return;
  const auth = firebase.auth();
  const db = firebase.firestore();
  let chatUnsubscribe = null;
  let activeChatTarget = null;

  const safe = (v) => typeof esc === 'function' ? esc(String(v ?? '')) : String(v ?? '')
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const profileKey = p => String(p?.uid || p?.id || '');
  const chatIdFor = (a,b) => [a,b].sort().join('_');

  window.openProfileByKey = function(key) {
    const p = profiles.find(x => profileKey(x) === String(key));
    if (!p) return alert('Профайл олдсонгүй.');
    selectedProfile = p;
    slideIndex = 0;
    renderProfile();
    profileModal.classList.add('show');
  };

  // Firebase профайлын string id-г зөв нээдэг карт.
  cardHtml = function(p) {
    const key = safe(profileKey(p));
    return `<article class="card"><div class="photo"><img src="${profileImg(p)}"><span class="statusDot">${p.status==='Идэвхтэй'?'● ':''}${safe(p.status)}</span></div><div class="cardbody"><div class="name">${safe((p.name||'Г')[0])}••••, ${Number(p.age||18)}</div><div class="meta">${safe(p.gender)} · ${safe(p.city)}<br>${safe(p.job)}</div><span class="goal">${safe(p.goal)}</span><div class="tags">${(p.interests||[]).slice(0,2).map(x=>`<span class="tag">${safe(x)}</span>`).join('')}</div><button class="open" onclick="openProfileByKey('${key}')">Профайл үзэх</button></div></article>`;
  };

  async function likeState(targetUid) {
    const me = auth.currentUser;
    if (!me || !targetUid) return false;
    const snap = await db.collection('likes').doc(`${me.uid}_${targetUid}`).get();
    return snap.exists;
  }

  window.toggleLike = async function(targetUid) {
    const me = auth.currentUser;
    if (!me) return alert('Эхлээд нэвтэрнэ үү.');
    if (!targetUid || targetUid === me.uid) return alert('Өөрийн профайлд лайк дарах боломжгүй.');
    const ref = db.collection('likes').doc(`${me.uid}_${targetUid}`);
    try {
      const snap = await ref.get();
      if (snap.exists) await ref.delete();
      else await ref.set({ fromUid: me.uid, toUid: targetUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      renderProfile();
    } catch (e) { alert(e.message || 'Лайк хадгалахад алдаа гарлаа.'); }
  };

  const baseRenderProfile = renderProfile;
  renderProfile = async function() {
    const p = selectedProfile;
    if (!p) return;
    const targetUid = p.uid || '';
    const imgs = p.userPhoto ? [p.userPhoto] : (p.photos||[]).map(i=>images[i]);
    const img = imgs[slideIndex] || profileImg(p);
    const full = hasMembership();
    let liked = false;
    try { liked = await likeState(targetUid); } catch (_) {}
    profileContent.innerHTML = `<div class="slider ${full?'':'locked'}"><img src="${img}">${imgs.length>1?`<button class="slideNav prev" onclick="changeSlide(-1)">‹</button><button class="slideNav next" onclick="changeSlide(1)">›</button>`:''}</div><div class="dots">${imgs.map((_,i)=>`<span class="dot ${i===slideIndex?'on':''}"></span>`).join('')}</div><h2 style="margin:5px 0">${full?safe(p.name):(p.name||'Г')[0]+'••••'}, ${Number(p.age||18)}</h2><div class="meta">${safe(p.gender)} · ${safe(p.city)} · ${safe(p.job)} · ${safe(p.status)}</div><p>${safe(p.bio)}</p><span class="goal">${safe(p.goal)}</span><div class="tags">${(p.interests||[]).map(x=>`<span class="tag">${safe(x)}</span>`).join('')}</div>${targetUid?`<button class="btn secondary full" onclick="toggleLike('${safe(targetUid)}')">${liked?'♥ Таалагдсан':'♡ Таалагдлаа'}</button>`:''}${full?`<button class="btn green full" onclick="openDirectChat()">Шууд чатлах</button>`:`<div class="notice" style="margin-top:14px">Бүтэн мэдээлэл болон чатлах эрх авахын тулд төлбөрөө шилжүүлж, админы зөвшөөрөл хүлээнэ.</div><button class="btn full" onclick="openPay()">Эрх авах</button>`}<button class="btn secondary full" onclick="closeModal('profileModal')">Хаах</button>`;
  };

  window.openDirectChat = async function() {
    const me = auth.currentUser;
    const p = selectedProfile;
    if (!me || !p?.uid) return alert('Чат нээх боломжгүй байна.');
    if (!hasMembership()) return openPay();
    if (p.uid === me.uid) return alert('Өөртэйгөө чатлах боломжгүй.');
    closeModal('profileModal');
    genericModal.classList.add('show');
    activeChatTarget = p;
    const chatId = chatIdFor(me.uid, p.uid);
    const chatRef = db.collection('chats').doc(chatId);
    try {
      await chatRef.set({ members:[me.uid,p.uid].sort(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    } catch (_) {}
    genericContent.innerHTML = `<h2>${safe(p.name)}, ${Number(p.age||18)}</h2><div class="meta">${safe(p.gender)} · ${safe(p.city)} · ${safe(p.job)}</div><div id="chatbox" class="chat"><div class="small">Мессеж уншиж байна...</div></div><div style="display:flex;gap:8px;margin-top:10px"><input id="chatInput" class="field" maxlength="500" placeholder="Мессеж бичих..." onkeydown="if(event.key==='Enter')sendChatMessage()"><button class="btn" onclick="sendChatMessage()">Илгээх</button></div><button class="btn secondary full" onclick="closeTanilChat()">Хаах</button>`;
    if (chatUnsubscribe) chatUnsubscribe();
    chatUnsubscribe = chatRef.collection('messages').orderBy('createdAt','asc').limit(200).onSnapshot(snap => {
      const box = document.getElementById('chatbox');
      if (!box) return;
      box.innerHTML = snap.empty ? '<div class="small">Одоогоор мессеж алга.</div>' : snap.docs.map(d => {
        const m = d.data();
        const mine = m.senderUid === me.uid;
        return `<div class="bubble" style="margin-left:${mine?'18%':'0'};margin-right:${mine?'0':'18%'};opacity:${mine?'1':'.9'}"><b>${mine?'Та':safe(p.name)}</b><br>${safe(m.text)}</div>`;
      }).join('');
      box.scrollTop = box.scrollHeight;
    }, e => { const box=document.getElementById('chatbox'); if(box) box.innerHTML=`<div class="notice">${safe(e.message)}</div>`; });
  };

  window.sendChatMessage = async function() {
    const me = auth.currentUser;
    const input = document.getElementById('chatInput');
    const text = String(input?.value || '').trim();
    if (!me || !activeChatTarget?.uid || !text) return;
    if (!hasMembership()) return alert('Чатлах эрх идэвхгүй байна.');
    const chatId = chatIdFor(me.uid, activeChatTarget.uid);
    input.value = '';
    try {
      const ref = db.collection('chats').doc(chatId);
      await ref.set({ members:[me.uid,activeChatTarget.uid].sort(), updatedAt:firebase.firestore.FieldValue.serverTimestamp(), lastMessage:text.slice(0,120) }, {merge:true});
      await ref.collection('messages').add({ senderUid:me.uid, text:text.slice(0,500), createdAt:firebase.firestore.FieldValue.serverTimestamp() });
    } catch (e) { alert(e.message || 'Мессеж илгээхэд алдаа гарлаа.'); }
  };

  window.closeTanilChat = function() {
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    activeChatTarget = null;
    closeModal('genericModal');
  };
})();
