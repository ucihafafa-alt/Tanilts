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

  const PROFILE_MEMBER = 'member';
  const PROFILE_MANAGED = 'team_managed';
  const MANAGED_DISCLOSURE = 'Энэ профайлын мессежийг ТАНИЛ багийн ажилтан бичиж болно.';

  let cachedUser = null;
  let publicProfileRows = [];
  let managedProfileRows = [];
  let unsubscribeProfiles = null;
  let unsubscribeManagedProfiles = null;
  let unsubscribeMyProfile = null;
  let chatUnsubscribe = null;
  let chatsUnsubscribe = null;
  let activeChat = null;
  let activeChatProfile = null;

  const phoneEmail = phone => `${String(phone || '').replace(/\D/g, '')}@tanil.app`;
  const cleanPhone = value => String(value || '').replace(/\D/g, '');
  const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
  const safe = value => typeof esc === 'function'
    ? esc(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function firebaseError(err) {
    console.error(err);
    const map = {
      'auth/email-already-in-use': 'Энэ утасны дугаар бүртгэлтэй байна.',
      'auth/invalid-credential': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/wrong-password': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/user-not-found': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/weak-password': 'PIN заавал 6 оронтой байна.',
      'auth/network-request-failed': 'Интернэт холболтоо шалгана уу.',
      'auth/operation-not-allowed': 'Firebase Authentication дээр Email/Password нэвтрэлтийг идэвхжүүлнэ үү.',
      'permission-denied': 'Энэ үйлдлийг хийх эрхгүй байна.'
    };
    return map[err?.code] || err?.message || 'Алдаа гарлаа. Дахин оролдоно уу.';
  }

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

  function profileKey(profile) {
    if (profile?.profileMode === PROFILE_MANAGED) return `managed:${profile.managedProfileId}`;
    return `member:${profile?.uid || ''}`;
  }

  function profileFromKey(key) {
    return profiles.find(p => profileKey(p) === String(key));
  }

  function rebuildProfiles() {
    for (let i = profiles.length - 1; i >= 0; i--) {
      if (profiles[i].fromFirebase === true) profiles.splice(i, 1);
    }
    const myUid = auth.currentUser?.uid;
    publicProfileRows.forEach(row => {
      if (row.uid === myUid) return;
      profiles.push({
        id: `member_${row.uid}`,
        uid: row.uid,
        profileMode: PROFILE_MEMBER,
        fromFirebase: true,
        name: row.name || 'Гишүүн',
        age: Number(row.age || 18),
        gender: row.gender || '',
        city: row.city || '',
        job: row.job || 'Мэдээлээгүй',
        goal: row.goal || '',
        interests: Array.isArray(row.interests) ? row.interests : ['Шинэ гишүүн'],
        status: row.status || 'Идэвхтэй',
        bio: row.bio || '',
        photos: [],
        userPhoto: row.photo || ''
      });
    });
    managedProfileRows.forEach(row => {
      profiles.push({
        id: `managed_${row.managedProfileId}`,
        managedProfileId: row.managedProfileId,
        profileMode: PROFILE_MANAGED,
        fromFirebase: true,
        name: row.name || 'ТАНИЛ хөтлөгч',
        age: Number(row.age || 18),
        gender: row.gender || '',
        city: row.city || '',
        job: row.job || 'ТАНИЛ багийн хөтлөгч',
        goal: row.goal || 'Найз нөхөрлөл',
        interests: Array.isArray(row.interests) ? row.interests : ['ТАНИЛ баг'],
        status: row.status || 'Идэвхтэй',
        bio: row.bio || '',
        photos: [],
        userPhoto: row.photo || '',
        disclosure: row.disclosure || MANAGED_DISCLOSURE
      });
    });
    if (!main.classList.contains('hidden')) performSearch();
  }

  function watchProfiles() {
    if (unsubscribeProfiles) unsubscribeProfiles();
    if (unsubscribeManagedProfiles) unsubscribeManagedProfiles();

    unsubscribeProfiles = db.collection('publicProfiles').limit(300).onSnapshot(snap => {
      publicProfileRows = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      rebuildProfiles();
    }, console.error);

    unsubscribeManagedProfiles = db.collection('managedProfiles').where('active', '==', true).limit(100).onSnapshot(snap => {
      managedProfileRows = snap.docs.map(doc => ({ managedProfileId: doc.id, ...doc.data() }));
      rebuildProfiles();
    }, console.error);
  }

  currentUser = () => cachedUser;
  usersDB = () => cachedUser ? [cachedUser] : [];
  saveUsers = () => {};
  syncUserProfiles = () => {};

  registerUser = async function () {
    const age = Number(myage.value);
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
        premium: false,
        status: 'Идэвхтэй',
        createdAt: serverTime(),
        updatedAt: serverTime()
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
        createdAt: serverTime(),
        updatedAt: serverTime()
      });
      await readMyProfile(uid);
      watchProfiles();
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
      watchMyProfile(credential.user.uid);
      watchProfiles();
      loginErr.textContent = '';
      startApp();
    } catch (err) {
      loginErr.textContent = firebaseError(err);
    }
  };

  logoutUser = async function () {
    if (chatUnsubscribe) chatUnsubscribe();
    if (chatsUnsubscribe) chatsUnsubscribe();
    if (unsubscribeProfiles) unsubscribeProfiles();
    if (unsubscribeManagedProfiles) unsubscribeManagedProfiles();
    if (unsubscribeMyProfile) unsubscribeMyProfile();
    await auth.signOut();
    cachedUser = null;
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
        watchProfiles();
        startApp();
      } catch (err) {
        console.error(err);
        showAuth('login');
      }
    });
  };

  forgotPin = async function () {
    const ph = cleanPhone(loginPhone.value);
    if (!/^\d{8}$/.test(ph)) return alert('Бүртгэлтэй утасны дугаараа оруулна уу.');
    try {
      await db.collection('pinResetRequests').add({ phone: ph, status: 'pending', createdAt: serverTime() });
      alert('PIN сэргээх хүсэлт админд илгээгдлээ.');
    } catch (err) {
      alert(firebaseError(err));
    }
  };

  submitPayment = async function () {
    const user = currentUser();
    const plan = plans.find(item => item.id === selectedPlan);
    if (!user || !plan) return alert('Багцаа сонгоно уу.');
    try {
      const existing = await db.collection('paymentRequests')
        .where('uid', '==', user.uid)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (existing.empty) {
        await db.collection('paymentRequests').add({
          uid: user.uid,
          phone: user.phone,
          planId: plan.id,
          planType: plan.type,
          duration: plan.duration,
          price: plan.price,
          status: 'pending',
          createdAt: serverTime()
        });
      }
      payContent.innerHTML = '<h2>Төлбөр шалгагдаж байна</h2><span class="state pending">ХҮЛЭЭГДЭЖ БУЙ</span><div class="notice" style="margin-top:12px">Админ таны утасны дугаараар гүйлгээг шалгаж зөвшөөрсний дараа эрх нээгдэнэ.</div><button class="btn secondary full" onclick="closeModal(\'payModal\')">Хаах</button>';
    } catch (err) {
      alert(firebaseError(err));
    }
  };

  showRequests = async function () {
    const user = currentUser();
    genericModal.classList.add('show');
    genericContent.innerHTML = '<h2>Миний төлбөрийн хүсэлт</h2><div class="notice">Уншиж байна...</div>';
    try {
      const snap = await db.collection('paymentRequests').where('uid', '==', user.uid).get();
      const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      genericContent.innerHTML = `<h2>Миний төлбөрийн хүсэлт</h2>${rows.length ? rows.map(row => `<div class="adminItem"><b>${safe(row.phone)}</b><br><span class="small">${safe(row.planType)} · ${safe(row.duration)} · ${money(row.price)}</span><br><span class="state ${safe(row.status)}">${row.status === 'pending' ? 'ХҮЛЭЭГДЭЖ БУЙ' : row.status === 'approved' ? 'ЭРХ ИДЭВХЖСЭН' : 'ТАТГАЛЗСАН'}</span></div>`).join('') : '<div class="notice">Одоогоор хүсэлт байхгүй.</div>'}<button class="btn secondary full" onclick="closeModal('genericModal')">Хаах</button>`;
    } catch (err) {
      genericContent.innerHTML = `<div class="notice">${safe(firebaseError(err))}</div>`;
    }
  };

  window.openProfileByKey = function (key) {
    const profile = profileFromKey(key);
    if (!profile) return alert('Профайл олдсонгүй.');
    selectedProfile = profile;
    slideIndex = 0;
    renderProfile();
    profileModal.classList.add('show');
  };

  cardHtml = function (profile) {
    const key = safe(profileKey(profile));
    const managed = profile.profileMode === PROFILE_MANAGED;
    return `<article class="card"><div class="photo"><img src="${safe(profileImg(profile))}"><span class="statusDot">${profile.status === 'Идэвхтэй' ? '● ' : ''}${safe(profile.status)}</span></div><div class="cardbody"><div class="name">${safe((profile.name || 'Г')[0])}••••, ${Number(profile.age || 18)}</div><div class="meta">${safe(profile.gender)} · ${safe(profile.city)}<br>${safe(profile.job)}</div>${managed ? '<span class="goal">ТАНИЛ багийн хөтлөгч</span>' : `<span class="goal">${safe(profile.goal)}</span>`}<div class="tags">${(profile.interests || []).slice(0, 2).map(item => `<span class="tag">${safe(item)}</span>`).join('')}</div><button class="open" onclick="openProfileByKey('${key}')">Профайл үзэх</button></div></article>`;
  };

  async function likeState(targetUid) {
    const me = auth.currentUser;
    if (!me || !targetUid) return false;
    const snap = await db.collection('likes').doc(`${me.uid}_${targetUid}`).get();
    return snap.exists;
  }

  window.toggleLike = async function (targetUid) {
    const me = auth.currentUser;
    if (!me) return alert('Эхлээд нэвтэрнэ үү.');
    if (!targetUid || targetUid === me.uid) return alert('Өөрийн профайлд лайк дарах боломжгүй.');
    const ref = db.collection('likes').doc(`${me.uid}_${targetUid}`);
    try {
      const snap = await ref.get();
      if (snap.exists) await ref.delete();
      else await ref.set({ fromUid: me.uid, toUid: targetUid, createdAt: serverTime() });
      renderProfile();
    } catch (err) {
      alert(firebaseError(err));
    }
  };

  renderProfile = async function () {
    const profile = selectedProfile;
    if (!profile) return;
    const managed = profile.profileMode === PROFILE_MANAGED;
    const targetUid = managed ? '' : profile.uid;
    const imgs = profile.userPhoto ? [profile.userPhoto] : (profile.photos || []).map(index => images[index]);
    const img = imgs[slideIndex] || profileImg(profile);
    const full = hasMembership();
    let liked = false;
    if (targetUid) {
      try { liked = await likeState(targetUid); } catch (_) {}
    }
    profileContent.innerHTML = `<div class="slider ${full ? '' : 'locked'}"><img src="${safe(img)}">${imgs.length > 1 ? `<button class="slideNav prev" onclick="changeSlide(-1)">‹</button><button class="slideNav next" onclick="changeSlide(1)">›</button>` : ''}</div><div class="dots">${imgs.map((_, index) => `<span class="dot ${index === slideIndex ? 'on' : ''}"></span>`).join('')}</div><h2 style="margin:5px 0">${full ? safe(profile.name) : safe((profile.name || 'Г')[0]) + '••••'}, ${Number(profile.age || 18)}</h2><div class="meta">${safe(profile.gender)} · ${safe(profile.city)} · ${safe(profile.job)} · ${safe(profile.status)}</div><p>${safe(profile.bio)}</p><span class="goal">${safe(profile.goal)}</span><div class="tags">${(profile.interests || []).map(item => `<span class="tag">${safe(item)}</span>`).join('')}</div>${managed ? `<div class="notice" style="margin-top:14px"><b>ТАНИЛ багийн удирдлагатай профайл</b><br>${safe(profile.disclosure || MANAGED_DISCLOSURE)}</div>` : ''}${targetUid ? `<button class="btn secondary full" onclick="toggleLike('${safe(targetUid)}')">${liked ? '♥ Таалагдсан' : '♡ Таалагдлаа'}</button>` : ''}${full ? '<button class="btn green full" onclick="openDirectChat()">Шууд чатлах</button>' : '<div class="notice" style="margin-top:14px">Бүтэн мэдээлэл болон чатлах эрх авахын тулд төлбөрөө шилжүүлж, админы зөвшөөрөл хүлээнэ.</div><button class="btn full" onclick="openPay()">Эрх авах</button>'}<button class="btn secondary full" onclick="closeModal('profileModal')">Хаах</button>`;
  };

  changeSlide = function (delta) {
    const profile = selectedProfile;
    const count = profile?.userPhoto ? 1 : Math.max(1, profile?.photos?.length || 1);
    slideIndex = (slideIndex + delta + count) % count;
    renderProfile();
  };

  function memberChatId(a, b) {
    return `member_${[a, b].sort().join('_')}`;
  }

  function managedChatId(userUid, managedProfileId) {
    return `managed_${managedProfileId}_${userUid}`;
  }

  function chatDefinition(meUid, profile) {
    if (profile.profileMode === PROFILE_MANAGED) {
      return {
        id: managedChatId(meUid, profile.managedProfileId),
        data: {
          mode: 'managed',
          memberUids: [meUid],
          managedProfileId: profile.managedProfileId,
          disclosureVersion: '2026-07-20'
        }
      };
    }
    return {
      id: memberChatId(meUid, profile.uid),
      data: {
        mode: 'member',
        memberUids: [meUid, profile.uid].sort()
      }
    };
  }

  async function resolveProfileForChat(chat) {
    if (chat.mode === 'managed') {
      let profile = profiles.find(item => item.profileMode === PROFILE_MANAGED && item.managedProfileId === chat.managedProfileId);
      if (profile) return profile;
      const snap = await db.collection('managedProfiles').doc(chat.managedProfileId).get();
      if (!snap.exists) return null;
      const row = snap.data();
      return {
        id: `managed_${snap.id}`,
        managedProfileId: snap.id,
        profileMode: PROFILE_MANAGED,
        name: row.name || 'ТАНИЛ хөтлөгч',
        age: Number(row.age || 18),
        gender: row.gender || '',
        city: row.city || '',
        job: row.job || 'ТАНИЛ багийн хөтлөгч',
        goal: row.goal || '',
        bio: row.bio || '',
        status: row.status || 'Идэвхтэй',
        interests: row.interests || [],
        userPhoto: row.photo || '',
        photos: [],
        disclosure: row.disclosure || MANAGED_DISCLOSURE
      };
    }
    const otherUid = (chat.memberUids || []).find(uid => uid !== auth.currentUser?.uid);
    if (!otherUid) return null;
    let profile = profiles.find(item => item.profileMode === PROFILE_MEMBER && item.uid === otherUid);
    if (profile) return profile;
    const snap = await db.collection('publicProfiles').doc(otherUid).get();
    if (!snap.exists) return null;
    const row = snap.data();
    return {
      id: `member_${otherUid}`,
      uid: otherUid,
      profileMode: PROFILE_MEMBER,
      name: row.name || 'Гишүүн',
      age: Number(row.age || 18),
      gender: row.gender || '',
      city: row.city || '',
      job: row.job || '',
      goal: row.goal || '',
      bio: row.bio || '',
      status: row.status || 'Идэвхтэй',
      interests: row.interests || [],
      userPhoto: row.photo || '',
      photos: []
    };
  }

  async function openChat(chatId, profile, createData = null) {
    const me = auth.currentUser;
    if (!me || !profile) return alert('Чат нээх боломжгүй байна.');
    if (!hasMembership()) return openPay();

    closeModal('profileModal');
    genericModal.classList.add('show');
    activeChatProfile = profile;
    activeChat = { id: chatId, mode: profile.profileMode === PROFILE_MANAGED ? 'managed' : 'member' };
    const chatRef = db.collection('chats').doc(chatId);

    if (createData) {
      try {
        // Шинэ чат дээр урьдчилж get() хийхэд Firestore-ийн read rule
        // байхгүй document-ийг уншихыг хориглож permission-denied өгдөг.
        // Merge set нь document байхгүй бол create, байвал зөвхөн updatedAt-ийг
        // шинэчилж, чатны оролцогчдыг өөрчлөхгүй.
        await chatRef.set({
          ...createData,
          updatedAt: serverTime()
        }, { merge: true });
      } catch (err) {
        return alert(firebaseError(err));
      }
    }

    const managedNotice = profile.profileMode === PROFILE_MANAGED
      ? `<div class="notice" style="margin:10px 0"><b>ТАНИЛ багийн удирдлагатай профайл</b><br>${safe(profile.disclosure || MANAGED_DISCLOSURE)}</div>`
      : '';
    genericContent.innerHTML = `<h2>${safe(profile.name)}, ${Number(profile.age || 18)}</h2><div class="meta">${safe(profile.gender)} · ${safe(profile.city)} · ${safe(profile.job)}</div>${managedNotice}<div id="chatbox" class="chat"><div class="small">Мессеж уншиж байна...</div></div><div style="display:flex;gap:8px;margin-top:10px"><input id="chatInput" class="field" maxlength="500" placeholder="Мессеж бичих..." onkeydown="if(event.key==='Enter')sendChatMessage()"><button class="btn" onclick="sendChatMessage()">Илгээх</button></div><button class="btn secondary full" onclick="closeTanilChat()">Хаах</button>`;

    if (chatUnsubscribe) chatUnsubscribe();
    chatUnsubscribe = chatRef.collection('messages').orderBy('createdAt', 'asc').limit(200).onSnapshot(snap => {
      const box = document.getElementById('chatbox');
      if (!box) return;
      box.innerHTML = snap.empty ? '<div class="small">Одоогоор мессеж алга.</div>' : snap.docs.map(doc => {
        const message = doc.data();
        const mine = message.senderType === 'user' && message.senderUid === me.uid;
        const senderName = mine ? 'Та' : profile.name;
        return `<div class="bubble ${mine ? 'mine' : ''}" style="margin-left:${mine ? '18%' : '0'};margin-right:${mine ? '0' : '18%'}"><b>${safe(senderName)}</b><br>${safe(message.text)}</div>`;
      }).join('');
      box.scrollTop = box.scrollHeight;
    }, err => {
      const box = document.getElementById('chatbox');
      if (box) box.innerHTML = `<div class="notice">${safe(firebaseError(err))}</div>`;
    });

    try { await chatRef.update({ userUnread: false }); } catch (_) {}
  }

  window.openDirectChat = async function () {
    const me = auth.currentUser;
    const profile = selectedProfile;
    if (!me || !profile) return alert('Чат нээх боломжгүй байна.');
    if (profile.profileMode === PROFILE_MEMBER && profile.uid === me.uid) return alert('Өөртэйгөө чатлах боломжгүй.');
    const definition = chatDefinition(me.uid, profile);
    await openChat(definition.id, profile, definition.data);
  };

  window.sendChatMessage = async function () {
    const me = auth.currentUser;
    const input = document.getElementById('chatInput');
    const text = String(input?.value || '').trim();
    if (!me || !activeChat?.id || !text) return;
    if (!hasMembership()) return alert('Чатлах эрх идэвхгүй байна.');
    input.value = '';
    try {
      const chatRef = db.collection('chats').doc(activeChat.id);
      await chatRef.collection('messages').add({
        senderType: 'user',
        senderUid: me.uid,
        text: text.slice(0, 500),
        createdAt: serverTime()
      });
      await chatRef.update({
        updatedAt: serverTime(),
        lastMessage: text.slice(0, 120),
        lastSenderType: 'user',
        adminUnread: activeChat.mode === 'managed',
        userUnread: false
      });
    } catch (err) {
      input.value = text;
      alert(firebaseError(err));
    }
  };

  window.closeTanilChat = function () {
    if (chatUnsubscribe) {
      chatUnsubscribe();
      chatUnsubscribe = null;
    }
    activeChat = null;
    activeChatProfile = null;
    closeModal('genericModal');
  };

  window.showMyChats = function () {
    const me = auth.currentUser;
    if (!me) return alert('Эхлээд нэвтэрнэ үү.');
    genericModal.classList.add('show');
    genericContent.innerHTML = '<h2>Миний чат</h2><div class="notice">Уншиж байна...</div>';
    if (chatsUnsubscribe) chatsUnsubscribe();
    chatsUnsubscribe = db.collection('chats').where('memberUids', 'array-contains', me.uid).limit(100).onSnapshot(async snap => {
      const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      const resolved = await Promise.all(rows.map(async chat => ({ chat, profile: await resolveProfileForChat(chat) })));
      genericContent.innerHTML = `<h2>Миний чат</h2>${resolved.length ? resolved.map(({ chat, profile }) => {
        if (!profile) return '';
        const managed = chat.mode === 'managed';
        return `<div class="adminItem" onclick="openChatById('${safe(chat.id)}')" style="cursor:pointer"><b>${safe(profile.name)}</b>${managed ? '<br><span class="small">ТАНИЛ багийн удирдлагатай профайл</span>' : ''}<br><span class="small">${safe(chat.lastMessage || 'Одоогоор мессеж алга.')}</span>${chat.userUnread ? '<br><span class="state approved">ШИНЭ МЕССЕЖ</span>' : ''}</div>`;
      }).join('') : '<div class="notice">Одоогоор чат байхгүй.</div>'}<button class="btn secondary full" onclick="closeMyChats()">Хаах</button>`;
    }, err => {
      genericContent.innerHTML = `<div class="notice">${safe(firebaseError(err))}</div>`;
    });
  };

  window.openChatById = async function (chatId) {
    try {
      const snap = await db.collection('chats').doc(chatId).get();
      if (!snap.exists) return alert('Чат олдсонгүй.');
      const chat = { id: snap.id, ...snap.data() };
      const profile = await resolveProfileForChat(chat);
      if (!profile) return alert('Профайл олдсонгүй.');
      if (chatsUnsubscribe) {
        chatsUnsubscribe();
        chatsUnsubscribe = null;
      }
      await openChat(chat.id, profile, null);
    } catch (err) {
      alert(firebaseError(err));
    }
  };

  window.closeMyChats = function () {
    if (chatsUnsubscribe) {
      chatsUnsubscribe();
      chatsUnsubscribe = null;
    }
    closeModal('genericModal');
  };

  openAdmin = function () {
    location.href = 'admin.html';
  };

  initAuth();
})();
