(() => {
  'use strict';
  const cfg = window.TANIL_FIREBASE_CONFIG || {};
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FV = firebase.firestore.FieldValue;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cleanPhone = p => String(p || '').replace(/\D/g,'');
  const phoneEmail = p => `${cleanPhone(p)}@tanil.app`;
  const serverTime = () => FV.serverTimestamp();
  const money = n => `${new Intl.NumberFormat('mn-MN').format(Number(n || 0))}₮`;
  const fmt = t => { try { return t?.toDate().toLocaleString('mn-MN') || ''; } catch { return ''; } };
  const GOALS = {family:'Гэр бүл зохиох',relationship:'Тогтвортой үерхэх',friendship:'Найз нөхөд болох',adult_intimate:'Насанд хүрэгчдийн илүү дотно харилцаа'};
  const STATUS = {pending:'ХҮЛЭЭГДЭЖ БУЙ',approved:'ЗӨВШӨӨРСӨН',active:'ХАЙЖ БАЙНА',completed:'ДУУССАН',cancelled:'ЦУЦЛАГДСАН',cancel_requested:'ЦУЦЛАХ ХҮСЭЛТ',rejected:'ТАТГАЛЗСАН',connected:'ХОЛБОГДСОН'};
  let users = [], requests = [], introductions = [], threads = [], settings = {};
  let listeners = [], supportUnsub = null, activeThread = null, statsTimer = null;

  function errorText(e){console.error(e);return e?.message||'Алдаа гарлаа.'}
  async function isAdmin(uid){const s=await db.collection('admins').doc(uid).get();return s.exists&&s.data().active===true}
  function userById(uid){return users.find(u=>u.id===uid)}
  function stateClass(status){if(['verified','approved','active','completed','connected'].includes(status))return'approved';if(['rejected','suspended','cancelled'].includes(status))return'rejected';return'pending'}

  async function login(){
    $('loginBtn').disabled=true;$('loginMsg').textContent='Нэвтэрч байна...';
    try{const c=await auth.signInWithEmailAndPassword(phoneEmail($('phone').value),$('pin').value.trim());if(!await isAdmin(c.user.uid)){await auth.signOut();throw new Error('Энэ бүртгэл админ эрхгүй байна.')}}catch(e){$('loginMsg').textContent=errorText(e)}finally{$('loginBtn').disabled=false}
  }

  function stopListeners(){listeners.forEach(fn=>{try{fn()}catch{}});listeners=[];if(supportUnsub){supportUnsub();supportUnsub=null}}
  async function showPanel(){
    $('loginCard').classList.add('hidden');$('panel').classList.remove('hidden');$('who').textContent=auth.currentUser.email.replace('@tanil.app','');
    stopListeners();
    listeners.push(db.collection('users').limit(1000).onSnapshot(s=>{users=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));renderUsers();renderUserSelects();renderStats();scheduleStatsSync()}));
    listeners.push(db.collection('matchRequests').limit(1000).onSnapshot(s=>{requests=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));renderRequests();renderStats();scheduleStatsSync()}));
    listeners.push(db.collection('introductions').limit(1000).onSnapshot(s=>{introductions=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));renderIntroductions();renderStats()}));
    listeners.push(db.collection('supportThreads').limit(500).onSnapshot(s=>{threads=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));renderThreads();renderStats()}));
    await loadSettings();
  }

  function showLogin(){stopListeners();$('panel').classList.add('hidden');$('loginCard').classList.remove('hidden')}

  function renderStats(){
    $('userCount').textContent=users.length;
    $('verifiedCount').textContent=users.filter(u=>u.verificationStatus==='verified').length;
    $('requestCount').textContent=requests.filter(r=>['pending','approved','active','cancel_requested'].includes(r.status)).length;
    $('introCount').textContent=introductions.length;
    $('supportCount').textContent=threads.filter(t=>t.adminUnread).length;
  }

  function renderUsers(){
    const q=$('userSearch').value.trim().toLowerCase();
    const rows=users.filter(u=>!q||[u.fullName,u.phone,u.city,u.job].some(v=>String(v||'').toLowerCase().includes(q)));
    $('users').innerHTML=rows.length?rows.map(u=>`<div class="item user ${u.deletionRequested?'dangerBorder':''}"><img class="selfie" src="${esc(u.selfie||'')}" alt=""><div><b>${esc(u.fullName)}, ${Number(u.age||18)}</b><div class="small">📱 ${esc(u.phone)} · ${esc(u.gender)} · ${esc(u.city)}<br>${esc(u.job)} · ${esc(GOALS[u.goal]||u.goal)}<br>${esc(u.maritalStatus)} · ${esc(u.hasChildren)}</div><span class="pill ${stateClass(u.verificationStatus)}">${esc(u.verificationStatus||'pending')}</span>${u.deletionRequested?'<span class="pill rejected">УСТГАХ ХҮСЭЛТ</span>':''}<p class="small">${esc(u.about||'')}</p><div class="row"><button class="btn green" onclick="setVerification('${u.id}','verified')">Батлах</button><button class="btn amber" onclick="setVerification('${u.id}','pending')">Хүлээлгэх</button><button class="btn red" onclick="setVerification('${u.id}','suspended')">Түр хаах</button><button class="btn secondary" onclick="notifyUser('${u.id}')">Зурвас</button></div></div></div>`).join(''):'<div class="small">Гишүүн олдсонгүй.</div>';
  }

  window.setVerification=async(uid,status)=>{try{await db.collection('users').doc(uid).update({verificationStatus:status,verifiedAt:status==='verified'?serverTime():null,verifiedBy:auth.currentUser.uid,updatedAt:serverTime()});await db.collection('notifications').add({userUid:uid,title:'Бүртгэлийн төлөв шинэчлэгдлээ',message:status==='verified'?'Таны бүртгэл баталгаажлаа. Одоо танилцах хүсэлт өгч болно.':status==='suspended'?'Таны бүртгэл түр хаагдлаа. Оператортой холбогдоно уу.':'Таны бүртгэл дахин хянагдаж байна.',read:false,createdAt:serverTime()});await syncStats()}catch(e){alert(errorText(e))}};
  window.notifyUser=async uid=>{const text=prompt('Хэрэглэгчид илгээх зурвас');if(!text)return;try{await db.collection('notifications').add({userUid:uid,title:'Админы зурвас',message:text.slice(0,600),read:false,createdAt:serverTime()})}catch(e){alert(errorText(e))}};

  function renderRequests(){
    const filter=$('requestFilter').value;
    const rows=requests.filter(r=>filter==='all'||r.status===filter);
    $('requests').innerHTML=rows.length?rows.map(r=>{const u=userById(r.userUid)||{};return`<div class="item"><b>${r.type==='urgent'?'ШУУРХАЙ':'ЭНГИЙН'} · ${esc(u.fullName||u.phone||r.userUid)}</b><div class="small">📱 ${esc(u.phone||'')} · ${esc(r.serviceWindow)} · ${money(r.price)}<br>Төлбөр: ${esc(r.paymentStatus)} · Урамшуулал: ${r.promoEligible?'боломжтой':'үгүй'}<br>Нас: ${Number(r.preferredAgeMin)}–${Number(r.preferredAgeMax)} · ${esc(r.preferredLocations)}<br>${esc(r.notes||'')}<br>${fmt(r.createdAt)}</div><span class="pill ${stateClass(r.status)}">${esc(STATUS[r.status]||r.status)}</span><div class="row"><button class="btn green" onclick="setRequestStatus('${r.id}','approved')">Зөвшөөрөх</button><button class="btn" onclick="setRequestStatus('${r.id}','active')">Хайлт эхлүүлэх</button><button class="btn secondary" onclick="setRequestStatus('${r.id}','completed')">Дуусгах</button><button class="btn red" onclick="setRequestStatus('${r.id}','cancelled')">Цуцлах</button></div></div>`}).join(''):'<div class="small">Хүсэлт алга.</div>';
  }

  window.setRequestStatus=async(id,status)=>{
    try{
      const ref=db.collection('matchRequests').doc(id);
      await db.runTransaction(async tx=>{
        const reqSnap=await tx.get(ref);if(!reqSnap.exists)throw new Error('Хүсэлт олдсонгүй.');
        const r=reqSnap.data();const statsRef=db.collection('publicStats').doc('app');const settingsRef=db.collection('appSettings').doc('public');const statsSnap=await tx.get(statsRef);const settingsSnap=await tx.get(settingsRef);const st=statsSnap.exists?statsSnap.data():{};const cfg=settingsSnap.exists?settingsSnap.data():{promoLimit:100,promoOpen:true};
        let freeUsed=Number(st.freeRegularUsed||0);let paymentStatus=r.paymentStatus;
        if(status==='approved'){
          if(r.price===0&&r.promoEligible&&r.status!=='approved'&&r.status!=='active'&&r.status!=='completed'){
            if(cfg.promoOpen===false||freeUsed>=Number(cfg.promoLimit||100))throw new Error('Үнэгүй энгийн хүсэлтийн хязгаар дууссан байна.');
            freeUsed+=1;paymentStatus='not_required';
          }
          else if(r.price>0)paymentStatus='approved';
        }
        tx.update(ref,{status,paymentStatus,cancelRequested:false,reviewedBy:auth.currentUser.uid,reviewedAt:serverTime(),updatedAt:serverTime()});
        tx.set(statsRef,{freeRegularUsed:freeUsed,updatedAt:serverTime()},{merge:true});
      });
      const snap=await ref.get();const r=snap.data();await db.collection('notifications').add({userUid:r.userUid,title:'Танилцах хүсэлтийн төлөв',message:`Таны ${r.type==='urgent'?'шуурхай':'энгийн'} хүсэлт: ${STATUS[status]||status}.`,read:false,createdAt:serverTime()});await syncStats();
    }catch(e){alert(errorText(e))}
  };

  function renderUserSelects(){
    const verified=users.filter(u=>u.verificationStatus==='verified'&&u.accountStatus!=='suspended');
    const opts='<option value="">Хэрэглэгч сонгох</option>'+verified.map(u=>`<option value="${u.id}">${esc(u.fullName)} · ${esc(u.phone)} · ${u.age} · ${esc(u.city)}</option>`).join('');
    $('userA').innerHTML=opts;$('userB').innerHTML=opts;
  }

  function generalProfile(u){return{displayName:`${String(u.fullName||'Г')[0]}••••`,age:Number(u.age||18),gender:u.gender||'',city:u.city||'',job:u.job||'',goal:u.goal||'',maritalStatus:u.maritalStatus||'',hasChildren:u.hasChildren||'',about:u.about||''}}
  async function createIntroduction(){
    const a=$('userA').value,b=$('userB').value,note=$('introNote').value.trim();if(!a||!b||a===b)return setText('introMsg','Хоёр өөр баталгаажсан хүн сонгоно уу.');
    const ua=userById(a),ub=userById(b);if(!ua||!ub)return setText('introMsg','Хэрэглэгч олдсонгүй.');
    $('createIntroBtn').disabled=true;setText('introMsg','Илгээж байна...');
    try{const ref=await db.collection('introductions').add({participants:[a,b],userAUid:a,userBUid:b,responseA:'pending',responseB:'pending',status:'pending',profileForA:generalProfile(ub),profileForB:generalProfile(ua),adminNote:note,createdBy:auth.currentUser.uid,createdAt:serverTime(),updatedAt:serverTime()});await Promise.all([db.collection('notifications').add({userUid:a,title:'Шинэ танилцах санал',message:'Админ танд тохирох хүний нэргүй ерөнхий мэдээллийг санал болголоо.',introductionId:ref.id,read:false,createdAt:serverTime()}),db.collection('notifications').add({userUid:b,title:'Шинэ танилцах санал',message:'Админ танд тохирох хүний нэргүй ерөнхий мэдээллийг санал болголоо.',introductionId:ref.id,read:false,createdAt:serverTime()})]);setText('introMsg','Санал хоёр талд илгээгдлээ.');$('introNote').value=''}catch(e){setText('introMsg',errorText(e))}finally{$('createIntroBtn').disabled=false}
  }
  function setText(id,text){$(id).textContent=text}

  function renderIntroductions(){
    $('introductions').innerHTML=introductions.length?introductions.map(i=>{const a=userById(i.userAUid)||{},b=userById(i.userBUid)||{};const mutual=i.responseA==='accepted'&&i.responseB==='accepted';return`<div class="item"><b>${esc(a.fullName||i.userAUid)} ↔ ${esc(b.fullName||i.userBUid)}</b><div class="small">A: ${esc(i.responseA)} · B: ${esc(i.responseB)}<br>${esc(i.adminNote||'')}<br>${fmt(i.createdAt)}</div><span class="pill ${stateClass(i.status)}">${esc(STATUS[i.status]||i.status)}</span>${mutual&&i.status!=='connected'?`<button class="btn green full" onclick="connectIntroduction('${i.id}')">Хоёр тал зөвшөөрсөн — холбоо нээх</button>`:''}${i.status==='connected'?'<div class="notice">Холбоо барих мэдээлэл хоёр талд нээгдсэн.</div>':''}</div>`}).join(''):'<div class="small">Танилцуулга алга.</div>';
  }

  window.connectIntroduction=async id=>{
    if(!confirm('Хоёр талын утас, нэрийг харилцан нээх үү?'))return;
    try{const ref=db.collection('introductions').doc(id);const introSnap=await ref.get();if(!introSnap.exists)throw new Error('Санал олдсонгүй.');const i=introSnap.data();if(i.responseA!=='accepted'||i.responseB!=='accepted')throw new Error('Хоёр тал хараахан зөвшөөрөөгүй байна.');const [as,bs]=await Promise.all([db.collection('users').doc(i.userAUid).get(),db.collection('users').doc(i.userBUid).get()]);if(!as.exists||!bs.exists)throw new Error('Хэрэглэгчийн мэдээлэл дутуу байна.');const a=as.data(),b=bs.data();await ref.update({status:'connected',contactForA:{name:b.fullName,phone:b.phone},contactForB:{name:a.fullName,phone:a.phone},connectedAt:serverTime(),connectedBy:auth.currentUser.uid,updatedAt:serverTime()});await Promise.all([db.collection('notifications').add({userUid:i.userAUid,title:'Холбоо барих мэдээлэл нээгдлээ',message:'Та хоёр хоёулаа зөвшөөрсөн тул холбоо барих мэдээлэл нээгдлээ.',introductionId:id,read:false,createdAt:serverTime()}),db.collection('notifications').add({userUid:i.userBUid,title:'Холбоо барих мэдээлэл нээгдлээ',message:'Та хоёр хоёулаа зөвшөөрсөн тул холбоо барих мэдээлэл нээгдлээ.',introductionId:id,read:false,createdAt:serverTime()})])}catch(e){alert(errorText(e))}
  };

  function renderThreads(){
    $('threads').innerHTML=threads.length?threads.map(t=>`<div class="item ${t.adminUnread?'unread':''}" onclick="openThread('${t.id}')" style="cursor:pointer"><b>${esc(t.userName||t.userPhone||t.id)}</b><div class="small">📱 ${esc(t.userPhone||'')}<br>${esc(t.lastMessage||'')}<br>${fmt(t.updatedAt)}</div>${t.adminUnread?'<span class="pill pending">ШИНЭ</span>':''}</div>`).join(''):'<div class="small">Зурвас алга.</div>';
  }

  window.openThread=async uid=>{
    activeThread=threads.find(t=>t.id===uid)||{id:uid};$('supportChatCard').classList.remove('hidden');$('supportTitle').textContent=activeThread.userName||'Хэрэглэгч';$('supportMeta').textContent=activeThread.userPhone||uid;
    if(supportUnsub)supportUnsub();const ref=db.collection('supportThreads').doc(uid);supportUnsub=ref.collection('messages').orderBy('createdAt','asc').limit(300).onSnapshot(s=>{$('supportChat').innerHTML=s.empty?'<div class="small">Зурвас алга.</div>':s.docs.map(d=>{const m=d.data(),mine=m.senderType==='admin';return`<div class="bubble ${mine?'mine':''}"><b>${mine?'Админ':'Хэрэглэгч'}</b><br>${esc(m.text)}</div>`}).join('');$('supportChat').scrollTop=$('supportChat').scrollHeight});await ref.update({adminUnread:false})
  };
  async function sendSupport(){const text=$('supportInput').value.trim();if(!activeThread||!text)return;$('supportInput').value='';try{const ref=db.collection('supportThreads').doc(activeThread.id);await ref.collection('messages').add({senderType:'admin',senderUid:auth.currentUser.uid,text:text.slice(0,500),createdAt:serverTime()});await ref.update({lastMessage:text.slice(0,120),adminUnread:false,userUnread:true,updatedAt:serverTime()})}catch(e){$('supportInput').value=text;alert(errorText(e))}}

  async function loadSettings(){const ref=db.collection('appSettings').doc('public');const s=await ref.get();settings=s.exists?s.data():{regularPrice:20000,urgentPrice:40000,promoLimit:100,promoOpen:true,bankName:'',bankAccount:'',bankHolder:''};if(!s.exists)await ref.set({...settings,updatedAt:serverTime()});['regularPrice','urgentPrice','promoLimit','bankName','bankAccount','bankHolder'].forEach(k=>$(k).value=settings[k]??'');$('promoOpen').value=String(settings.promoOpen!==false)}
  async function saveSettings(){try{await db.collection('appSettings').doc('public').set({regularPrice:Number($('regularPrice').value||0),urgentPrice:Number($('urgentPrice').value||0),promoLimit:Number($('promoLimit').value||100),promoOpen:$('promoOpen').value==='true',bankName:$('bankName').value.trim(),bankAccount:$('bankAccount').value.trim(),bankHolder:$('bankHolder').value.trim(),updatedAt:serverTime()},{merge:true});setText('settingsMsg','Хадгаллаа.');await loadSettings()}catch(e){setText('settingsMsg',errorText(e))}}

  function scheduleStatsSync(){clearTimeout(statsTimer);statsTimer=setTimeout(()=>syncStats(false),700)}
  async function syncStats(notify=true){
    try{const verified=users.filter(u=>u.verificationStatus==='verified').length;const active=requests.filter(r=>['pending','approved','active','cancel_requested'].includes(r.status)).length;const regular=requests.filter(r=>r.type==='regular').length;const current=await db.collection('publicStats').doc('app').get();const freeUsed=current.exists?Number(current.data().freeRegularUsed||0):0;await db.collection('publicStats').doc('app').set({totalRegistered:users.length,verifiedMembers:verified,activeRequests:active,regularRequests:regular,freeRegularUsed:freeUsed,updatedAt:serverTime()},{merge:true});if(notify)alert('Бодит тоо шинэчлэгдлээ.')}catch(e){if(notify)alert(errorText(e));else console.error(e)}
  }

  function showTab(id){document.querySelectorAll('.tabPage').forEach(p=>p.classList.add('hidden'));$(id).classList.remove('hidden');document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===id))}

  $('loginBtn').onclick=login;$('logoutBtn').onclick=()=>auth.signOut();$('userSearch').oninput=renderUsers;$('requestFilter').onchange=renderRequests;$('createIntroBtn').onclick=createIntroduction;$('supportSendBtn').onclick=sendSupport;$('supportInput').onkeydown=e=>{if(e.key==='Enter')sendSupport()};$('closeSupportBtn').onclick=()=>{$('supportChatCard').classList.add('hidden');if(supportUnsub){supportUnsub();supportUnsub=null}activeThread=null};$('saveSettingsBtn').onclick=saveSettings;$('syncStatsBtn').onclick=()=>syncStats(true);document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
  auth.onAuthStateChanged(async u=>{if(u&&await isAdmin(u.uid))showPanel();else showLogin()});
})();
