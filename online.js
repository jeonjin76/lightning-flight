// Online add-on for the GitHub Pages version: Google login, a game nickname, a duel ladder and duels.
// The game itself lives in index.html and exposes window.LF; nothing here runs on claude.ai.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,doc,getDoc,getDocs,updateDoc,collection,query,orderBy,limit,writeBatch,runTransaction,serverTimestamp,Timestamp,arrayUnion} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Public web config (safe to ship: access is controlled by the Firestore rules in firestore.rules).
const app=initializeApp({
  apiKey:'AIzaSyCnr7sLKeuPLoDIU7Vy89yACun04Xakb8U',
  authDomain:'lightning-flight-25c0a.firebaseapp.com',
  projectId:'lightning-flight-25c0a',
  storageBucket:'lightning-flight-25c0a.firebasestorage.app',
  messagingSenderId:'286718874877',
  appId:'1:286718874877:web:7e94e0592c74d642f8da94',
});
const auth=getAuth(app),db=getFirestore(app);
const LF=window.LF;
const $=id=>document.getElementById(id);
const DAY=864e5,COOLDOWN=3*DAY,DUEL_TIME=2*DAY;
const NICK_RE=/^[가-힣A-Za-z0-9_]{2,10}$/;

let user=null,me=null,cache={users:[],duels:[],at:0};

/* ---------- DOM ---------- */
const css=document.createElement('style');
css.textContent=`
.online{display:flex;flex-direction:column;align-items:center;gap:1.4cqw;width:100%}
.online .who{margin:0;font-size:4cqw;color:var(--ice)}
.ladder li{grid-template-columns:8cqw 1fr auto auto}
.ladder .duel{font-family:var(--font-body);font-size:3.4cqw;padding:1cqw 2cqw;border:0;background:var(--hot);color:#fff;cursor:pointer}
.ladder .duel:disabled{background:var(--line);color:var(--dim);cursor:default}
.duels{list-style:none;margin:0;padding:0;width:100%;display:flex;flex-direction:column;gap:1cqw}
.duels li{display:flex;align-items:center;justify-content:space-between;gap:2cqw;padding:1.4cqw 2.4cqw;background:var(--field);box-shadow:inset 0 0 0 1px var(--line);font-size:3.6cqw;text-align:left}
.duels li.win{box-shadow:inset 0 0 0 2px var(--ice)}.duels li.lose{box-shadow:inset 0 0 0 2px var(--hot)}
.hook{margin:0;font-size:3.8cqw;color:var(--volt);animation:lfpulse 1.4s ease-in-out infinite}
@keyframes lfpulse{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.hook{animation:none}}
.online .ghost.strong{font-size:4.6cqw;padding:1.6cqw 5cqw}
.sub{margin:1cqw 0 0;font-family:var(--font-display);font-weight:400;font-size:5.4cqw;color:var(--volt)}
`;
document.head.append(css);
function el(tag,props={},...kids){const e=document.createElement(tag);Object.assign(e,props);e.append(...kids);return e;}
function screen(id,...kids){const s=el('section',{id,className:'screen'},...kids);$('frame').append(s);return s;}

// Title screen: login button, or "nickname · duel ladder · logout".
const box=el('div',{className:'online'});
const who=el('p',{className:'who'});
const btnLogin=el('button',{className:'ghost strong',type:'button',textContent:'구글로 로그인'});
const btnLadder=el('button',{className:'ghost gold',type:'button',textContent:'대결 랭킹'});
const btnLogout=el('button',{className:'ghost',type:'button',textContent:'로그아웃'});
const row=el('div',{className:'row'},btnLadder,btnLogout);
const hook=el('p',{className:'hook',textContent:'로그인하면 랭킹 저장 · 친구와 대결 가능!'});
box.append(who,btnLogin,hook,row);
// Sits right under the start button so new players see it first.
$('startRow').after(box);

