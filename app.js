(() => {
  'use strict';

  const cfg = window.TANIL_FIREBASE_CONFIG || {};
  if (!cfg.apiKey) {
    alert('Firebase тохиргоо олдсонгүй.');
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FV = firebase.firestore.FieldValue;
  const $ = id => document.getElementById(id);
  const phoneEmail = p => `${String(p || '').replace(/\D/g, '')}@tanil.app`;
  const cleanPhone = p => String(p || '').replace(/\D/g, '');
  const serverTime = () => FV.serverTimestamp();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = value => {
    try {
      const d = value?.toDate ? value.toDate() : new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('mn-MN');
    } catch { return ''; }
  };
  const money = n => `${new Intl.NumberFormat('mn-MN').format(Number(n || 0))}₮`;

  const DEFAULT_SETTINGS = {
    regularPrice: 20000,
    urgentPrice: 40000,
    promoLimit: 100,
    promoOpen: true,
    bankName: 'Банкны мэдээллийг админ оруулна',
    bankAccount: '',
    bankHolder: ''
  };
  const GOALS = {
    family: 'Гэр бүл зохиох',
    relationship: 'Тогтвортой үерхэх',
    friendship: 'Найз нөхөд болох',
    adult_intimate: 'Насанд хүрэгчдийн харилцан зөвшөөрсөн илүү дотно харилцаа'
  };
  const STATUS = {
    pending: 'ХҮЛЭЭГДЭЖ БУЙ',
    approved: 'ЗӨВШӨӨРСӨН',
    active: 'ХАЙЖ БАЙНА',
    completed: 'ДУУССАН',
    cancelled: 'ЦУЦЛАГДСАН',
    cancel_requested: 'ЦУЦЛАХ ХҮСЭЛТ',
    rejected: 'ТАТГАЛЗСАН',
    connected: 'ХОЛБОГДСОН'
  };

  let me = null;
  let settings = {...DEFAULT_SETTINGS};
  let stats = {verifiedMembers: 0, activeRequests: 0, freeRegularUsed: 0};
  let selfieData = '';
  let cameraStream = null;
  let selectedOrderType = '';
  let myRequests = [];
  let unsubscribers = [];
  let supportUnsub = null;

  function firebaseError(err) {
    console.error(err);
    const map = {
      'auth/email-already-in-use': 'Энэ утасны дугаар бүртгэлтэй байна.',
      'auth/invalid-credential': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/wrong-password': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/user-not-found': 'Утасны дугаар эсвэл PIN буруу байна.',
      'auth/weak-password': 'PIN заавал 6 оронтой байна.',
      'auth/network-request-failed': 'Интернэт холболтоо шалгана уу.',
      'permission-denied': 'Энэ үйлдлийг хийх эрхгүй байна. Firestore Rules-ээ шалгана уу.'
    };
    return map[err?.code] || err?.message || 'Алдаа гарлаа.';
  }

  function ageFromBirth(birth) {
    const d = new Date(birth);
    if (Number.isNaN(d.getTime())) return 0;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    $('cameraVideo').srcObject = null;
  }

  async function startCamera() {
    try {
      stopCamera();
      cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:720}},audio:false});
      $('cameraVideo').srcObject = cameraStream;
      $('cameraVideo').classList.remove('hidden');
      $('selfiePreview').classList.add('hidden');
      $('cameraPlaceholder').classList.add('hidden');
      $('captureBtn').disabled = false;
      $('retakeBtn').classList.add('hidden');
      selfieData = '';
    } catch (err) {
      alert('Камер нээж чадсангүй. Камерын зөвшөөрлөө нээгээд HTTPS холбоосоор дахин оролдоно уу.');
    }
  }

  function captureSelfie() {
    const video = $('cameraVideo');
    if (!video.videoWidth) return alert('Камер бэлэн болоогүй байна. Түр хүлээгээд дахин дарна уу.');
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = Math.max(0, (video.videoWidth - size) / 2);
    const sy = Math.max(0, (video.videoHeight - size) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 640, 640);
    let quality = .74;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 520000 && quality > .38) {
      quality -= .08;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    if (data.length > 700000) return alert('Селфийн хэмжээ хэт том байна. Дахин авна уу.');
    selfieData = data;
    $('selfiePreview').src = data;
    $('selfiePreview').classList.remove('hidden');
    $('cameraVideo').classList.add('hidden');
    $('captureBtn').disabled = true;
    $('retakeBtn').classList.remove('hidden');
    stopCamera();
  }

  function showAuth(mode) {
    $('loginCard').classList.toggle('hidden', mode !== 'login');
    $('registerCard').classList.toggle('hidden', mode !== 'register');
  }

  async function register() {
    const phone = cleanPhone($('regPhone').value);
    const pin = $('regPin').value.trim();
    const birthDate = $('birthDate').value;
    const age = ageFromBirth(birthDate);
    const preferredAgeMin = Number($('preferredAgeMin').value);
    const preferredAgeMax = Number($('preferredAgeMax').value);
    const required = [
      $('fullName').value.trim(), birthDate, $('gender').value, $('city').value.trim(),
      $('maritalStatus').value, $('hasChildren').value, $('job').value.trim(), $('goal').value,
      $('preferredGender').value, $('locationImportance').value, $('acceptChildren').value,
      $('acceptPastMarriage').value, $('smoking').value, $('drinking').value, $('relocate').value,
      $('about').value.trim(), $('dealBreakers').value.trim()
    ];
    if (!/^\d{8}$/.test(phone) || !/^\d{6}$/.test(pin)) return setText('registerMsg','8 оронтой утас, 6 оронтой PIN оруулна.');
    if (required.some(v => !v)) return setText('registerMsg','Бүх шаардлагатай мэдээллээ бөглөнө үү.');
    if (age < 18 || age > 90) return setText('registerMsg','Зөвхөн 18–90 насны хүн бүртгүүлнэ.');
    if (preferredAgeMin < 18 || preferredAgeMax > 90 || preferredAgeMin > preferredAgeMax) return setText('registerMsg','Хайж буй хүний насны хязгаарыг зөв оруулна уу.');
    if (!selfieData) return setText('registerMsg','Утасны камераар селфи авч баталгаажуулна уу.');
    if (![...['agreeAge','agreeTruth','agreePrivacy','agreeSafety']].every(id => $(id).checked)) return setText('registerMsg','Бүх баталгаажуулалтыг зөвшөөрнө үү.');

    $('registerBtn').disabled = true;
    setText('registerMsg','Бүртгэл үүсгэж байна...');
    try {
      const credential = await auth.createUserWithEmailAndPassword(phoneEmail(phone), pin);
      const uid = credential.user.uid;
      const data = {
        phone,
        fullName: $('fullName').value.trim(),
        birthDate,
        age,
        gender: $('gender').value,
        city: $('city').value.trim(),
        maritalStatus: $('maritalStatus').value,
        hasChildren: $('hasChildren').value,
        job: $('job').value.trim(),
        goal: $('goal').value,
        preferredGender: $('preferredGender').value,
        preferredAgeMin,
        preferredAgeMax,
        locationImportance: $('locationImportance').value,
        acceptChildren: $('acceptChildren').value,
        acceptPastMarriage: $('acceptPastMarriage').value,
        smoking: $('smoking').value,
        drinking: $('drinking').value,
        relocate: $('relocate').value,
        about: $('about').value.trim(),
        dealBreakers: $('dealBreakers').value.trim(),
        selfie: selfieData,
        verificationStatus: 'pending',
        accountStatus: 'active',
        deletionRequested: false,
        consentVersion: '2026-07-20',
        createdAt: serverTime(),
        updatedAt: serverTime()
      };
      await db.collection('users').doc(uid).set(data);
      setText('registerMsg','Бүртгэл амжилттай. Админ таны мэдээллийг хянана.');
    } catch (err) {
      setText('registerMsg', firebaseError(err));
      try { if (auth.currentUser && !(await db.collection('users').doc(auth.currentUser.uid).get()).exists) await auth.currentUser.delete(); } catch {}
    } finally {
      $('registerBtn').disabled = false;
    }
  }

  async function login() {
    const phone = cleanPhone($('loginPhone').value);
    const pin = $('loginPin').value.trim();
    if (!/^\d{8}$/.test(phone) || !/^\d{6}$/.test(pin)) return setText('loginMsg','8 оронтой утас, 6 оронтой PIN оруулна.');
    $('loginBtn').disabled = true;
    setText('loginMsg','Нэвтэрч байна...');
    try {
      await auth.signInWithEmailAndPassword(phoneEmail(phone), pin);
      setText('loginMsg','');
    } catch (err) {
      setText('loginMsg', firebaseError(err));
    } finally { $('loginBtn').disabled = false; }
  }

  function setText(id, text) { $(id).textContent = text; }

  async function loadMe(uid) {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) throw new Error('Бүртгэлийн мэдээлэл олдсонгүй.');
    me = {uid, ...snap.data()};
  }

  async function loadPublicConfig() {
    const [settingSnap, statsSnap] = await Promise.all([
      db.collection('appSettings').doc('public').get(),
      db.collection('publicStats').doc('app').get()
    ]);
    settings = {...DEFAULT_SETTINGS, ...(settingSnap.exists ? settingSnap.data() : {})};
    stats = {...stats, ...(statsSnap.exists ? statsSnap.data() : {})};
    renderStats();
  }

  function renderStats() {
    $('verifiedCount').textContent = Number(stats.verifiedMembers || 0);
    $('activeRequestCount').textContent = Number(stats.activeRequests || 0);
    const limit = Number(settings.promoLimit || 100);
    const used = Number(stats.freeRegularUsed || 0);
    $('promoLeft').textContent = settings.promoOpen === false ? '0' : Math.max(0, limit - used);
  }

  function renderMemberHeader() {
    $('helloTitle').textContent = `Сайн байна уу, ${me.fullName || 'гишүүн'}?`;
    const state = me.verificationStatus || 'pending';
    const banner = $('verificationBanner');
    if (state === 'verified') {
      banner.className = 'notice good';
      banner.innerHTML = '<b>Таны бүртгэл баталгаажсан.</b><br>Та танилцах хүсэлт өгөх боломжтой.';
    } else if (state === 'rejected') {
      banner.className = 'notice danger';
      banner.innerHTML = '<b>Бүртгэл баталгаажаагүй.</b><br>Админ, оператортой холбогдож мэдээллээ засна уу.';
    } else if (state === 'suspended') {
      banner.className = 'notice danger';
      banner.innerHTML = '<b>Бүртгэл түр хаагдсан.</b><br>Админтай холбогдоно уу.';
    } else {
      banner.className = 'notice warn';
      banner.innerHTML = '<b>Бүртгэл хянагдаж байна.</b><br>Селфи болон мэдээллийг админ баталгаажуулсны дараа хүсэлт өгнө.';
    }
    const eligible = state === 'verified';
    $('regularOrderBtn').disabled = !eligible;
    $('urgentOrderBtn').disabled = !eligible;
    $('requestEligibility').className = `notice ${eligible ? 'good' : 'warn'}`;
    $('requestEligibility').textContent = eligible ? 'Бүртгэл баталгаажсан. Үйлчилгээний төрлөө сонгоно уу.' : 'Хүсэлт өгөхийн өмнө админы баталгаажуулалт шаардлагатай.';
    renderProfile();
  }

  function renderProfile() {
    const goal = GOALS[me.goal] || me.goal || '';
    $('profileSummary').innerHTML = `<div class="item"><b>${esc(me.fullName)}, ${Number(me.age || 18)}</b><div class="small">${esc(me.gender)} · ${esc(me.city)} · ${esc(me.job)}</div><span class="pill info">${esc(goal)}</span><p class="small">${esc(me.about)}</p><div class="divider"></div><div class="small"><b>Хайж буй хүн:</b> ${esc(me.preferredGender)}, ${Number(me.preferredAgeMin)}–${Number(me.preferredAgeMax)} нас<br><b>Байршил:</b> ${esc(me.locationImportance)}<br><b>Хүүхэдтэй хүн:</b> ${esc(me.acceptChildren)}<br><b>Өмнөх гэрлэлт:</b> ${esc(me.acceptPastMarriage)}</div></div><button id="logoutBtn" class="btn secondary full">Гарах</button>`;
    $('logoutBtn').onclick = () => auth.signOut();
  }

  function clearListeners() {
    unsubscribers.forEach(fn => { try { fn(); } catch {} });
    unsubscribers = [];
    if (supportUnsub) { try { supportUnsub(); } catch {} supportUnsub = null; }
  }

  function startMemberListeners() {
    clearListeners();
    const uid = me.uid;
    unsubscribers.push(db.collection('users').doc(uid).onSnapshot(s => {
      if (s.exists) { me = {uid, ...s.data()}; renderMemberHeader(); }
    }));
    unsubscribers.push(db.collection('matchRequests').where('userUid','==',uid).onSnapshot(s => {
      myRequests = s.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      renderRequests();
    }, e => $('myRequests').innerHTML = `<div class="notice danger">${esc(firebaseError(e))}</div>`));
    unsubscribers.push(db.collection('introductions').where('participants','array-contains',uid).onSnapshot(s => {
      const rows = s.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      renderProposals(rows);
    }, e => $('proposals').innerHTML = `<div class="notice danger">${esc(firebaseError(e))}</div>`));
    unsubscribers.push(db.collection('notifications').where('userUid','==',uid).onSnapshot(s => {
      const rows = s.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      renderNotifications(rows);
    }, e => $('notifications').innerHTML = `<div class="notice danger">${esc(firebaseError(e))}</div>`));
  }

  function openOrder(type) {
    if (me.verificationStatus !== 'verified') return alert('Бүртгэл баталгаажаагүй байна.');
    selectedOrderType = type;
    const freeLeft = Math.max(0, Number(settings.promoLimit || 100) - Number(stats.freeRegularUsed || 0));
    const isFree = type === 'regular' && settings.promoOpen !== false && freeLeft > 0;
    $('orderFormTitle').textContent = type === 'urgent' ? 'Шуурхай танилцах хүсэлт' : 'Энгийн танилцах хүсэлт';
    $('orderPriceBox').className = `notice ${isFree ? 'good' : type === 'urgent' ? 'warn' : ''}`;
    $('orderPriceBox').innerHTML = type === 'urgent'
      ? `<b>24–72 цагийн давуу хайлт</b><br>Үнэ: ${money(settings.urgentPrice)}. Энэ хугацаанд хайлтыг давуу эрхтэй хийх бөгөөд тохирох хүн заавал олдоно гэсэн баталгаа биш.`
      : isFree
        ? `<b>Эхний ${Number(settings.promoLimit || 100)} баталгаажсан энгийн хүсэлтийн урамшуулал</b><br>Таны хүсэлт урьдчилсан байдлаар үнэгүй эрхэд багтаж байна. Эцсийн эрхийг админ хүсэлтийн дарааллаар баталгаажуулна.`
        : `<b>7–14 хоногийн энгийн хайлт</b><br>Үнэ: ${money(settings.regularPrice)}.`;
    $('paymentFields').classList.toggle('hidden', isFree);
    $('bankInfo').innerHTML = `<b>${esc(settings.bankName)}</b><br>Данс: ${esc(settings.bankAccount || 'Админ оруулаагүй')}<br>Хүлээн авагч: ${esc(settings.bankHolder || '—')}<br>Гүйлгээний утгад өөрийн утасны дугаарыг бичнэ.`;
    $('orderAgeMin').value = me.preferredAgeMin;
    $('orderAgeMax').value = me.preferredAgeMax;
    $('orderLocations').value = me.locationImportance === 'Хамаарахгүй' ? 'Хамаарахгүй' : me.city;
    $('orderNotes').value = '';
    $('paymentReference').value = '';
    $('orderFormCard').classList.remove('hidden');
    $('orderFormCard').scrollIntoView({behavior:'smooth'});
  }

  async function submitOrder() {
    if (!selectedOrderType) return;
    const ageMin = Number($('orderAgeMin').value);
    const ageMax = Number($('orderAgeMax').value);
    const locations = $('orderLocations').value.trim();
    const notes = $('orderNotes').value.trim();
    const freeLeft = Math.max(0, Number(settings.promoLimit || 100) - Number(stats.freeRegularUsed || 0));
    const promoEligible = selectedOrderType === 'regular' && settings.promoOpen !== false && freeLeft > 0;
    const price = promoEligible ? 0 : Number(selectedOrderType === 'urgent' ? settings.urgentPrice : settings.regularPrice);
    const refText = $('paymentReference').value.trim();
    if (ageMin < 18 || ageMax > 90 || ageMin > ageMax || !locations) return setText('orderFormMsg','Нас болон байршлын мэдээллийг зөв оруулна уу.');
    if (price > 0 && !refText) return setText('orderFormMsg','Төлбөрийн гүйлгээний утга эсвэл лавлагааг оруулна уу.');
    const already = myRequests.some(r => r.type === selectedOrderType && !['completed','cancelled','rejected'].includes(r.status));
    if (already) return setText('orderFormMsg','Энэ төрлийн идэвхтэй хүсэлт аль хэдийн байна.');
    $('submitOrderBtn').disabled = true;
    setText('orderFormMsg','Илгээж байна...');
    try {
      await db.collection('matchRequests').add({
        userUid: me.uid,
        type: selectedOrderType,
        serviceWindow: selectedOrderType === 'urgent' ? '24–72 цаг' : '7–14 хоног',
        status: 'pending',
        paymentStatus: price === 0 ? 'not_required' : 'pending_review',
        price,
        promoEligible,
        goal: me.goal,
        preferredGender: me.preferredGender,
        preferredAgeMin: ageMin,
        preferredAgeMax: ageMax,
        preferredLocations: locations,
        notes,
        paymentReference: refText,
        cancelRequested: false,
        createdAt: serverTime(),
        updatedAt: serverTime()
      });
      setText('orderFormMsg','Хүсэлт амжилттай илгээгдлээ.');
      $('orderFormCard').classList.add('hidden');
    } catch (err) { setText('orderFormMsg', firebaseError(err)); }
    finally { $('submitOrderBtn').disabled = false; }
  }

  function requestStateClass(status) {
    if (['approved','active','completed'].includes(status)) return 'approved';
    if (['rejected','cancelled'].includes(status)) return 'rejected';
    return 'pending';
  }

  function renderRequests() {
    if (!myRequests.length) { $('myRequests').innerHTML = '<div class="small">Одоогоор хүсэлт алга.</div>'; return; }
    $('myRequests').innerHTML = myRequests.map(r => {
      const editable = ['pending','approved','active'].includes(r.status);
      return `<div class="item"><h3>${r.type === 'urgent' ? 'Шуурхай хүсэлт' : 'Энгийн хүсэлт'}</h3><span class="pill ${requestStateClass(r.status)}">${esc(STATUS[r.status] || r.status)}</span><span class="pill info">${esc(r.serviceWindow)}</span><div class="small">Үнэ: ${money(r.price)} · Төлбөр: ${esc(r.paymentStatus || '')}<br>Нас: ${Number(r.preferredAgeMin)}–${Number(r.preferredAgeMax)} · ${esc(r.preferredLocations)}<br>${esc(r.notes || '')}<br>${fmtDate(r.createdAt)}</div>${editable ? `<div class="row" style="margin-top:8px"><button class="btn secondary" onclick="editRequest('${r.id}')">Өөрчлөх</button><button class="btn red" onclick="cancelRequest('${r.id}')">Цуцлах</button></div>` : ''}</div>`;
    }).join('');
  }

  window.editRequest = async id => {
    const r = myRequests.find(x => x.id === id); if (!r) return;
    const min = Number(prompt('Насны доод хязгаар', r.preferredAgeMin)); if (!min) return;
    const max = Number(prompt('Насны дээд хязгаар', r.preferredAgeMax)); if (!max) return;
    const locations = prompt('Хайх хот, аймаг', r.preferredLocations); if (locations === null) return;
    const notes = prompt('Нэмэлт тайлбар', r.notes || ''); if (notes === null) return;
    if (min < 18 || max > 90 || min > max) return alert('Насны хязгаар буруу байна.');
    try { await db.collection('matchRequests').doc(id).update({preferredAgeMin:min,preferredAgeMax:max,preferredLocations:locations.trim(),notes:notes.trim(),updatedAt:serverTime()}); }
    catch (err) { alert(firebaseError(err)); }
  };

  window.cancelRequest = async id => {
    if (!confirm('Энэ хүсэлтийг цуцлах хүсэлт илгээх үү?')) return;
    try { await db.collection('matchRequests').doc(id).update({status:'cancel_requested',cancelRequested:true,updatedAt:serverTime()}); }
    catch (err) { alert(firebaseError(err)); }
  };

  function renderProposals(rows) {
    if (!rows.length) { $('proposals').innerHTML = '<div class="small" style="margin-top:12px">Одоогоор санал ирээгүй байна.</div>'; return; }
    $('proposals').innerHTML = rows.map(r => {
      const isA = r.userAUid === me.uid;
      const p = isA ? r.profileForA : r.profileForB;
      const response = isA ? r.responseA : r.responseB;
      const contact = isA ? r.contactForA : r.contactForB;
      const canRespond = response === 'pending' && r.status !== 'connected';
      const responseText = response === 'accepted' ? 'ТА ЗӨВШӨӨРСӨН' : response === 'rejected' ? 'ТА ТАТГАЛЗСАН' : 'ТАНЫ ХАРИУ ХҮЛЭЭЖ БАЙНА';
      return `<div class="item proposal"><h3>${esc(p?.displayName || 'Нэргүй санал')}, ${Number(p?.age || 18)}</h3><div class="small">${esc(p?.gender || '')} · ${esc(p?.city || '')} · ${esc(p?.job || '')}<br>Зорилго: ${esc(GOALS[p?.goal] || p?.goal || '')}<br>Гэрлэлтийн байдал: ${esc(p?.maritalStatus || '')}<br>Хүүхэд: ${esc(p?.hasChildren || '')}</div><p>${esc(p?.about || '')}</p><span class="pill ${response === 'accepted' ? 'approved' : response === 'rejected' ? 'rejected' : 'pending'}">${responseText}</span>${canRespond ? `<div class="row"><button class="btn green" onclick="respondProposal('${r.id}','accepted')">Зөвшөөрөх</button><button class="btn red" onclick="respondProposal('${r.id}','rejected')">Татгалзах</button></div>` : ''}${r.status === 'connected' && contact ? `<div class="contact" style="margin-top:10px"><b>Хоёр тал зөвшөөрсөн — холбоо нээгдлээ</b><br>Нэр: ${esc(contact.name)}<br>Утас: <a style="color:#a8f4d5" href="tel:${esc(contact.phone)}">${esc(contact.phone)}</a></div>` : response === 'accepted' ? '<div class="notice" style="margin-top:10px">Нөгөө талын хариу болон админы баталгаажуулалтыг хүлээж байна.</div>' : ''}<div class="small" style="margin-top:8px">Санал илгээсэн: ${fmtDate(r.createdAt)}</div></div>`;
    }).join('');
  }

  window.respondProposal = async (id, response) => {
    if (!['accepted','rejected'].includes(response)) return;
    if (!confirm(response === 'accepted' ? 'Энэ хүнийг танилцах саналд зөвшөөрөх үү?' : 'Энэ саналаас татгалзах уу?')) return;
    try {
      const ref = db.collection('introductions').doc(id);
      const snap = await ref.get(); if (!snap.exists) throw new Error('Санал олдсонгүй.');
      const data = snap.data();
      const field = data.userAUid === me.uid ? 'responseA' : data.userBUid === me.uid ? 'responseB' : '';
      if (!field) throw new Error('Энэ санал танд хамаарахгүй.');
      await ref.update({[field]:response,updatedAt:serverTime()});
    } catch (err) { alert(firebaseError(err)); }
  };

  function renderNotifications(rows) {
    if (!rows.length) { $('notifications').innerHTML = '<div class="small">Одоогоор зурвас алга.</div>'; return; }
    $('notifications').innerHTML = rows.map(n => `<div class="item ${n.read ? '' : 'proposal'}"><b>${esc(n.title || 'Админы зурвас')}</b><p class="small">${esc(n.message || '')}</p><div class="small">${fmtDate(n.createdAt)}</div>${n.read ? '' : `<button class="btn secondary full" onclick="markNotificationRead('${n.id}')">Уншсан</button>`}</div>`).join('');
  }

  window.markNotificationRead = async id => {
    try { await db.collection('notifications').doc(id).update({read:true,readAt:serverTime()}); }
    catch (err) { alert(firebaseError(err)); }
  };

  async function ensureSupportThread() {
    const ref = db.collection('supportThreads').doc(me.uid);
    const snap = await ref.get();
    if (!snap.exists) await ref.set({userUid:me.uid,userName:me.fullName,userPhone:me.phone,lastMessage:'',adminUnread:false,userUnread:false,createdAt:serverTime(),updatedAt:serverTime()});
    if (supportUnsub) supportUnsub();
    supportUnsub = ref.collection('messages').orderBy('createdAt','asc').limit(300).onSnapshot(s => {
      $('supportChat').innerHTML = s.empty ? '<div class="small">Операторт зурвас бичиж болно.</div>' : s.docs.map(d => {
        const m = d.data(); const mine = m.senderType === 'user';
        return `<div class="bubble ${mine ? 'mine' : ''}"><b>${mine ? 'Та' : 'Админ'}</b><br>${esc(m.text)}</div>`;
      }).join('');
      $('supportChat').scrollTop = $('supportChat').scrollHeight;
      ref.update({userUnread:false}).catch(()=>{});
    }, e => $('supportChat').innerHTML = `<div class="notice danger">${esc(firebaseError(e))}</div>`);
  }

  async function sendSupportMessage(textOverride='') {
    const input = $('supportInput');
    const text = String(textOverride || input.value || '').trim();
    if (!text) return;
    if (!textOverride) input.value = '';
    try {
      const ref = db.collection('supportThreads').doc(me.uid);
      await ref.set({userUid:me.uid,userName:me.fullName,userPhone:me.phone,lastMessage:text.slice(0,120),adminUnread:true,userUnread:false,updatedAt:serverTime(),createdAt:me.createdAt || serverTime()},{merge:true});
      await ref.collection('messages').add({senderType:'user',senderUid:me.uid,text:text.slice(0,500),createdAt:serverTime()});
    } catch (err) { if (!textOverride) input.value = text; alert(firebaseError(err)); }
  }

  async function requestDeletion() {
    if (!confirm('Бүртгэл устгуулах хүсэлт илгээх үү? Админ тантай холбогдож баталгаажуулна.')) return;
    try {
      await db.collection('users').doc(me.uid).update({deletionRequested:true,updatedAt:serverTime()});
      await sendSupportMessage('Бүртгэл болон хувийн мэдээллээ устгуулах хүсэлт гаргав.');
      alert('Устгах хүсэлт админд илгээгдлээ.');
    } catch (err) { alert(firebaseError(err)); }
  }

  function showSection(id) {
    document.querySelectorAll('.memberSection').forEach(s => s.classList.add('hidden'));
    const target = $(id); if (target) target.classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.go === id));
    if (id === 'supportSection' && me) ensureSupportThread().catch(e => alert(firebaseError(e)));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function startMemberApp(uid) {
    await loadMe(uid);
    await loadPublicConfig();
    $('authPage').classList.add('hidden');
    $('memberPage').classList.remove('hidden');
    $('memberTabs').classList.remove('hidden');
    renderMemberHeader();
    startMemberListeners();
    showSection('homeSection');
  }

  function stopMemberApp() {
    clearListeners();
    stopCamera();
    me = null;
    $('memberPage').classList.add('hidden');
    $('memberTabs').classList.add('hidden');
    $('authPage').classList.remove('hidden');
    showAuth('login');
  }

  $('showRegisterBtn').onclick = () => showAuth('register');
  $('showLoginBtn').onclick = () => showAuth('login');
  $('loginBtn').onclick = login;
  $('registerBtn').onclick = register;
  $('startCameraBtn').onclick = startCamera;
  $('captureBtn').onclick = captureSelfie;
  $('retakeBtn').onclick = startCamera;
  $('regularOrderBtn').onclick = () => openOrder('regular');
  $('urgentOrderBtn').onclick = () => openOrder('urgent');
  $('submitOrderBtn').onclick = submitOrder;
  $('closeOrderFormBtn').onclick = () => $('orderFormCard').classList.add('hidden');
  $('supportSendBtn').onclick = () => sendSupportMessage();
  $('supportInput').onkeydown = e => { if (e.key === 'Enter') sendSupportMessage(); };
  $('requestDeletionBtn').onclick = requestDeletion;
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => showSection(el.dataset.go)));

  auth.onAuthStateChanged(async user => {
    if (!user) return stopMemberApp();
    try { await startMemberApp(user.uid); }
    catch (err) {
      console.error(err);
      alert(firebaseError(err));
      await auth.signOut();
    }
  });
})();