// Nickname screen (first login only).
const nickIn=el('input',{maxLength:10,placeholder:'에이스',autocomplete:'off'});
const nickMsg=el('p',{className:'msg',role:'status'});
const btnNickOk=el('button',{className:'cta',type:'button',textContent:'이 닉네임으로 시작'});
const btnNickCancel=el('button',{className:'ghost',type:'button',textContent:'로그아웃'});
const scrNick=screen('scrNick',
  el('p',{className:'eyebrow',textContent:'NEW PILOT'}),el('h2',{textContent:'닉네임 정하기'}),
  el('p',{className:'note',textContent:'랭킹과 대결에는 이 닉네임만 보여요. 한글·영어·숫자 2~10자, 나중에 바꿀 수 없어요.'}),
  el('label',{className:'form'},nickIn),nickMsg,btnNickOk,
  el('p',{className:'note',textContent:'구글 로그인 정보는 Firebase(구글)가 관리해요. 게임에는 닉네임, 점수, 카드 기록, 대결 기록만 저장해요.'}),
  btnNickCancel);
nickIn.style.cssText='font:inherit;font-size:5cqw;color:var(--ink);background:var(--field);border:0;box-shadow:inset 0 0 0 2px var(--line);padding:1.6cqw 2cqw;width:100%;box-sizing:border-box';

// Ladder screen: the duel ranking plus my duels.
const ladMsg=el('p',{className:'note',role:'status'});
const ladList=el('ol',{className:'board ladder'});
const myDuels=el('ul',{className:'duels'});
const btnLadBack=el('button',{className:'ghost',type:'button',textContent:'돌아가기'});
const scrLadder=screen('scrLadder',
  el('p',{className:'eyebrow',textContent:'DUEL LADDER'}),el('h2',{textContent:'대결 랭킹'}),ladMsg,
  el('p',{className:'sub',textContent:'내 대결'}),myDuels,
  el('p',{className:'sub',textContent:'순위'}),ladList,btnLadBack);

// Duel start confirmation and result.
const duelInfo=el('p',{className:'lede'});
const btnDuelGo=el('button',{className:'cta',type:'button',textContent:'대결 시작'});
const btnDuelNo=el('button',{className:'ghost',type:'button',textContent:'나중에 하기'});
const scrDuel=screen('scrDuel',el('p',{className:'eyebrow',textContent:'DUEL'}),el('h2',{textContent:'대결'}),duelInfo,
  el('p',{className:'note',textContent:'5탄에서 목숨 1개, 폭탄 1개로 3분 동안 싸워요. 시작하면 다시 할 수 없고, 중간에 나가면 그때까지 점수(0점)로 기록돼요.'}),
  btnDuelGo,btnDuelNo);
const resInfo=el('p',{className:'lede'});
const resMsg=el('p',{className:'msg',role:'status'});
const btnResOk=el('button',{className:'cta',type:'button',textContent:'대결 랭킹 보기'});
const scrDuelEnd=screen('scrDuelEnd',el('p',{className:'eyebrow',textContent:'DUEL OVER'}),el('h2',{textContent:'대결 끝!'}),resInfo,resMsg,btnResOk);
for(const[k,s]of[['nick',scrNick],['ladder',scrLadder],['duel',scrDuel],['duelEnd',scrDuelEnd]])LF.addScreen(k,s);

/* ---------- auth and profile ---------- */
function refreshTitle(){
  btnLogin.hidden=hook.hidden=!!user;row.hidden=!me;who.hidden=!me;
  if(me){const n=pendingForMe().length;who.textContent=me.nick+' 님 · 대결 최고 점수 '+(me.best||0).toLocaleString('ko-KR');btnLadder.textContent='대결 랭킹'+(n?' ('+n+')':'');}
}
btnLogin.addEventListener('click',async()=>{
  btnLogin.disabled=true;
  try{await signInWithPopup(auth,new GoogleAuthProvider());}
  catch(e){if(e&&e.code!=='auth/popup-closed-by-user'&&e.code!=='auth/cancelled-popup-request')alert('로그인하지 못했어요. 팝업 차단을 풀고 다시 눌러 주세요.');}
  btnLogin.disabled=false;
});
btnLogout.addEventListener('click',()=>signOut(auth));
btnNickCancel.addEventListener('click',()=>{signOut(auth);LF.toTitle();});
onAuthStateChanged(auth,async u=>{
  user=u;me=null;
  if(u){
    const snap=await getDoc(doc(db,'users',u.uid));
    if(snap.exists()){me={id:u.uid,...snap.data()};await syncCards();await loadAll(true);}
    else if(LF.state==='title'){nickIn.value='';nickMsg.textContent='';LF.show('nick');setTimeout(()=>nickIn.focus(),50);}
  }
  refreshTitle();
});
btnNickOk.addEventListener('click',async()=>{
  const nick=nickIn.value.trim();
  if(!NICK_RE.test(nick)){nickMsg.textContent='한글·영어·숫자·밑줄로 2~10자만 쓸 수 있어요.';return;}
  btnNickOk.disabled=true;nickMsg.textContent='확인하는 중…';
  try{
    await runTransaction(db,async tx=>{
      const nref=doc(db,'nicks',nick.toLowerCase());
      if((await tx.get(nref)).exists())throw new Error('taken');
      tx.set(nref,{uid:user.uid});
      tx.set(doc(db,'users',user.uid),{nick,best:0,bestStage:0,cards:[...LF.owned],lastChallengeAt:Timestamp.fromMillis(0),createdAt:serverTimestamp()});
    });
    me={id:user.uid,nick,best:0,bestStage:0,cards:[...LF.owned],lastChallengeAt:Timestamp.fromMillis(0)};
    LF.toTitle();
  }catch(e){nickMsg.textContent=e.message==='taken'?'이미 누가 쓰고 있는 닉네임이에요.':'저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.';}
  btnNickOk.disabled=false;
});
// Cards collected on any device end up in both the browser and the account.
async function syncCards(){
  const server=me.cards||[];server.forEach(id=>LF.owned.add(id));LF.saveOwned();
  const missing=[...LF.owned].filter(id=>!server.includes(id));
  if(missing.length){await updateDoc(doc(db,'users',me.id),{cards:arrayUnion(...missing)});me.cards=[...server,...missing];}
}
LF.hooks.card=id=>{if(me)updateDoc(doc(db,'users',me.id),{cards:arrayUnion(id)}).catch(()=>{});};
LF.hooks.runEnd=(score,stage)=>{
  if(!me||score<=(me.best||0))return;
  me.best=score;me.bestStage=stage;
  updateDoc(doc(db,'users',me.id),{best:score,bestStage:stage}).catch(()=>{});
};
LF.hooks.title=()=>refreshTitle();

/* ---------- ladder ---------- */
const ms=t=>t&&t.toMillis?t.toMillis():0;
// A duel is settled once both played or the 2-day window closed. Higher score wins; a tie goes to the defender.
function settle(d,now){
  const t=ms(d.createdAt);if(!t)return null;
  if(!(d.cDone&&d.dDone)&&now<t+DUEL_TIME)return null;
  const c=Math.max(0,d.cScore),x=Math.max(0,d.dScore);
  return{at:t,c:d.challenger,d:d.defender,cWin:c>x,cs:c,ds:x};
}
// Ladder = everyone ordered by best score, then each settled duel won by a lower-ranked challenger swaps the two places.
function ladder(users,duels){
  const now=Date.now(),order=users.filter(u=>u.nick).sort((a,b)=>(b.best||0)-(a.best||0)||ms(a.createdAt)-ms(b.createdAt)).map(u=>u.id);
  const rec=Object.fromEntries(order.map(id=>[id,{w:0,l:0}]));
  for(const r of duels.map(d=>settle(d,now)).filter(Boolean).sort((a,b)=>a.at-b.at)){
    const ci=order.indexOf(r.c),di=order.indexOf(r.d);if(ci<0||di<0)continue;
    if(r.cWin){rec[r.c].w++;rec[r.d].l++;if(ci>di){order[ci]=r.d;order[di]=r.c;}}
    else{rec[r.d].w++;rec[r.c].l++;}
  }
  const byId=Object.fromEntries(users.map(u=>[u.id,u]));
  return order.map((id,i)=>({...byId[id],rank:i+1,...rec[id]}));
}
async function loadAll(force){
  if(!force&&Date.now()-cache.at<5000)return;
  const[us,ds]=await Promise.all([getDocs(query(collection(db,'users'),orderBy('best','desc'),limit(300))),getDocs(query(collection(db,'duels'),orderBy('createdAt','desc'),limit(500)))]);
  cache={users:us.docs.map(d=>({id:d.id,...d.data()})),duels:ds.docs.map(d=>({id:d.id,...d.data()})),at:Date.now()};
  const mine=cache.users.find(u=>u.id===(me&&me.id));if(mine)me={...me,...mine};
}
const open=d=>!settle(d,Date.now());
const pendingForMe=()=>me?cache.duels.filter(d=>open(d)&&((d.challenger===me.id&&d.cScore===-1)||(d.defender===me.id&&d.dScore===-1))):[];
function cooldownLeft(){return Math.max(0,ms(me.lastChallengeAt)+COOLDOWN-Date.now());}
const fmtLeft=t=>{const h=Math.ceil(t/36e5);return h>=24?Math.floor(h/24)+'일 '+(h%24)+'시간':h+'시간';};

async function openLadder(){
  LF.show('ladder');ladMsg.textContent='불러오는 중…';ladList.replaceChildren();myDuels.replaceChildren();
  try{await loadAll(true);}catch(e){ladMsg.textContent='랭킹을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.';return;}
  const L=ladder(cache.users,cache.duels),mine=L.find(r=>r.id===me.id),cd=cooldownLeft(),now=Date.now();
  ladMsg.textContent=(mine?'내 순위 '+mine.rank+'위 · ':'')+(cd?'다음 대결 신청까지 '+fmtLeft(cd):'나보다 위에 있는 사람에게 대결을 신청할 수 있어요.');
  // My duels: open ones first (with a play button when it is my turn), then the last few results.
  const mineD=cache.duels.filter(d=>d.challenger===me.id||d.defender===me.id);
  for(const d of mineD.filter(open)){
    const iAmC=d.challenger===me.id,my=iAmC?d.cScore:d.dScore,other=iAmC?d.dNick:d.cNick;
    const li=el('li',{},el('span',{textContent:(iAmC?'도전 → ':'도전 받음 ← ')+other+' · 남은 시간 '+fmtLeft(ms(d.createdAt)+DUEL_TIME-now)}));
    if(my===-1){const b=el('button',{className:'duel',type:'button',textContent:'대결하기'});b.style.cssText='font-family:var(--font-body);font-size:3.4cqw;padding:1cqw 2cqw;border:0;background:var(--hot);color:#fff;cursor:pointer';b.addEventListener('click',()=>askDuel(d));li.append(b);}
    else li.append(el('span',{textContent:'내 점수 '+Math.max(0,my).toLocaleString('ko-KR')+' · 상대 기다리는 중'}));
    myDuels.append(li);
  }
  for(const d of mineD.filter(d=>!open(d)).slice(0,5)){
    const r=settle(d,now),iAmC=d.challenger===me.id,won=iAmC===r.cWin;
    myDuels.append(el('li',{className:won?'win':'lose'},el('span',{textContent:(won?'승리':'패배')+' vs '+(iAmC?d.dNick:d.cNick)}),el('span',{textContent:(iAmC?r.cs:r.ds).toLocaleString('ko-KR')+' : '+(iAmC?r.ds:r.cs).toLocaleString('ko-KR')})));
  }
  if(!myDuels.children.length)myDuels.append(el('li',{},el('span',{textContent:'아직 대결이 없어요.'})));
  const busy=new Set(cache.duels.filter(d=>open(d)&&d.challenger===me.id).map(d=>d.defender));
  for(const r of L.slice(0,50)){
    const li=el('li',{className:r.id===me.id?'me':''},
      el('span',{className:'rk',textContent:String(r.rank)}),
      el('span',{className:'who'},el('span',{className:'nick',textContent:r.nick}),el('span',{className:'meta',textContent:r.w+'승 '+r.l+'패'})),
      el('span',{className:'sc',textContent:String(r.best||0).padStart(7,'0')},el('small',{textContent:'STAGE '+(r.bestStage||0)})));
    if(mine&&r.rank<mine.rank){
      const b=el('button',{className:'duel',type:'button',textContent:busy.has(r.id)?'신청함':'대결',disabled:!!cd||busy.has(r.id)});
      b.addEventListener('click',()=>challenge(r,b));li.append(b);
    }else li.append(el('span'));
    ladList.append(li);
  }
  btnLadBack.focus();
}
btnLadder.addEventListener('click',openLadder);
btnLadBack.addEventListener('click',()=>LF.toTitle());

async function challenge(target,btn){
  if(!confirm(target.nick+' 님에게 대결을 신청할까요? 신청하면 3일 동안 다른 대결을 신청할 수 없어요.'))return;
  btn.disabled=true;
  try{
    const b=writeBatch(db),ref=doc(collection(db,'duels'));
    b.set(ref,{challenger:me.id,defender:target.id,cNick:me.nick,dNick:target.nick,seed:1+Math.floor(Math.random()*2147483646),
      createdAt:serverTimestamp(),cScore:-1,dScore:-1,cDone:false,dDone:false});
    b.update(doc(db,'users',me.id),{lastChallengeAt:serverTimestamp()});
    await b.commit();
    await openLadder();
  }catch(e){btn.disabled=false;ladMsg.textContent='대결을 신청하지 못했어요. 3일이 지나지 않았거나 연결이 끊겼어요.';}
}

/* ---------- playing a duel ---------- */
let current=null;
function askDuel(d){
  current=d;const iAmC=d.challenger===me.id;
  duelInfo.textContent=(iAmC?d.dNick:d.cNick)+' 님과의 대결';
  LF.show('duel');btnDuelGo.focus();
}
btnDuelNo.addEventListener('click',openLadder);
btnDuelGo.addEventListener('click',async()=>{
  const d=current,side=d.challenger===me.id?'c':'d';
  btnDuelGo.disabled=true;
  try{await updateDoc(doc(db,'duels',d.id),{[side+'Score']:0});}
  catch(e){btnDuelGo.disabled=false;duelInfo.textContent='대결을 시작하지 못했어요. 이미 시작했거나 기한이 지났어요.';return;}
  btnDuelGo.disabled=false;
  LF.startDuel(d.seed,async(score,reason)=>{
    resInfo.textContent='내 점수 '+score.toLocaleString('ko-KR')+'점'+(reason==='time'?' (시간 종료)':reason==='clear'?' (스테이지 클리어!)':' (격추)');
    resMsg.textContent='기록을 올리는 중…';LF.show('duelEnd');
    try{
      await updateDoc(doc(db,'duels',d.id),{[side+'Score']:score,[side+'Done']:true});
      const other=side==='c'?d.dDone:d.cDone;
      resMsg.textContent=other?'상대도 이미 했어요. 대결 랭킹에서 결과를 확인하세요!':'기록했어요. 상대가 플레이하면 결과가 나와요.';
    }catch(e){resMsg.textContent='기록을 올리지 못했어요. 대결 기한이 지났을 수 있어요.';}
    btnResOk.focus();
  });
});
btnResOk.addEventListener('click',openLadder);
