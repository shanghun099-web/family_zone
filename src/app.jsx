const { useState, useEffect, useRef, useMemo, useContext, createContext } = React;

/* ── 아이콘 (lucide 0.460 고정) ── */
const LIcon = ({ name, size = 24, fill, stroke, sw }) => {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current; if (!box) return;
    box.innerHTML = '';
    const pascal = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const icon = (lucide.icons && lucide.icons[pascal]) || lucide[pascal];
    if (!icon) return;
    const el = lucide.createElement(icon);
    el.setAttribute('width', size); el.setAttribute('height', size);
    if (fill) el.setAttribute('fill', fill);
    if (stroke) el.setAttribute('stroke', stroke);
    if (sw) el.setAttribute('stroke-width', sw);
    box.appendChild(el);
  }, [name, size, fill, stroke, sw]);
  return <span ref={ref} aria-hidden="true" style={{display:'inline-flex',lineHeight:0}}/>;
};

/* ── 가족 공간 (Supabase) ──
   모든 표는 가족 암호로 잠겨 있다. 앱은 요청마다 x-family-key 헤더로 암호를 보내고,
   서버가 맞는 암호일 때만 읽고 쓰게 한다. 아래 키는 공개용이라 코드에 있어도 괜찮다. */
const SB_URL = 'https://ijpbmlphaanmqnsixckt.supabase.co';
const SB_KEY = 'sb_publishable_lZIA-d3DTswNZOKdhEn4iw_W8k7BDQl';
/* 사진·목소리·백업 창구 (내 구글 드라이브, Apps Script) */
const GW_URL = 'https://script.google.com/macros/s/AKfycbxogoYj6R2QqWwkcO0JibLlszlJTZHeM0Oldq2GhllyoPevi3IJT8CA-PgSiESHk3WASQ/exec';

const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
let familyKey = store.get('fz_key') || '';
let memberTok = store.get('fz_tok') || '';   // 이 폰이 누구인지 증명하는 열쇠 (개인 PIN 으로 받음)

async function sb(path, opt = {}) {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (familyKey) headers['x-family-key'] = familyKey;
  if (memberTok) headers['x-member-token'] = memberTok;
  if (opt.prefer) headers.Prefer = opt.prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opt.method || 'GET', headers,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) throw new Error((data && data.message) || `서버 오류 (${res.status})`);
  return data;
}
/* 서버는 한 번에 1000줄까지만 준다 → 1000줄씩 받아서 끝날 때까지 이어 붙인다 (순서는 order 로 고정) */
const PAGE = 1000;
async function listAll(t, q) {
  const out = [];
  for (let off = 0; ; off += PAGE) {
    const rows = await sb(`${t}?${q}&limit=${PAGE}&offset=${off}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
const db = {
  list:   (t, q = 'select=*&order=id') => listAll(t, q),
  add:    (t, row) => sb(t, { method: 'POST', body: row, prefer: 'return=representation' }),
  addOnce:(t, row, conflict) => sb(`${t}?on_conflict=${conflict}`, { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation' }),
  upsert: (t, row, conflict) => sb(`${t}?on_conflict=${conflict}`, { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' }),
  patch:  (t, id, patch) => sb(`${t}?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  del:    (t, filter) => sb(`${t}?${filter}`, { method: 'DELETE' }),
  rpc:    (fn, args = {}) => sb(`rpc/${fn}`, { method: 'POST', body: args })
};
/* {ok:false,error} 로 답하는 서버 함수 (PIN 틀린 횟수가 남게 예외 대신 결과로 답함) */
const rpcOk = async (fn, args) => { const r = await db.rpc(fn, args); if (!r || r.ok === false) throw new Error((r && r.error) || '서버가 거절했어요'); return r; };

/* 창구: 헤더 없는 text/plain POST (Apps Script 가 받는 방식) */
async function gw(action, payload = {}) {
  const res = await fetch(GW_URL, { method: 'POST', body: JSON.stringify({ action, key: familyKey, ...payload }) });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '사진 창구 오류');
  return j;
}
let gwVer = null;
async function gwVersion() {
  if (gwVer !== null) return gwVer;
  try { const j = await (await fetch(GW_URL)).json(); gwVer = j.v || 1; } catch (e) { gwVer = 0; }
  return gwVer;
}

/* 사진: 올리기 전에 폰에서 줄인다 (긴 변 1600px, 장당 300KB 안팎) */
async function shrinkImage(file, max = 1600, q = 0.82) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    src = await new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error('사진을 읽지 못했어요')); img.src = URL.createObjectURL(file); });
  }
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  return { blob, w, h };
}
const blobToB64 = blob => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = no; fr.readAsDataURL(blob); });
async function uploadPhoto(file, max, keepOrig) {
  const { blob, w, h } = await shrinkImage(file, max);
  const r = await gw('upload', { kind: 'photo', name: (file.name || '사진').replace(/\.\w+$/, ''), mime: 'image/jpeg', data: await blobToB64(blob) });
  const orig = keepOrig ? await uploadOriginal(file) : null;
  return { id: r.id, url: r.url, thumb: r.thumb, w, h, ...(orig ? { orig } : {}) };
}
/* 원본: 줄이지 않은 파일 그대로 드라이브 "사진" 폴더에 "원본_…"으로 한 장 더 (인쇄용·찍은 날짜와 장소 보관). 실패해도 소식은 올라간다 */
async function uploadOriginal(file) {
  if (!file || !file.size || file.size > 45e6) return null;
  try {
    const mime = /^image\//.test(file.type || '') ? file.type : 'image/jpeg';
    const r = await gw('upload', { kind: 'photo', name: '원본_' + (file.name || '사진').replace(/\.\w+$/, ''), mime, data: await blobToB64(file) });
    return r.id || null;
  } catch (e) { return null; }
}
/* ── 동영상 (사진 창구 v3) ──
   창구가 드라이브 "이어 올리기" 자리를 열어 주면, 폰이 8MB씩 나눠 바로 보낸다.
   폰이 바로 못 보내면(브라우저가 막으면) 창구가 조각을 받아 대신 보낸다. 원본 그대로 "동영상" 폴더에 쌓인다 */
const VIDEO_MAX = 1.5e9;
const VCHUNK = 8 * 1024 * 1024;   // 256KB 의 배수여야 한다
const VIDEO_PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#2b2b2b"/><circle cx="450" cy="600" r="90" fill="rgba(255,255,255,.18)"/><path d="M420 545v110l95-55z" fill="#fff"/></svg>');
const isVideo = ph => ph && ph.type === 'video';
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
/* 첫 장면 한 장을 떠서 목록에 사진처럼 보여 준다 (못 뜨면 검은 ▶ 그림) */
function videoPoster(file) {
  return new Promise((ok, no) => {
    const v = document.createElement('video'); const u = URL.createObjectURL(file); let done = false;
    const end = (r, e) => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(u); r ? ok(r) : no(e || new Error('첫 장면을 뜨지 못했어요')); };
    const t = setTimeout(() => end(null), 9000);
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.6, (v.duration || 1) / 3); };
    v.onseeked = () => {
      try {
        const k = Math.min(1, 1600 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => end(b && { blob: b, w: c.width, h: c.height, dur: Math.round(v.duration || 0) }), 'image/jpeg', 0.82);
      } catch (e) { end(null, e); }
    };
    v.onerror = () => end(null);
    v.src = u;
  });
}
/* 동영상 줄이기: 올리기 전에 폰에서 긴 변 1280px·보통 화질 mp4 로 다시 만든다 (Mediabunny = 브라우저 WebCodecs).
   폰 화면 녹화 222MB(44초) 같은 걸 수십 MB 로 줄여 올리기·드라이브 재생 준비가 빨라진다.
   못 줄이거나(오래된 폰·특이한 파일) 별로 안 줄면 원래 파일을 그대로 올린다. 원본은 폰 갤러리에 그대로 있다 */
const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.1/+esm';
const VSHRINK_MIN = 25e6;   // 이보다 작은 동영상은 줄이지 않는다
const VLONG = 1280;
async function shrinkVideo(file, onPct) {
  if (file.size < (window.__VSHRINK_MIN || VSHRINK_MIN) || typeof VideoEncoder === 'undefined') return file;
  try {
    const M = await import(MB_URL);
    const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack(); if (!vt) return file;
    const w = await vt.getDisplayWidth(), h = await vt.getDisplayHeight();
    const k = Math.min(1, VLONG / Math.max(w, h));
    const W = Math.round(w * k / 2) * 2, H = Math.round(h * k / 2) * 2;   // H.264 는 짝수 크기여야 한다
    const avc = await M.canEncodeVideo('avc', { width: W, height: H }).catch(() => false);
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const conv = await M.Conversion.init({ input, output, showWarnings: false,
      video: { width: W, height: H, fit: 'fill', quality: new M.Quality('medium'), forceTranscode: true, ...(avc ? { codec: 'avc' } : {}) } });
    if (!conv.isValid || conv.discardedTracks.some(d => d.track === vt)) return file;
    conv.onProgress = p => onPct && onPct(Math.min(99, Math.round(p * 100)));
    await conv.execute();
    const buf = output.target.buffer;
    if (!buf || buf.byteLength > file.size * 0.8) return file;
    return new File([buf], (file.name || '동영상').replace(/\.\w+$/, '') + '.mp4', { type: 'video/mp4' });
  } catch (e) { console.warn('동영상을 줄이지 못해 원래대로 올려요', e); return file; }
}
async function uploadVideo(file, onPct) {
  const mime = /^video\//.test(file.type || '') ? file.type : 'video/mp4';
  const pv = await videoPoster(file).catch(() => null);
  let poster = null;
  if (pv) try { poster = await gw('upload', { kind: 'photo', name: '동영상 첫 장면', mime: 'image/jpeg', data: await blobToB64(pv.blob) }); } catch (e) {}
  const name = (file.name || '동영상').replace(/\.\w+$/, '');
  let { url } = await gw('vstart', { name, mime, size: file.size, origin: location.origin });
  let direct = true, id = null;
  for (let start = 0; start < file.size;) {
    const part = file.slice(start, Math.min(file.size, start + VCHUNK)); const last = start + part.size - 1;
    let r = null;
    for (let tryN = 0; !r && tryN < 3; tryN++) {
      try {
        if (direct) {
          const res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${last}/${file.size}` }, body: part });
          if (res.status === 308) r = { done: false };
          else if (res.ok) r = { done: true, id: (await res.json()).id };
          else throw new Error('서버 ' + res.status);
        } else r = await gw('vchunk', { url, start, total: file.size, data: await blobToB64(part) });
      } catch (e) {
        if (direct && start === 0) { direct = false; url = (await gw('vstart', { name, mime, size: file.size, origin: location.origin })).url; tryN = -1; continue; }   // 폰이 바로 못 보내면 새 자리를 열어 창구로
        if (tryN === 2) throw new Error('동영상을 다 보내지 못했어요. 와이파이에서 다시 해 주세요');
        await new Promise(w => setTimeout(w, 1500));
      }
    }
    start = last + 1; onPct && onPct(Math.round(start / file.size * 100));
    if (r.done) id = r.id;
  }
  if (!id) throw new Error('동영상 파일을 만들지 못했어요');
  await gw('vdone', { id });
  return { type: 'video', vid: id, id: poster ? poster.id : null, url: poster ? poster.url : VIDEO_PH, thumb: poster ? poster.thumb : VIDEO_PH, w: pv ? pv.w : 900, h: pv ? pv.h : 1200, dur: pv ? pv.dur : 0, mime, size: file.size };
}
/* 틀기용 한 벌: 줄인 동영상을 가족 서버(Supabase Storage "videos")에도 올려, 구글 재생기 대신 폰 재생기로 튼다.
   창구(Edge Function "video")가 가족 암호를 확인하고 한 번 쓰는 올리기 주소를 준다. 창고가 차면 오래된 것부터 빠진다.
   50MB 넘거나 실패하면 없이 간다 (그 동영상은 드라이브 재생 창으로) */
const VFN = `${SB_URL}/functions/v1/video`;
const PLAY_MAX = 50 * 1024 * 1024;
async function vfn(action, body = {}) {
  const res = await fetch(VFN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY, 'x-family-key': familyKey }, body: JSON.stringify({ action, ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || `동영상 창고 오류 (${res.status})`);
  return j;
}
async function uploadPlayCopy(file) {
  if (!file || file.size > PLAY_MAX) return null;
  try {
    const s = await vfn('sign', { size: file.size });
    const res = await fetch(s.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'video/mp4', 'x-upsert': 'false' }, body: file });
    if (!res.ok) return null;
    return { play: s.publicUrl, play_path: s.path };
  } catch (e) { console.warn('틀기용 한 벌을 못 올렸어요', e); return null; }
}
/* 목소리: 드라이브에 비공개로 두고 "drive:파일ID#초" 로 적어 둔다 */
async function uploadVoice(blob, sec) {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const r = await gw('upload', { kind: 'voice', name: '목소리', mime, data: await blobToB64(blob) });
  return `drive:${r.id}#${Math.round(sec || 0)}`;
}
const driveId = u => String(u || '').startsWith('drive:') ? u.slice(6).split('#')[0] : '';
const voiceSec = u => { const m = String(u || '').match(/#(\d+)/); return m ? +m[1] : 0; };
const voiceCache = {};
async function voiceSrc(u) {
  const id = driveId(u); if (voiceCache[id]) return voiceCache[id];
  const r = await gw('get', { id });
  const bin = atob(r.data); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return voiceCache[id] = URL.createObjectURL(new Blob([arr], { type: r.mime }));
}
const fmtSec = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

/* ── 날짜: 전부 이 기기(한국) 날짜 기준. toISOString 은 UTC 라 쓰지 않는다 ── */
const pad = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addYears = (s, n) => { const d = parseYmd(s); d.setFullYear(d.getFullYear() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);   // b - a (일)
const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
const WD = ['일','월','화','수','목','금','토'];
const fmtDate = (s, withYear) => { if (!s) return ''; const d = parseYmd(s); const show = withYear || d.getFullYear() !== new Date().getFullYear(); return `${show ? d.getFullYear() + '년 ' : ''}${d.getMonth()+1}월 ${d.getDate()}일`; };
const fmtDot = s => s ? s.replace(/-/g, '.') : '';
function relDay(day, createdAt) {
  const diff = dayDiff(day, ymd());
  if (diff === 0) {
    if (createdAt) { const m = Math.floor((Date.now() - new Date(createdAt)) / 60000); if (m < 1) return '방금'; if (m < 60) return `${m}분 전`; if (m < 24*60) return `${Math.floor(m/60)}시간 전`; }
    return '오늘';
  }
  if (diff === 1) return '어제';
  if (diff > 1 && diff < 7) return `${diff}일 전`;
  return fmtDate(day);
}
const relTime = iso => relDay(ymd(new Date(iso)), iso);
const ageOn = (birth, on) => { const b = parseYmd(birth), o = parseYmd(on); let a = o.getFullYear() - b.getFullYear(); if (o.getMonth() < b.getMonth() || (o.getMonth() === b.getMonth() && o.getDate() < b.getDate())) a--; return a; };
/* 받침에 맞는 조사: josa('지우','이','가') → '지우가' */
const josa = (w, a, b) => { w = String(w || ''); const c = w.charCodeAt(w.length - 1); return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b); };
const ddayText = n => n === 0 ? '오늘' : n > 0 ? `D-${n}` : `D+${-n}`;

/* ── 음력: 브라우저에 든 한국 달력(dangi)으로 바꾼다 ── */
const LUNAR_FMT = (() => { try { return new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { year:'numeric', month:'numeric', day:'numeric' }); } catch (e) { return null; } })();
function lunarOf(d) {
  if (!LUNAR_FMT) return null;
  const p = {}; LUNAR_FMT.formatToParts(d).forEach(x => p[x.type] = x.value);
  const mm = String(p.month || '');
  return { y: +(p.relatedYear || p.year), m: parseInt(mm.replace(/\D/g, ''), 10), d: parseInt(p.day, 10), leap: /윤/.test(mm) };
}
const lunarYearCache = {};
function lunarYear(Y) {   // 음력 Y년의 (월-일 → 양력 날짜) 표
  if (lunarYearCache[Y]) return lunarYearCache[Y];
  const map = {}; let d = new Date(Y, 0, 10);
  for (let i = 0; i < 420; i++) {
    const l = lunarOf(d); if (!l) break;
    if (l.y > Y) break;
    if (l.y === Y && !l.leap) { const k = l.m + '-' + l.d; if (!map[k]) map[k] = ymd(d); }
    d = addDays(d, 1);
  }
  return lunarYearCache[Y] = map;
}
function solarOfLunar(Y, m, d) { const map = lunarYear(Y); return map[m + '-' + d] || (d === 30 ? map[m + '-29'] : null) || null; }
const lunarText = s => { const l = lunarOf(parseYmd(s)); return l ? `음 ${l.leap ? '윤' : ''}${l.m}.${l.d}` : ''; };

/* 일정 하나가 양력 Y년에 오는 날짜들 */
function occurIn(ev, Y) {
  if (ev.calendar === 'lunar' && ev.lunar_month) {
    return [Y - 1, Y].map(ly => solarOfLunar(ly, ev.lunar_month, ev.lunar_day)).filter(s => s && s.startsWith(Y + '-'));
  }
  if (!ev.event_date) return [];
  if (!ev.yearly) return ev.event_date.startsWith(Y + '-') ? [ev.event_date] : [];
  const [, m, d] = ev.event_date.split('-');
  let s = `${Y}-${m}-${d}`;
  if (m === '02' && d === '29' && new Date(Y, 1, 29).getMonth() !== 1) s = `${Y}-02-28`;
  return ev.event_date.slice(0, 4) <= String(Y) ? [s] : [];
}
function nextOccur(ev, from) {
  const Y = +from.slice(0, 4);
  for (const y of [Y, Y + 1]) { const hit = occurIn(ev, y).filter(s => s >= from).sort()[0]; if (hit) return hit; }
  return null;
}
/* 식구 생일 → 달력용 일정 */
function birthdayEvent(m) {
  if (!m.birth_date) return null;
  const base = { id: 'bd-' + m.id, title: `${m.name} 생일`, kind: 'birthday', member_id: m.id, yearly: true, virtual: true };
  if (m.bday_lunar) { const l = lunarOf(parseYmd(m.birth_date)); if (l) return { ...base, calendar: 'lunar', lunar_month: l.m, lunar_day: l.d }; }
  return { ...base, calendar: 'solar', event_date: m.birth_date };
}
/* 공휴일 (설·추석·부처님오신날은 음력으로 계산, 대체공휴일은 뺌) */
const holCache = {};
function holidays(Y) {
  if (holCache[Y]) return holCache[Y];
  const h = {}; const put = (s, n) => { if (s) h[s] = h[s] ? h[s] + '·' + n : n; };
  [['01-01','신정'],['03-01','삼일절'],['05-05','어린이날'],['06-06','현충일'],['08-15','광복절'],['10-03','개천절'],['10-09','한글날'],['12-25','성탄절']].forEach(([md, n]) => put(`${Y}-${md}`, n));
  const sl = solarOfLunar(Y, 1, 1); if (sl) { put(ymd(addDays(parseYmd(sl), -1)), '설 연휴'); put(sl, '설날'); put(ymd(addDays(parseYmd(sl), 1)), '설 연휴'); }
  const ch = solarOfLunar(Y, 8, 15); if (ch) { put(ymd(addDays(parseYmd(ch), -1)), '추석 연휴'); put(ch, '추석'); put(ymd(addDays(parseYmd(ch), 1)), '추석 연휴'); }
  put(solarOfLunar(Y, 4, 8), '부처님오신날');
  return holCache[Y] = h;
}

/* 이번 주의 질문: 질문 상자(기본 50개 + 식구가 넣은 것)는 DB question_bank 표에 있다 */

/* ── 휴대폰 뒤로가기 = 맨 위 창 닫기 ── */
/* 창을 열면 기록 한 칸을 쌓고, 화면에서 닫으면 그 칸을 되돌린다.
   history.back() 은 늦게 끝나므로, 되돌리는 중에 새 창이 열리면 쌓기를 잠깐 미뤘다가 한다 */
const layerStack = []; let pendingBack = 0; let queuedPush = 0;
const histPush = () => { if (pendingBack > 0) queuedPush++; else history.pushState({ fz: 1 }, ''); };
const histBack = () => { pendingBack++; history.back(); };
window.addEventListener('popstate', () => {
  if (pendingBack > 0) { pendingBack--; if (!pendingBack) for (; queuedPush > 0; queuedPush--) history.pushState({ fz: 1 }, ''); return; }
  const top = layerStack.pop(); if (top) top.close();
});
function useLayer(open, close) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const me = { close: () => { me.popped = true; closeRef.current(); } };
    layerStack.push(me); histPush();
    return () => {
      const i = layerStack.indexOf(me); if (i >= 0) layerStack.splice(i, 1);
      if (me.popped) return;
      if (queuedPush > 0) queuedPush--; else histBack();
    };
  }, [open]);
}

/* ── 말하기 → 글 (브라우저 음성 인식) ── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function useDictation(append) {
  const [on, setOn] = useState(false); const ref = useRef(null);
  const appendRef = useRef(append); appendRef.current = append;
  const toggle = () => {
    if (!SR) { alert('이 폰에서는 말로 쓰기가 안 돼요. 크롬이나 사파리에서 열어 주세요.'); return; }
    if (ref.current) { ref.current.stop(); return; }
    const rec = new SR(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) appendRef.current(e.results[i][0].transcript.trim()); };
    rec.onend = () => { ref.current = null; setOn(false); };
    rec.onerror = ev => { if (ev.error === 'not-allowed') alert('마이크 사용을 허락해 주세요.'); };
    ref.current = rec; try { rec.start(); setOn(true); } catch (e) { ref.current = null; }
  };
  useEffect(() => () => { if (ref.current) ref.current.stop(); }, []);
  return { on, toggle };
}
const joinText = (s, t) => (s && s.trim() ? s.replace(/\s+$/, '') + ' ' : '') + t;

/* ── 목소리 녹음 (녹음하면서 받아쓰기도 같이 시도) ── */
function useRecorder() {
  const [on, setOn] = useState(false); const [sec, setSec] = useState(0); const [live, setLive] = useState('');
  const r = useRef({});
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const c = { stream, mr, chunks: [], t0: Date.now(), text: '', live: '', restarts: 0 };
    mr.ondataavailable = e => { if (e.data && e.data.size) c.chunks.push(e.data); };
    r.current = c; mr.start(500);
    c.timer = setInterval(() => setSec(Math.round((Date.now() - c.t0) / 1000)), 500);
    if (SR) {
      try {
        const rec = new SR(); rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true;
        let done = '';
        rec.onresult = e => { let fin = '', tmp = ''; for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + ' '; else tmp += t; } c.text = (done + fin).trim(); c.live = (done + fin + tmp).trim(); setLive(c.live); };
        rec.onend = () => { done = c.text ? c.text + ' ' : done; if (c.rec === rec && mr.state === 'recording' && c.restarts++ < 15) { try { rec.start(); } catch (e) {} } };
        rec.onerror = () => {};
        rec.start(); c.rec = rec;
      } catch (e) {}
    }
    setSec(0); setLive(''); setOn(true);
  };
  const finish = keep => new Promise(ok => {
    const c = r.current; if (!c.mr) return ok(null);
    clearInterval(c.timer); const rec = c.rec; c.rec = null; if (rec) { try { rec.stop(); } catch (e) {} }
    c.mr.onstop = () => {
      c.stream.getTracks().forEach(t => t.stop()); setOn(false); r.current = {};
      ok(keep ? { blob: new Blob(c.chunks, { type: c.mr.mimeType || 'audio/webm' }), sec: Math.max(1, Math.round((Date.now() - c.t0) / 1000)), text: (c.text || c.live || '').trim() } : null);
    };
    c.mr.stop();
  });
  useEffect(() => () => { const c = r.current; if (c.mr && c.mr.state !== 'inactive') { clearInterval(c.timer); try { c.mr.stop(); } catch (e) {} c.stream.getTracks().forEach(t => t.stop()); } }, []);
  return { on, sec, live, start, stop: () => finish(true), cancel: () => finish(false) };
}

/* ── 소리 내어 읽어 주기 ── */
function speak(text, onEnd) {
  const s = window.speechSynthesis;
  if (!s) { alert('이 폰은 읽어 주기를 지원하지 않아요.'); return false; }
  s.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 0.92;
  const ko = s.getVoices().find(v => /ko/i.test(v.lang)); if (ko) u.voice = ko;
  u.onend = u.onerror = () => onEnd && onEnd();
  s.speak(u); return true;
}

/* ── 앱으로 설치 ──
   크롬 155 는 같은 주소(github.io)에 다른 앱이 깔려 있으면 메뉴의 설치를 막아 버린다.
   페이지가 받은 설치 신호(beforeinstallprompt)로 직접 설치 창을 띄우면 그래도 깔린다.
   아이폰은 이 신호가 없어서 사파리 "홈 화면에 추가" 안내만 보여 준다. */
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump(x => x + 1); addEventListener('fz-inst', f); return () => removeEventListener('fz-inst', f); }, []);
  const standalone = isStandalone() || !!window.__installed;
  return {
    standalone, ios: IS_IOS && !standalone, can: !standalone && !!window.__inst,
    install: async () => {
      const e = window.__inst; if (!e) return false;
      e.prompt(); const c = await e.userChoice; window.__inst = null; dispatchEvent(new Event('fz-inst'));
      return c.outcome === 'accepted';
    }
  };
}
function InstallCard({ inSettings }) {
  const C = useC(); const I = useInstall();
  const [hide, setHide] = useState(() => !inSettings && store.get('fz_inst_hide') > ymd());
  if (I.standalone || hide || (!I.can && !I.ios && !inSettings)) return null;
  const body = I.can ? '홈 화면 아이콘으로 바로 열려요. 주소창 없이 앱처럼 쓸 수 있어요.'
    : I.ios ? <>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 눌러 주세요.</>
    : <>크롬 오른쪽 위 <b>⋮ → 홈 화면에 추가</b>를 눌러 주세요.</>;
  return (
    <div className={inSettings ? '' : 'banner'} style={inSettings ? { background: '#f6f6f6', borderRadius: 14, padding: 12 } : { alignItems: 'flex-start' }}>
      {!inSettings && <img src="icon-192.png?v=2" alt="" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }}/>}
      <div className="grow">
        {!inSettings && <b>Familygram을 앱으로 설치</b>}
        <span style={{ display: 'block', fontSize: '.9rem', color: 'var(--sub)', margin: '2px 0 8px' }}>{body}</span>
        <div className="row gap">
          {I.can && <button className="btn sm primary" onClick={async () => { if (await I.install()) C.toast('설치했어요. 홈 화면의 Familygram 아이콘으로 열어 보세요'); }}><LIcon name="download" size={18}/>앱으로 설치</button>}
          {!inSettings && <button className="btn sm soft" onClick={() => { store.set('fz_inst_hide', ymd(addDays(new Date(), 14))); setHide(true); }}>나중에</button>}
        </div>
      </div>
    </div>
  );
}

/* ── 폰 알림 (Web Push) ──
   "알림 받기"를 누르면 이 폰의 알림 주소를 push_subs 표에 적는다. 식구가 무언가 올리면
   Supabase 의 notify 함수가 그 주소로 알림을 보내고, sw.js 가 폰 알림으로 띄운다.
   밤 10시~아침 8시 것은 서버가 모아 두었다가 아침에 보낸다. */
const VAPID_PUB = 'BCXSOfWZ11rtXk2VdgjbGEs_-sR8G4lKgN9w7Rqkd0VPSsF2WYaPEHfy7MYPVIRDTVkvd3cm23Pa_FDVG0r3RLY';
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const swReady = PUSH_OK ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);
const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
/* 이 폰을 구분하는 값 (알림 주소가 새로 생기면 같은 폰의 옛 주소를 지우는 데 쓴다) */
const deviceId = (() => { let d = store.get('fz_dev'); if (!d) { d = Math.random().toString(36).slice(2, 12); store.set('fz_dev', d); } return d; })();
const savePushSub = async (member, sub) => {
  const j = sub.toJSON();
  await db.upsert('push_subs', { member_id: member, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceId, ua: navigator.userAgent.slice(0, 160) }, 'endpoint');
  await db.del('push_subs', `device=eq.${deviceId}&endpoint=neq.${encodeURIComponent(j.endpoint)}`).catch(() => {});
};
const pushSub = async () => { const reg = await swReady; return reg ? reg.pushManager.getSubscription() : null; };
/* 알림 주소 저절로 고치기: 한 번 허용한 폰이면 앱을 열 때마다 확인해서, 주소가 없거나 서버가 만료로 지운 주소면
   묻지 않고 새 주소를 받아 적는다. (안드로이드 크롬은 앱 설치·업데이트 때 알림 주소를 가끔 바꾼다)
   "이 폰 알림 끄기"를 누른 폰(fz_push_off)은 건드리지 않는다 */
let ensuring = null;
const ensurePush = member => ensuring || (ensuring = (async () => {
  try {
    if (!PUSH_OK || !member || Notification.permission !== 'granted' || store.get('fz_push_off')) return false;
    const reg = await swReady; if (!reg) return false;
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const rows = await db.list('push_subs', `select=id&endpoint=eq.${encodeURIComponent(sub.endpoint)}&order=id`).catch(() => null);
      if (rows && !rows.length && store.get('fz_push_ep') === sub.endpoint) { await sub.unsubscribe().catch(() => {}); sub = null; }   // 서버가 만료로 지운 주소
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUB) });
    await savePushSub(member, sub); store.set('fz_push_ep', sub.endpoint);
    dispatchEvent(new Event('fz-push'));
    return true;
  } catch (e) { return false; } finally { ensuring = null; }
})());
const PUSH_PREFS = [['post', '새 소식 · 새 댓글 · 오늘의 한 장'], ['react', '내 소식에 남긴 마음 (❤️😂👍 …)'], ['letter', '편지 · 나에게 온 질문'], ['day', '생일 · 행사 하루 전 (아침 8시)'], ['pray', '함께 기도해요 (기도 제목 · 기도했어요 · 응답)'], ['quiet', '밤 10시~아침 8시는 조용히 (아침에 모아서)']];
function usePush() {
  const C = useC();
  const [st, setSt] = useState({ ready: false, perm: PUSH_OK ? Notification.permission : 'unsupported', row: null, busy: false });
  const load = async () => {
    if (!PUSH_OK) { setSt(x => ({ ...x, ready: true })); return; }
    const sub = await pushSub(); let row = null;
    if (sub) { try { row = (await db.list('push_subs', `select=*&endpoint=eq.${encodeURIComponent(sub.endpoint)}&order=id`))[0] || null; } catch (e) {} }
    setSt(x => ({ ...x, ready: true, perm: Notification.permission, row }));
  };
  useEffect(() => { load(); const f = () => load(); addEventListener('fz-push', f); return () => removeEventListener('fz-push', f); }, []);
  const on = async () => {
    setSt(x => ({ ...x, busy: true }));
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { C.toast(perm === 'denied' ? '알림이 막혀 있어요. 폰 설정 → 애플리케이션 → Familygram(또는 크롬) → 알림을 켜 주세요' : '알림을 허락해야 받을 수 있어요'); return; }
      if (!(await swReady)) throw new Error('이 폰은 알림을 지원하지 않아요');
      store.del('fz_push_off');
      if (!(await ensurePush(C.me))) throw new Error('알림 주소를 받지 못했어요. 잠시 뒤 다시 눌러 주세요');
      C.toast('알림을 켰어요 🔔 식구가 소식을 올리면 알려 드릴게요');
    } catch (e) { C.toast('알림을 켜지 못했어요: ' + e.message); }
    finally { setSt(x => ({ ...x, busy: false })); dispatchEvent(new Event('fz-push')); }
  };
  const off = async () => {
    const sub = await pushSub();
    store.set('fz_push_off', '1');   // 일부러 끈 폰은 저절로 다시 켜지 않는다
    if (sub) { try { await db.del('push_subs', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`); } catch (e) {} await sub.unsubscribe().catch(() => {}); }
    C.toast('이 폰의 알림을 껐어요'); dispatchEvent(new Event('fz-push'));
  };
  const setPref = async (k, v) => {
    const row = st.row; if (!row) return;
    const prefs = { ...row.prefs, [k]: v }; setSt(x => ({ ...x, row: { ...row, prefs } }));
    try { await db.patch('push_subs', row.id, { prefs }); } catch (e) { C.toast('저장하지 못했어요'); }
  };
  /* 서버를 거쳐 이 폰으로 진짜 알림 한 통 (알림이 잘 오는지 확인용) */
  const sample = async () => {
    const sub = await pushSub();
    if (!sub) { C.toast('알림이 꺼져 있어요. 알림 받기를 다시 눌러 주세요'); dispatchEvent(new Event('fz-push')); return; }
    C.toast('시험 알림을 보냈어요. 몇 초 뒤 폰 맨 위를 보세요');
    try {
      const r = await fetch(`${SB_URL}/functions/v1/notify?mode=self`, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (!r.ok) { C.toast('알림 주소를 새로 받는 중이에요. 잠시 뒤 다시 눌러 주세요'); await sub.unsubscribe().catch(() => {}); store.del('fz_push_ep'); ensurePush(C.me); }
    } catch (e) { C.toast('시험 알림을 보내지 못했어요: ' + e.message); }
  };
  return { ...st, supported: PUSH_OK, needsInstall: IS_IOS && !isStandalone(), on, off, setPref, sample };
}
/* 홈 위쪽 "알림 받기" 카드 (앱 설치 카드가 먼저 보일 땐 숨김) */
function PushCard() {
  const P = usePush(); const I = useInstall();
  const [hide, setHide] = useState(() => store.get('fz_push_hide') > ymd());
  if (!P.ready || !P.supported || P.needsInstall || P.row || P.perm !== 'default' || hide || I.can) return null;
  return (
    <div className="banner" style={{ alignItems: 'flex-start' }}>
      <div className="bic" style={{ background: '#FFEDEE', color: '#ED4956' }}><LIcon name="bell-ring"/></div>
      <div className="grow">
        <b>새 소식 알림 받기</b>
        <span style={{ display: 'block', fontSize: '.9rem', color: 'var(--sub)', margin: '2px 0 8px' }}>식구가 소식·댓글·편지를 남기면 폰에 알려 드려요. 앱 아이콘에 숫자도 떠요.</span>
        <div className="row gap">
          <button className="btn sm primary" disabled={P.busy} onClick={P.on}>{P.busy ? <span className="spin"/> : <LIcon name="bell" size={18}/>}알림 받기</button>
          <button className="btn sm soft" onClick={() => { store.set('fz_push_hide', ymd(addDays(new Date(), 14))); setHide(true); }}>나중에</button>
        </div>
      </div>
    </div>
  );
}
/* 설정 안의 알림 칸 */
function PushSettings() {
  const P = usePush();
  const box = { background: '#f6f6f6', borderRadius: 14, padding: 12, fontSize: '.95rem' };
  if (!P.ready) return <div style={box}><div className="row gap"><span className="spin dark"/>확인하는 중…</div></div>;
  if (!P.supported) return <div style={box}>이 폰(브라우저)은 알림을 지원하지 않아요. 크롬이나 사파리에서 열어 주세요.</div>;
  if (P.needsInstall) return <div style={box}>아이폰은 먼저 사파리 <b>공유 → 홈 화면에 추가</b>를 하고, 홈 화면의 Familygram 아이콘으로 연 다음에 알림을 켤 수 있어요.</div>;
  if (P.perm === 'denied') return <div style={box}>알림이 막혀 있어요. 폰 <b>설정 → 애플리케이션 → Familygram</b>(또는 크롬) <b>→ 알림</b>을 켠 뒤 다시 와 주세요.</div>;
  if (!P.row) return (
    <div style={box}>
      <div style={{ marginBottom: 10 }}>식구가 소식·댓글·편지를 남기면 이 폰에 알려 드려요.</div>
      <button className="btn sm primary" disabled={P.busy} onClick={P.on}>{P.busy ? <span className="spin"/> : <LIcon name="bell" size={18}/>}알림 받기</button>
    </div>
  );
  return (
    <div style={box}>
      <div className="row gap" style={{ marginBottom: 4 }}><LIcon name="bell-ring" size={18}/><b className="grow">이 폰은 알림을 받고 있어요</b></div>
      {PUSH_PREFS.map(([k, l]) => <Toggle key={k} on={P.row.prefs[k] !== false} onChange={v => P.setPref(k, v)} label={l}/>)}
      <div className="row gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn sm soft" onClick={P.sample}><LIcon name="bell" size={16}/>내 폰으로 시험 알림 받기</button>
        <button className="btn sm soft danger" onClick={P.off}>이 폰 알림 끄기</button>
      </div>
      {!IS_IOS && <p className="small muted" style={{ margin: '8px 0 0' }}>갤럭시에서 아이콘에 점 대신 숫자로 보려면: 폰 설정 → 알림 → 고급 설정 → 앱 아이콘 배지 → 숫자</p>}
    </div>
  );
}
/* 앱을 열면 아이콘 숫자·쌓인 알림을 지운다 */
function clearBadge() {
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  swReady.then(reg => reg && reg.getNotifications().then(ns => ns.forEach(n => n.close()))).catch(() => {});
  pushSub().then(sub => sub && db.rpc('push_seen', { p_endpoint: sub.endpoint })).catch(() => {});
}

const Ctx = createContext(null);
const useC = () => useContext(Ctx);
const SAVE = '🔖';
/* 소식에 남기는 마음: 한 사람당 하나. 하트는 한 번 누르기, 나머지는 하트를 누르면 뜨는 줄에서 고른다 */
/* 마음 16가지 (8개씩 두 줄). 앞 8개는 예전부터 쓰던 것 — 순서를 바꾸지 않는다 */
const REACTS = [['❤️', '좋아요'], ['🥰', '사랑스러워요'], ['😂', '웃겨요'], ['👍', '최고예요'], ['😮', '놀라워요'], ['😢', '슬퍼요'], ['🙏', '기도해요'], ['🎉', '축하해요'],
  ['🤣', '빵 터졌어요'], ['👏', '박수 쳐요'], ['🤗', '안아 줄게요'], ['💪', '힘내요'], ['🥺', '뭉클해요'], ['😭', '눈물 나요'], ['🤔', '궁금해요'], ['😋', '맛있겠다']];
const reactWord = e => (REACTS.find(x => x[0] === e) || [e, '마음을 남겼어요'])[1];
const isLocked = x => !!(x.open_on && x.open_on > ymd());
const photosOf = p => Array.isArray(p.photos) ? p.photos : [];

/* 기도 손 그림 (사용자가 준 그림에서 손 모양만 딴 것) — 기도 화면의 🙏 이모지 대신. 글자로만 나가는 알림·토스트는 🙏 그대로 */
const PrayHands = ({ size = 18, style }) => <img className="pray-hands" src="pray-hands-96.png" srcSet="pray-hands-96.png 1x, pray-hands-192.png 2x" width={size} height={size} alt="" style={style}/>;

/* ═══════════ 작은 부품들 ═══════════ */
function Avatar({ m, size = 32, ring, onClick }) {
  const inner = (
    <div className="av-in" style={{ width: size, height: size, fontSize: size * 0.55, background: m.avatar ? '#eee' : (m.color || '#999') + '22' }}>
      {m.avatar ? <img src={m.avatar} alt=""/> : (m.emoji || '🙂')}
    </div>
  );
  const Tag = onClick ? 'button' : 'div';
  if (!ring) return <Tag className="av" onClick={onClick} aria-label={m.name}>{inner}</Tag>;
  return <Tag className={'av ring ' + ring} onClick={onClick} aria-label={m.name} style={{ padding: size > 60 ? 3 : 2.5 }}><div className="av-gap">{inner}</div></Tag>;
}

function VoicePlayer({ src }) {
  const [st, setSt] = useState('idle'); const [pos, setPos] = useState(0);
  const au = useRef(null); const total = voiceSec(src);
  const toggle = async e => {
    if (e) e.stopPropagation();
    if (st === 'playing') { au.current.pause(); return; }
    if (au.current) { au.current.play(); return; }
    setSt('loading');
    try {
      const a = new Audio(await voiceSrc(src)); au.current = a;
      a.ontimeupdate = () => setPos(a.currentTime);
      a.onplay = () => setSt('playing'); a.onpause = () => setSt('paused'); a.onended = () => { setSt('idle'); setPos(0); };
      await a.play();
    } catch (err) { setSt('idle'); au.current = null; alert('목소리를 불러오지 못했어요: ' + err.message); }
  };
  useEffect(() => () => { if (au.current) au.current.pause(); }, []);
  const pct = total ? Math.min(100, pos / total * 100) : 0;
  return (
    <div className="vp">
      <button className="vp-b" onClick={toggle} aria-label={st === 'playing' ? '멈추기' : '목소리 듣기'}>
        {st === 'loading' ? <span className="spin"/> : <LIcon name={st === 'playing' ? 'pause' : 'play'} size={16} fill="#fff" stroke="#fff"/>}
      </button>
      <div className="wave"><i style={{ width: pct + '%' }}/></div>
      <small>{fmtSec(st === 'idle' ? total : pos)}</small>
    </div>
  );
}

/* ── 🎵 스토리에 까는 음악: 애플 뮤직 공식 30초 미리 듣기 ──
   파일은 복사하지 않고 주소·곡 정보만 적는다. 한국 스토어 검색은 비어 있어서 미국 스토어로 찾는다(한국 노래도 나옴).
   주소가 바뀌어 안 나오면 곡 번호로 다시 찾는다 */
const MUSIC_SEC = 30;
async function searchMusic(q) {
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=US&media=music&entity=song&limit=25`);
  const j = await res.json();
  return (j.results || []).filter(r => r.previewUrl).map(r => ({ src: 'apple', id: r.trackId, title: r.trackName, artist: r.artistName, art: (r.artworkUrl100 || '').replace('100x100', '300x300'), preview: r.previewUrl, link: r.trackViewUrl, dur: Math.round((r.trackTimeMillis || 0) / 1000) }));
}
/* 추천 노래: [애플 곡 번호, 한글 제목, 가수] — 애플은 제목을 영어로 줄 때가 많아서 이름은 우리가 적어 둔다.
   번호는 2026-10-29 미국 스토어에서 미리 듣기가 있는 것만 골랐다. 고를 때 한 번에 lookup 해서 미리 듣기·앨범 그림을 받는다 */
const MUSIC_RECO = {
  winter: [[1567943669, '눈의 꽃', '박효신'], [1569425907, '첫눈처럼 너에게 가겠다', '에일리'], [1320693447, '눈', '자이언티'], [1602185217, '겨울잠', '아이유'], [1543850904, '거리에서', '성시경']],
  spring: [[1570572282, '벚꽃 엔딩', '버스커 버스커'], [1596529381, '봄날', '방탄소년단'], [639483987, '봄봄봄', '로이킴'], [858263219, '봄 사랑 벚꽃 말고', '하이포·아이유'], [1747833892, '봄이 좋냐??', '10CM'], [1570572505, '꽃송이가', '버스커 버스커']],
  may: [[1855745027, '엄마가 딸에게', '양희은'], [1641834082, '아버지', '인순이'], [1514571911, '가족사진', '김진호'], [1262264096, '사랑으로', '해바라기'], [1619308992, '걱정말아요 그대', '이적']],
  summer: [[311455760, '여행을 떠나요', '조용필'], [1692686518, 'Super Shy', '뉴진스'], [1256504651, '빨간 맛', '레드벨벳'], [1085987673, '해변의 여인', '쿨'], [1825017994, '여름 안에서', '듀스']],
  autumn: [[1640417971, '가을 우체국 앞에서', '윤도현'], [1262248268, '잊혀진 계절', '이용'], [1286574372, '가을 아침', '아이유'], [879281078, '너의 의미', '아이유'], [1455180438, '가을이 오면', '이문세'], [1804634460, '가을 타나 봐', '바이브']],
  xmas: [[585972803, 'All I Want for Christmas Is You', '머라이어 캐리'], [1527028399, '크리스마스니까', '성시경 외'], [954190697, '울면 안 돼', '캐롤'], [200299291, '루돌프 사슴코', 'Gene Autry'], [282658482, 'Last Christmas', 'Wham!']],
  family: [[1514571911, '가족사진', '김진호'], [1855745027, '엄마가 딸에게', '양희은'], [1641834082, '아버지', '인순이'], [1619308992, '걱정말아요 그대', '이적'], [1262264096, '사랑으로', '해바라기'], [1618396192, '행복의 나라로', '한대수'], [879281078, '너의 의미', '아이유']],
  bday: [[1440821356, 'Happy Birthday', '스티비 원더'], [1677098419, '생일 축하합니다 (자장가)', '뽀로로'], [1653589759, '생일 축하 노래', '동요'], [1842817718, '너에게 난, 나에게 넌', '자전거 탄 풍경']],
  praise: [[1635521450, '주 하나님 지으신 모든 세계', '어노인팅'], [1609910802, '은혜', '손경민'], [1786068310, '나의 영혼이 잠잠히', '김예린'], [1699518213, '당신은 사랑받기 위해 태어난 사람', '찬양'], [1344734599, '아무것도 두려워 말라', '김윤진'], [1653103191, '주님의 마음을 가진 자', '김도현']],
  trot: [[1589204991, '사랑은 늘 도망가', '임영웅'], [1552566188, '테스형!', '나훈아'], [1653754052, '어머나', '장윤정'], [1562005525, '사랑의 배터리', '홍진영'], [1497092257, '막걸리 한잔', '영탁'], [1708199577, '가인이어라', '송가인']],
  calm: [[1219218446, '밤편지', '아이유'], [1823608078, '옛 사랑', '이문세'], [1358198517, '사랑이 지나가면', '이문세'], [1448341239, '바람이 분다', '이소라'], [1501124618, '서른 즈음에', '김광석'], [1543850531, '두 사람', '성시경']],
  fun: [[1823627863, 'Dynamite', '방탄소년단'], [1635469851, 'Hype Boy', '뉴진스'], [1445144527, '강남스타일', '싸이'], [1333468525, '붉은 노을', '빅뱅'], [1616804152, 'LOVE DIVE', '아이브']],
  kids: [[1418771363, '아기 상어', '핑크퐁'], [958811333, '곰 세 마리', '동요'], [1661757521, '반짝반짝 작은 별', '동요'], [1553105698, '나비야', '동요'], [1623571795, '둥근 해가 떴습니다', '동요']],
};
/* 이달의 추천: 달마다 계절 노래 (5월은 가정의 달, 12월은 크리스마스) */
const monthReco = (mo = new Date().getMonth() + 1) => mo === 12 ? ['xmas', '🎄 12월 · 크리스마스'] : mo <= 2 ? ['winter', `❄️ ${mo}월 · 겨울 노래`] : mo <= 4 ? ['spring', `🌸 ${mo}월 · 봄 노래`] : mo === 5 ? ['may', '💐 5월 · 가정의 달'] : mo <= 8 ? ['summer', `🌊 ${mo}월 · 여름 노래`] : ['autumn', `🍂 ${mo}월 · 가을 노래`];
const RECO_TABS = [['family', '💕 가족·사랑'], ['bday', '🎂 생일·축하'], ['praise', '🙏 찬양'], ['trot', '🎤 트로트'], ['calm', '🌙 잔잔한'], ['fun', '🎉 신나는'], ['kids', '🧒 동요']];
/* 이달의 노래 제목 (애플 뮤직처럼 이모지 없이) */
const monthTitle = (mo = new Date().getMonth() + 1) => [`${mo}월의 노래`, mo === 12 ? '크리스마스에 듣기 좋은 곡' : mo <= 2 ? '겨울에 어울리는 곡' : mo <= 4 ? '봄에 어울리는 곡' : mo === 5 ? '가정의 달, 가족에게 들려주고 싶은 곡' : mo <= 8 ? '여름에 어울리는 곡' : '가을에 어울리는 곡'];
/* 오늘의 추천: 이달 노래·계절·동요·생일을 뺀 추천곡(가족·찬양·트로트·잔잔한·신나는)에서 날마다 10곡 (그날은 늘 같은 10곡) */
/* 날짜를 씨앗으로 섞기 (그날은 식구 모두 같은 순서) */
function dayShuffle(arr, day = ymd(), salt = 7) {
  let s = [...day].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, salt);
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  return arr.map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}
function todayMix(skip, day = ymd(), n = 10) {
  const seen = new Set((MUSIC_RECO[skip] || []).map(x => x[0]));
  const all = Object.entries(MUSIC_RECO).filter(([k]) => k !== skip && !['winter', 'spring', 'summer', 'autumn', 'xmas', 'may', 'kids', 'bday'].includes(k)).flatMap(([, l]) => l).filter(x => !seen.has(x[0]) && seen.add(x[0]));
  return dayShuffle(all, day).slice(0, n);
}
/* 추천곡을 다 보면 이어서: 가수 이름으로 애플에서 찾아 계속 붙인다 (그날 순서로, 한 번에 한 가수) */
const MUSIC_FEED = ['아이유', '성시경', '이문세', '김광석', '임영웅', '폴킴', '10CM', '악뮤', '볼빨간사춘기', '잔나비', '멜로망스', '이적', '윤종신', '박효신', '거미', '에일리', '이소라', '김동률', '토이 유희열', '신승훈',
  '조용필', '이선희', '양희은', '송가인', '장윤정', '영탁', '이찬원', '김호중', '뉴진스', '아이브', '방탄소년단', '세븐틴', '데이식스', '마마무', '태연', '백지영', '버즈', '김범수', '나얼', '브라운아이즈', '어노인팅', '마커스워십', '제이어스', '유재하', '김건모', '015B'];
const recoCache = {};
async function loadReco(key, given) {
  if (recoCache[key]) return recoCache[key];
  const list = given || MUSIC_RECO[key] || [];
  const j = await (await fetch(`https://itunes.apple.com/lookup?id=${list.map(x => x[0]).join(',')}&country=US&entity=song`)).json();
  const by = {}; (j.results || []).forEach(r => { if (r.previewUrl) by[r.trackId] = r; });
  return recoCache[key] = list.filter(([id]) => by[id]).map(([id, title, artist]) => ({ src: 'apple', id, title, artist, art: (by[id].artworkUrl100 || '').replace('100x100', '300x300'), preview: by[id].previewUrl, link: by[id].trackViewUrl, dur: Math.round((by[id].trackTimeMillis || 0) / 1000) }));
}
/* 저장됨(책갈피): 이 폰에만 적어 둔다 (식구마다 폰이 하나라서) */
const savedMusic = () => { try { return JSON.parse(store.get('fz_music_saved') || '[]'); } catch (e) { return []; } };
async function musicUrl(m) {
  try { const j = await (await fetch(`https://itunes.apple.com/lookup?id=${m.id}&country=US`)).json(); const r = (j.results || [])[0]; return (r && r.previewUrl) || null; } catch (e) { return null; }
}
/* 음악 한 곡 재생기: 시작 위치부터 끝까지, 주소가 죽었으면 한 번 새로 찾아 다시 */
function playMusic(m, { onEnd, onFail } = {}) {
  const a = new Audio(m.preview); let retried = false;
  a.onloadedmetadata = () => { if (m.start) a.currentTime = Math.min(m.start, Math.max(0, (a.duration || MUSIC_SEC) - 5)); };
  a.onended = () => onEnd && onEnd();
  a.onerror = async () => { if (retried) { onFail && onFail(); return; } retried = true; const u = await musicUrl(m); if (!u) { onFail && onFail(); return; } a.src = u; a.play().catch(() => onFail && onFail()); };
  return a;
}
/* 스토리 위에 뜨는 곡 이름 (재생은 스토리가 한다) */
function MusicTag({ m }) {
  return <span className="s-mtag">{m.art && <img src={m.art} alt=""/>}<span>🎵 <b>{m.title}</b> · {m.artist}</span>{m.link && <a href={m.link} target="_blank" rel="noopener">Apple Music</a>}</span>;
}
/* 재생기 버리기: 먼저 이벤트를 떼야 한다 (주소를 비우면 onerror 가 '주소가 죽었다'며 다시 찾아 틀어 버린다) */
function dropAudio(a) {
  if (!a) return;
  a.onerror = null; a.onended = null; a.onloadedmetadata = null;
  try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {}
}
function MusicChip({ m, dark }) {
  const [on, setOn] = useState(false); const au = useRef(null);
  useEffect(() => () => { if (au.current) au.current.pause(); }, []);
  const toggle = e => {
    e.stopPropagation();
    if (on) { au.current.pause(); setOn(false); return; }
    if (!au.current) au.current = playMusic(m, { onEnd: () => setOn(false), onFail: () => { setOn(false); alert('음악을 불러오지 못했어요'); } });
    au.current.play().then(() => setOn(true)).catch(() => setOn(false));
  };
  return (
    <div className={'mchip' + (dark ? ' dark' : '')}>
      <button onClick={toggle} aria-label={on ? '음악 멈추기' : '음악 듣기'}>{m.art ? <img src={m.art} alt=""/> : null}<span className="mp"><LIcon name={on ? 'pause' : 'play'} size={14} fill="#fff" stroke="#fff"/></span></button>
      <span className="mt"><b>🎵 {m.title}</b><span>{m.artist}</span></span>
      {m.link && <a href={m.link} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>Apple Music</a>}
    </div>
  );
}
/* 음악 고르기: 검색 → 미리 듣기 → 고르기 → 시작 위치 */
/* 소식 쓰기 안의 음악 칸: 고른 노래 + 시작 위치. 고르기는 아래에서 올라오는 큰 음악 창(MusicSheet)에서 */
function MusicPicker({ value, onChange }) {
  const [open, setOpen] = useState(!value);
  return (
    <>
      {value ? <MusicTrim m={value} onStart={s => onChange({ ...value, start: s })} onChange={() => setOpen(true)}/>
        : <button type="button" className="btn primary block" onClick={() => setOpen(true)}><LIcon name="music" size={20}/>노래 고르기</button>}
      <MusicSheet open={open} onClose={() => setOpen(false)} onPick={m => { onChange(m); setOpen(false); }}/>
    </>
  );
}
/* 고른 노래 카드 + 시작 지점 고르기 (인스타 음악 자르기처럼)
   30초 미리 듣기를 파형 줄로 보여 주고, 줄을 누르거나 끌면 시작 지점이 바뀐다. 재생하면 진행선이 따라 움직인다.
   마지막 5초는 남겨 두려고 시작은 0~25초 */
const TRIM_MAX = 25;
function MusicTrim({ m, onStart, onChange }) {
  const start = m.start || 0;
  const [on, setOn] = useState(false); const [pos, setPos] = useState(start); const au = useRef(null); const raf = useRef(0); const bar = useRef(null); const drag = useRef(false);
  const bars = useMemo(() => { let s = (m.id || 7) % 2147483647; return Array.from({ length: 46 }, (_, i) => { s = (s * 16807) % 2147483647; const wave = 0.55 + 0.35 * Math.sin(i / 3.1) * Math.sin(i / 7.3); return Math.max(0.18, Math.min(1, wave * (0.55 + (s / 2147483647) * 0.6))); }); }, [m.id]);
  const stop = () => { cancelAnimationFrame(raf.current); if (au.current) au.current.pause(); setOn(false); };
  useEffect(() => () => { cancelAnimationFrame(raf.current); if (au.current) au.current.pause(); }, []);
  /* 다른 노래로 바뀌면 예전 노래 재생기를 버린다 (안 버리면 새 노래를 눌러도 예전 노래가 나온다) */
  useEffect(() => { cancelAnimationFrame(raf.current); dropAudio(au.current); au.current = null; setOn(false); setPos(m.start || 0); }, [m.id]);
  useEffect(() => { if (!on) setPos(start); }, [start]);
  const tick = () => { const a = au.current; if (!a) return; setPos(a.currentTime); if (a.currentTime >= MUSIC_SEC - 0.2) { stop(); setPos(start); return; } raf.current = requestAnimationFrame(tick); };
  const play = async (from = start) => {
    if (!au.current) au.current = playMusic({ ...m, start: 0 }, { onEnd: () => { stop(); setPos(start); }, onFail: () => { stop(); alert('음악을 불러오지 못했어요'); } });
    const a = au.current;
    const seek = () => { try { a.currentTime = from; } catch (e) {} };
    if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, { once: true });
    try { await a.play(); setOn(true); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick); } catch (e) { setOn(false); }
  };
  const at = e => { const r = bar.current.getBoundingClientRect(); const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); return Math.min(TRIM_MAX, Math.round(x * MUSIC_SEC)); };
  const down = e => { drag.current = true; bar.current.setPointerCapture && bar.current.setPointerCapture(e.pointerId); const s = at(e); onStart(s); setPos(s); };
  const move = e => { if (!drag.current) return; const s = at(e); if (s !== start) onStart(s); setPos(s); };
  const up = e => { if (!drag.current) return; drag.current = false; const s = at(e); onStart(s); play(s); };   // 손을 떼면 거기서부터 들려준다
  const pct = v => `${(v / MUSIC_SEC) * 100}%`;
  return (
    <div className="mtrim">
      {m.art && <img className="mtrim-bg" src={m.art} alt=""/>}
      <div className="mtrim-in">
        <div className="mtrim-top">
          <img className="mtrim-art" src={m.art} alt=""/>
          <div className="mtrim-t"><b>{m.title}</b><span>{m.artist}</span></div>
          <button type="button" className="mtrim-play" onClick={() => on ? stop() : play(start)} aria-label={on ? '멈추기' : '시작 지점부터 듣기'}><LIcon name={on ? 'pause' : 'play'} size={22} fill="#111" stroke="#111"/></button>
        </div>
        <div className="mtrim-lab"><span>시작 지점</span><b>{fmtSec(start)}</b><span className="mtrim-len">{MUSIC_SEC - start}초 동안 들려요</span></div>
        <div className="mtrim-bar" ref={bar} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (drag.current = false)} role="slider" aria-label="시작 지점" aria-valuemin={0} aria-valuemax={TRIM_MAX} aria-valuenow={start}
          tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowRight') onStart(Math.min(TRIM_MAX, start + 1)); if (e.key === 'ArrowLeft') onStart(Math.max(0, start - 1)); }}>
          <div className="mtrim-waves">{bars.map((h, i) => { const t = (i + 0.5) / bars.length * MUSIC_SEC; return <i key={i} className={t < start ? 'off' : t <= pos && on ? 'done' : ''} style={{ height: `${h * 100}%` }}/>; })}</div>
          <div className="mtrim-win" style={{ left: pct(start) }}/>
          {on && <div className="mtrim-head" style={{ left: pct(pos) }}/>}
        </div>
        <div className="mtrim-ticks"><span>0:00</span><span>0:10</span><span>0:20</span><span>0:30</span></div>
        <div className="mtrim-ft">
          <span className="mdim tiny">줄을 누르거나 끌어서 시작 지점을 정해요</span>
          <button type="button" onClick={() => { stop(); onChange(); }}>다른 노래</button>
        </div>
      </div>
    </div>
  );
}
/* 큰 음악 창: 아래에서 올라와 화면 대부분을 덮고, 창 전체가 위아래로 넘어간다 (인스타 '스토리에 추가' 음악 창처럼) */
function MusicSheet({ open, onClose, onPick }) {
  useLayer(open, onClose);
  if (!open) return null;
  return (
    <div className="msheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="msheet" role="dialog" aria-label="음악 고르기">
        <div className="msheet-hd"><span className="grab"/><b>음악 추가</b><button type="button" onClick={onClose} aria-label="닫기"><LIcon name="x" size={24}/></button></div>
        <div className="msheet-bd"><MusicBrowser onPick={onPick}/></div>
      </div>
    </div>
  );
}
function MusicBrowser({ onPick }) {
  const C = useC(); const value = null; const onChange = m => m && onPick(m);
  const [q, setQ] = useState(''); const [list, setList] = useState(null); const [busy, setBusy] = useState(false); const [playing, setPlaying] = useState(null); const au = useRef(null);
  /* 인스타그램 음악 고르기처럼: 검색 · [추천 | 우리 가족 인기 | 저장됨] · 줄을 누르면 고르기, 앨범 그림은 미리 듣기, 오른쪽 책갈피 */
  const [top, setTop] = useState('reco');
  const [mk, mLabel] = monthReco();
  const hot = useMemo(() => {   // 우리 가족 인기: 스토리에 많이 깐 노래부터 (같으면 최근 것)
    const by = {}; C.posts.forEach(p => { if (!p.music || !p.music.id) return; const x = by[p.music.id] = by[p.music.id] || { m: p.music, n: 0, t: '' }; x.n++; if (p.created_at > x.t) x.t = p.created_at; });
    return Object.values(by).sort((a, b) => b.n - a.n || b.t.localeCompare(a.t)).slice(0, 30).map(x => ({ ...x.m, start: 0, uses: x.n }));
  }, [C.posts]);
  const [saved, setSavedState] = useState(savedMusic);
  const isSaved = id => saved.some(m => m.id === id);
  const toggleSave = m => {   // 빨리 연달아 눌러도 앞의 것이 지워지지 않게, 늘 적어 둔 최신 목록에서 고친다
    const { start, uses, ...clean } = m; const cur = savedMusic();
    const n = cur.some(x => x.id === m.id) ? cur.filter(x => x.id !== m.id) : [clean, ...cur].slice(0, 60);
    store.set('fz_music_saved', JSON.stringify(n)); setSavedState(n);
  };
  /* 추천 = 애플 뮤직처럼 두 줄: 이달의 노래(큰 앨범 그림이 옆으로) + 오늘의 추천(날마다 바뀌는 10곡) */
  const [mTitle, mSub] = monthTitle();
  const [month, setMonth] = useState(null); const [mix, setMix] = useState(null); const [recoErr, setRecoErr] = useState('');
  useEffect(() => {
    if (list || value || top !== 'reco') return;
    let alive = true; setRecoErr('');
    Promise.all([loadReco(mk), loadReco('mix-' + ymd(), todayMix(mk))])
      .then(([a, b]) => { if (alive) { setMonth(a); setMix(b); poolAt.current = 10; feedAt.current = 0; setNoMore(false); } })
      .catch(() => alive && setRecoErr('추천 노래를 불러오지 못했어요. 위에서 직접 찾아 주세요.'));
    return () => { alive = false; };
  }, [top, !!list, !!value]);
  const choose = m => { stop(); onChange({ ...m, start: 0 }); };
  /* 끝없이 이어 보기: 끝에 닿으면 추천곡 10곡씩 → 다 보면 가수별로 애플에서 찾아 이어 붙인다 */
  const pool = useMemo(() => todayMix(mk, ymd(), 999), [mk]);
  const feed = useMemo(() => dayShuffle(MUSIC_FEED, ymd(), 11), []);
  const poolAt = useRef(10), feedAt = useRef(0), moreLock = useRef(false), endRef = useRef(null);
  const [moreBusy, setMoreBusy] = useState(false); const [noMore, setNoMore] = useState(false);
  const loadMore = async () => {
    if (moreLock.current || noMore) return; moreLock.current = true; setMoreBusy(true);
    try {
      let add = [];
      if (poolAt.current < pool.length) { const part = pool.slice(poolAt.current, poolAt.current + 10); poolAt.current += 10; add = await loadReco(`mix-${ymd()}-${poolAt.current}`, part); }
      else if (feedAt.current < feed.length) {   // 두 가수에서 6곡씩 번갈아 (한 가수만 줄줄이 나오지 않게)
        const ok = m => !/inst|MR\b|karaoke|cover|remix|ver\.\)/i.test(m.title);
        const a = (await searchMusic(feed[feedAt.current++])).filter(ok).slice(0, 6);
        const b = feedAt.current < feed.length ? (await searchMusic(feed[feedAt.current++])).filter(ok).slice(0, 6) : [];
        for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) add.push(a[i]); if (b[i]) add.push(b[i]); }
      }
      else setNoMore(true);
      setMix(cur => { const seen = new Set([...(cur || []), ...(month || [])].map(m => m.id)); return [...(cur || []), ...add.filter(m => !seen.has(m.id) && seen.add(m.id))]; });
    } catch (e) { /* 애플이 잠깐 막으면(1분에 20번 넘게) 다음에 다시 */ }
    moreLock.current = false; setMoreBusy(false);
  };
  useEffect(() => {
    const el = endRef.current; if (!el || !window.IntersectionObserver || top !== 'reco' || list) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) loadMore(); }, { root: el.closest('.msheet-bd'), rootMargin: '400px' });
    io.observe(el); return () => io.disconnect();
  }, [mix && mix.length, top, !!list, noMore]);
  const stop = () => { dropAudio(au.current); au.current = null; setPlaying(null); };
  useEffect(() => stop, []);
  const go = async () => { if (!q.trim()) return; stop(); setBusy(true); try { setList(await searchMusic(q.trim())); } catch (e) { setList([]); } setBusy(false); };
  const preview = m => { if (playing === m.id) { stop(); return; } stop(); const a = playMusic(m, { onEnd: stop, onFail: stop }); au.current = a; a.play().then(() => setPlaying(m.id)).catch(stop); };
  const rows = items => <div className="mlist">{items.map(m => (
    <div className="mrow" key={m.id}>
      <button type="button" className="mprev" onClick={() => preview(m)} aria-label={playing === m.id ? '멈추기' : '미리 듣기'}><img src={m.art} alt=""/><span className="mp"><LIcon name={playing === m.id ? 'pause' : 'play'} size={14} fill="#fff" stroke="#fff"/></span></button>
      <button type="button" className="mt grow mpick" onClick={() => { stop(); onChange({ ...m, start: 0 }); }} aria-label={`${m.title} 고르기`}>
        <b>{m.title}</b><span>{m.artist}{m.dur ? ` • ${fmtSec(m.dur)}` : ''}{m.uses > 1 ? ` • ${m.uses}번 씀` : ''}</span>
      </button>
      <button type="button" className={'msave' + (isSaved(m.id) ? ' on' : '')} onClick={() => toggleSave(m)} aria-label={isSaved(m.id) ? '저장 빼기' : '저장하기'}><LIcon name="bookmark" size={24} fill={isSaved(m.id) ? 'currentColor' : 'none'}/></button>
    </div>))}</div>;
  return (
    <div className="mpanel">
      <div className="msearch">
        <LIcon name="search" size={20}/>
        <input placeholder="검색… (노래 제목이나 가수)" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }} enterKeyHint="search"/>
        {q && <button type="button" onClick={go} disabled={busy}>{busy ? <span className="spin"/> : '찾기'}</button>}
      </div>
      {list ? <>
        <div className="row" style={{ justifyContent: 'space-between', margin: '12px 2px 0' }}><span className="mdim">찾은 노래 {list.length}곡</span><button type="button" className="mback" onClick={() => { stop(); setList(null); setQ(''); }}>← 돌아가기</button></div>
        {!list.length && <p className="mdim" style={{ margin: '8px 2px 0' }}>못 찾았어요. 가수 이름을 같이 넣거나 영어 제목으로 찾아보세요.</p>}
        {list.length > 0 && rows(list)}
      </> : <>
        <div className="mtabs">{[['reco', '추천'], ['hot', '우리 가족 인기'], ['saved', '저장됨']].map(([k, l]) => <button type="button" key={k} className={top === k ? 'on' : ''} onClick={() => { stop(); setTop(k); }}>{l}</button>)}</div>
        {top === 'reco' && (recoErr ? <p className="mdim" style={{ margin: '8px 2px 0' }}>{recoErr}</p> : !month ? <div className="empty small"><span className="spin"/></div> : <>
          <div className="msec"><b>{mTitle}</b><span>{mSub}</span></div>
          <div className="mcards">{month.map(m => (
            <div className="mcard" key={m.id}>
              <button type="button" className="mcover" onClick={() => choose(m)} aria-label={`${m.title} 고르기`}><img src={m.art} alt=""/></button>
              <button type="button" className={'mplay' + (playing === m.id ? ' on' : '')} onClick={() => preview(m)} aria-label={playing === m.id ? '멈추기' : '미리 듣기'}><LIcon name={playing === m.id ? 'pause' : 'play'} size={15} fill="#fff" stroke="#fff"/></button>
              <button type="button" className="mcap" onClick={() => choose(m)}><b>{m.title}</b><span>{m.artist}</span></button>
            </div>))}</div>
          <div className="msec"><b>오늘의 추천</b><span>날마다 새로 골라 드려요</span></div>
          {mix && rows(mix)}
          {mix && !noMore && <div ref={endRef} className="mmore">{moreBusy ? <span className="spin"/> : <button type="button" onClick={loadMore}>노래 더 보기</button>}</div>}
        </>)}
        {top === 'hot' && (hot.length ? rows(hot) : <p className="mdim mempty">아직 스토리에 음악을 깐 식구가 없어요.<br/>첫 번째로 깔아 보세요! 🎵</p>)}
        {top === 'saved' && (saved.length ? rows(saved) : <p className="mdim mempty">마음에 드는 노래 오른쪽 <b>책갈피</b>를 누르면 여기 모여요.</p>)}
      </>}
      <p className="mdim tiny" style={{ margin: '10px 2px 0' }}>노래를 누르면 골라져요 · 앨범 그림 ▶는 미리 듣기 · 애플 뮤직 30초 미리 듣기</p>
    </div>
  );
}

/* 녹음 단추 → 다 하면 onDone({blob, sec, text}) */
function RecordButton({ onDone, label = '목소리로 남기기', block }) {
  const R = useRecorder(); const [busy, setBusy] = useState(false);
  if (busy) return <div className="recbox"><div className="row gap"><span className="spin dark"/> 목소리 올리는 중…</div></div>;
  if (!R.on) return (
    <button type="button" className={'btn soft' + (block ? ' block' : '')} onClick={() => R.start().catch(e => alert('마이크를 쓸 수 없어요: ' + e.message))}>
      <LIcon name="mic" size={20}/>{label}
    </button>
  );
  return (
    <div className="recbox">
      <div className="row gap"><span className="recdot"/><b>{fmtSec(R.sec)}</b><span className="small muted">녹음 중</span></div>
      <div className="live">{R.live || '편하게 말씀하세요…'}</div>
      <div className="row gap">
        <button type="button" className="btn soft grow" onClick={R.cancel}>취소</button>
        <button type="button" className="btn accent grow" onClick={async () => { const r = await R.stop(); if (!r) return; setBusy(true); try { await onDone(r); } finally { setBusy(false); } }}>다 했어요</button>
      </div>
    </div>
  );
}

function MicButton({ dict }) {
  return (
    <button type="button" className={'btn sm ' + (dict.on ? 'accent' : 'soft')} onClick={dict.toggle}>
      <LIcon name="mic" size={18}/>{dict.on ? '듣고 있어요… (누르면 끝)' : '말로 쓰기'}
    </button>
  );
}

function Toggle({ on, onChange, label, sub }) {
  return (
    <button type="button" className="switch" onClick={() => onChange(!on)} style={{ width: '100%', textAlign: 'left' }}>
      <span><b style={{ display: 'block', fontSize: '1rem' }}>{label}</b>{sub && <span className="small muted">{sub}</span>}</span>
      <span className={'tgl' + (on ? ' on' : '')}/>
    </button>
  );
}

function Sheet({ open, onClose, title, right, children, footer, full }) {
  useLayer(open, onClose);
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'sheet' + (full ? ' full' : '')} role="dialog" aria-label={title}>
        <div className="sheet-hd">
          <button className="iconbtn" onClick={onClose} aria-label="닫기"><LIcon name="x"/></button>
          <b>{title}</b>
          {right || <span style={{ width: 44 }}/>}
        </div>
        <div className="sheet-bd">{children}</div>
        {footer && <div className="sheet-ft">{footer}</div>}
      </div>
    </div>
  );
}

function Page({ open, onClose, title, right, children }) {
  useLayer(open, onClose);
  if (!open) return null;
  return (
    <div className="page">
      <div className="topbar" style={{ paddingLeft: 4 }}>
        <button className="iconbtn" onClick={onClose} aria-label="뒤로"><LIcon name="chevron-left" size={28}/></button>
        <b className="pt">{title}</b>
        {right || <span style={{ width: 44 }}/>}
      </div>
      {children}
    </div>
  );
}

/* 타임캡슐 날짜 고르기 */
function CapsulePicker({ on, setOn, date, setDate, member }) {
  const today = ymd();
  const presets = [['1년 뒤', addYears(today, 1)], ['5년 뒤', addYears(today, 5)], ['10년 뒤', addYears(today, 10)]];
  if (member && member.birth_date) {
    const nb = nextOccur(birthdayEvent(member), ymd(addDays(new Date(), 1)));
    if (nb) presets.push([`${member.name} 다음 생일`, nb]);
    const a = ageOn(member.birth_date, today);
    if (a < 20) presets.push([`${member.name} 스무 살 생일`, addYears(member.birth_date, 20)]);
  }
  return (
    <div className="field">
      <label>언제 보여 줄까요?</label>
      <div className="seg purple">
        <button type="button" className={!on ? 'on' : ''} onClick={() => setOn(false)}>지금 바로</button>
        <button type="button" className={on ? 'on' : ''} onClick={() => { setOn(true); if (!date) setDate(addYears(today, 1)); }}>🔒 타임캡슐</button>
      </div>
      {on && (
        <div style={{ marginTop: 10 }}>
          <div className="chips" style={{ marginBottom: 8 }}>
            {presets.map(([l, d]) => <button type="button" key={l} className={'chip' + (date === d ? ' pon' : '')} onClick={() => setDate(d)}>{l}</button>)}
          </div>
          <input type="date" className="input" min={ymd(addDays(new Date(), 1))} value={date} onChange={e => setDate(e.target.value)}/>
          <p className="small muted" style={{ margin: '6px 2px 0' }}>{date ? `${fmtDate(date, true)}까지는 봉투만 보이고, 그날 열려요.` : ''}</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════ 소식 카드 ═══════════ */
function LockedCard({ p, onPeek }) {
  const C = useC(); const a = C.getM(p.author_id);
  return (
    <div className="post">
      <div className="post-hd"><Avatar m={a} size={34}/><div className="grow"><b>{a.name}</b> <span className="small muted">· {relDay(p.happened_on, p.created_at)}</span></div></div>
      <div className="locked">
        <div className="lk"><LIcon name="lock" size={26}/></div>
        <b>{a.name}의 타임캡슐</b>
        <p>{fmtDate(p.open_on, true)}에 열려요 · {ddayText(dayDiff(ymd(), p.open_on))}</p>
        {onPeek && <button className="btn sm line" style={{ marginTop: 10, background: '#fff' }} onClick={onPeek}>내가 잠근 것 · 미리 보기</button>}
      </div>
    </div>
  );
}

/* 글 속 #해시태그는 파란 글씨, 누르면 같은 태그 소식만 모아 본다 */
const TAG_RE = /(#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)/g;
const tagsOf = text => [...new Set(String(text || '').match(TAG_RE) || [])];
function Tagged({ text }) {
  const C = useC();
  return String(text || '').split(TAG_RE).map((s, i) => i % 2
    ? <button key={i} className="htag" onClick={e => { e.stopPropagation(); C.openTag(s); }}>{s}</button>
    : s);
}

/* 내 댓글·답글 수정: 글자만 고친다 (목소리 댓글은 받아 적은 글만) */
function EditLine({ text, voice, onSave, onCancel }) {
  const [t, setT] = useState(text || ''); const [busy, setBusy] = useState(false);
  const save = async () => { if (!voice && !t.trim()) return; setBusy(true); if (!(await onSave(t.trim()))) setBusy(false); };
  return (
    <div className="editline">
      <textarea className="input" rows={2} autoFocus value={t} placeholder={voice ? '말한 내용 (선택)' : ''} onChange={e => setT(e.target.value)}/>
      <div className="row gap"><button className="btn sm soft" onClick={onCancel}>그만두기</button><button className="btn sm primary" disabled={busy || (!voice && !t.trim())} onClick={save}>{busy ? <span className="spin"/> : '저장'}</button></div>
    </div>
  );
}
function CommentRow({ c, onDelete, onReply, reply }) {
  const C = useC(); const a = C.getM(c.author_id); const [editing, setEditing] = useState(false); const [pick, setPick] = useState(false);
  const mine = c.author_id === C.me;
  const rs = C.commentReactsOf(c.id); const myR = (rs.find(r => r.member_id === C.me) || {}).emoji;
  const kinds = REACTS.map(x => x[0]).filter(e => rs.some(r => r.emoji === e)).slice(0, 3).join('');
  return (
    <div className={'cmt' + (reply ? ' reply' : '')}>
      <Avatar m={a} size={28} onClick={() => C.openProfile(a.id)}/>
      <div className="body">
        <div>{c.is_answer && <span className="tag-ans">답</span>}<b>{a.name}</b> {c.content && !c.audio_url && !editing && <span>{c.content}</span>}</div>
        {c.audio_url && <><VoicePlayer src={c.audio_url}/>{c.content && !editing && <div className="small" style={{ color: '#5b4a86' }}>“{c.content}”</div>}</>}
        {editing && <EditLine text={c.content} voice={!!c.audio_url} onCancel={() => setEditing(false)} onSave={async t => { const ok = await C.editComment(c, t); if (ok) setEditing(false); return ok; }}/>}
        {!editing && <div className="meta"><span>{relTime(c.created_at)}</span>
          <button className={'cr' + (myR ? ' on' : '')} onClick={() => setPick(v => !v)} aria-label="마음 남기기" title={rs.map(r => C.getM(r.member_id).name + r.emoji).join(', ')}>{rs.length ? <>{kinds} {rs.length}</> : '♡ 마음'}</button>
          {onReply && <button onClick={() => onReply(c)}>답글 달기</button>}{mine && <button onClick={() => setEditing(true)}>수정</button>}{onDelete && mine && <button onClick={() => onDelete(c)}>지우기</button>}</div>}
        {pick && <>
          <div className="rbar mini" role="group" aria-label="댓글에 마음 남기기">{REACTS.map(([e, w]) => <button key={e} className={myR === e ? 'on' : ''} onClick={() => { C.reactComment(c, e); setPick(false); }} aria-label={w}>{e}</button>)}</div>
          {rs.length > 0 && <div className="tiny muted">{rs.map(r => C.getM(r.member_id).name + r.emoji).join(', ')}</div>}
        </>}
      </div>
    </div>
  );
}
/* 댓글 하나 + 그 아래 답글들 (답글은 한 단계만, 들여 쓴다) */
function CommentThread({ c, onDelete, onReply, max }) {
  const C = useC(); const reps = C.repliesOf(c.id);
  const shown = max ? reps.slice(-max) : reps;
  return (
    <>
      <CommentRow c={c} onDelete={onDelete} onReply={onReply}/>
      {max && reps.length > shown.length && <button className="linkbtn reply-more" onClick={() => C.openComments(C.posts.find(p => p.id === c.post_id))}>답글 {reps.length}개 모두 보기</button>}
      {shown.map(r => <CommentRow key={r.id} c={r} reply onDelete={onDelete} onReply={onReply ? () => onReply(c, r) : null}/>)}
    </>
  );
}

/* 동영상: 드라이브는 받은 뒤 재생용으로 다시 만드느라 큰 영상은 몇 분~30분쯤 못 튼다.
   그동안은 드라이브의 미리보기 그림도 안 나오므로, 그 그림이 뜨는지로 "준비됐는지"를 본다 (1분마다 다시 봄).
   올린 지 6시간이 지났으면 묻지 않고 그냥 튼다 (그림만 안 되는 경우에 막히지 않게) */
const vReady = {};
const VREADY_H = 6;
function probeVideo(vid) {
  if (vReady[vid]) return Promise.resolve(true);
  return new Promise(ok => {
    const img = new Image(); let done = false; const end = r => { if (done) return; done = true; if (r) vReady[vid] = true; ok(r); };
    img.referrerPolicy = 'no-referrer'; img.onload = () => end(true); img.onerror = () => end(false);
    setTimeout(() => end(false), 15000);
    img.src = `https://lh3.googleusercontent.com/d/${vid}=w64?t=${Date.now()}`;
  });
}
function VideoSlide({ ph, at, playing, onPlay }) {
  const C = useC();
  /* 틀기용 한 벌이 있으면 폰 재생기로 (가운데를 가리는 큰 버튼 없음). 창고가 차서 빠졌으면 드라이브 재생 창으로 */
  const [bad, setBad] = useState(false);
  const own = !!ph.play && !bad;
  const young = !own && !!(ph.vid && at && Date.now() - new Date(at).getTime() < VREADY_H * 3600e3);
  const [ready, setReady] = useState(() => !young || !!vReady[ph.vid]);
  useEffect(() => {
    if (ready) return;
    let alive = true, t = 0;
    const check = () => probeVideo(ph.vid).then(r => { if (!alive) return; if (r) setReady(true); else t = setTimeout(check, 60000); });
    check();
    return () => { alive = false; clearTimeout(t); };
  }, [ph.vid, ready]);
  const mins = at ? Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60000)) : 0;
  const tap = async () => {
    if (ready) { onPlay(); return; }
    if (await probeVideo(ph.vid)) { setReady(true); onPlay(); return; }
    C.toast('드라이브가 아직 동영상을 준비하고 있어요. 조금 뒤에 다시 눌러 주세요 ⏳');
  };
  if (own) return (
    <div className="vslide" onClick={e => e.stopPropagation()}>
      <video src={ph.play} poster={ph.url} controls playsInline preload="none" controlsList="nodownload" onError={() => { setBad(true); onPlay(); }}/>
    </div>
  );
  return (
    <div className="vslide" onClick={e => e.stopPropagation()}>
      {playing && ready
        ? <iframe src={`https://drive.google.com/file/d/${ph.vid}/preview`} allow="autoplay; fullscreen" allowFullScreen title="동영상"/>
        : <button className="vplay" onClick={tap} aria-label="동영상 보기"><img src={ph.url} alt="" loading="lazy"/>
            {ready
              ? <span className="pb"><LIcon name="play" size={34} fill="#fff" stroke="#fff"/></span>
              : <span className="vwait"><span className="spin"/><b>동영상 준비 중이에요</b><span>구글 드라이브가 재생할 수 있게 만드는 중이에요.<br/>올린 지 {mins}분 · 큰 영상은 30분쯤 걸려요</span></span>}
            {ph.dur > 0 && <span className="vd">{fmtDur(ph.dur)}</span>}</button>}
    </div>
  );
}

function PostCard({ p }) {
  const C = useC(); const a = C.getM(p.author_id);
  const [idx, setIdx] = useState(0); const [pop, setPop] = useState(0); const [more, setMore] = useState(false);
  const [peek, setPeek] = useState(false); const [menu, setMenu] = useState(false); const [playing, setPlaying] = useState(-1);
  const [bar, setBar] = useState(false); const barT = useRef(0); const press = useRef(null);
  const lastTap = useRef(0); const vref = useRef(null);
  useViewed(vref, isLocked(p) ? null : p.id, 'post', p.author_id);
  useEffect(() => () => { clearTimeout(barT.current); clearTimeout(press.current); }, []);
  if (isLocked(p) && !peek) return <LockedCard p={p} onPeek={p.author_id === C.me ? () => setPeek(true) : null}/>;
  const photos = photosOf(p);
  const likes = C.likesOf(p.id); const iLike = likes.includes(C.me); const iSaved = C.isSaved(p.id);
  const reacts = C.reactsOf(p.id); const mine = C.myReact(p.id);
  const kinds = REACTS.map(x => x[0]).filter(e => reacts.some(r => r.emoji === e)).concat([...new Set(reacts.map(r => r.emoji))].filter(e => !REACTS.some(x => x[0] === e)));
  const showBar = ms => { clearTimeout(barT.current); setBar(true); if (ms) barT.current = setTimeout(() => setBar(false), ms); };
  const pick = e => { clearTimeout(barT.current); setBar(false); C.react(p, e); };
  /* 하트 한 번: 하트를 남기고 다른 마음 줄을 잠깐 보여 준다 · 이미 남겼으면 지운다 · 꾹 누르면 줄만 연다 */
  const heartTap = () => { if (press.current === 'long') { press.current = null; return; } if (bar) { setBar(false); return; } if (mine) C.react(p, mine); else { C.react(p, '❤️'); showBar(4000); } };
  const heartDown = () => { clearTimeout(press.current); press.current = setTimeout(() => { press.current = 'long'; showBar(0); if (navigator.vibrate) navigator.vibrate(15); }, 450); };
  const heartUp = () => { if (press.current !== 'long') { clearTimeout(press.current); press.current = null; } };
  const comments = C.commentsOf(p.id);
  const answers = comments.filter(c => c.is_answer && !c.parent_id); const plain = comments.filter(c => !c.is_answer && !c.parent_id);   // 답글은 각 댓글 아래에
  const replyTo = (c, r) => C.openComments(p, '', { c, r });
  const tagged = (p.tagged || []).filter(id => id !== p.author_id).map(C.getM);
  const asked = p.ask_to ? C.getM(p.ask_to) : null;
  const r0 = photos[0] && photos[0].w ? Math.max(0.8, Math.min(1.91, photos[0].w / photos[0].h)) : 1;
  const tapImg = () => { const t = Date.now(); if (t - lastTap.current < 320) { if (!mine) C.react(p, '❤️'); setPop(x => x + 1); } lastTap.current = t; };
  /* 글 끝에 몰아 쓴 #태그는 참고 화면처럼 아래 줄로 따로 뺀다 */
  const tm = (p.content || '').match(/(?:\s*#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)+\s*$/);
  const body = tm ? p.content.slice(0, tm.index).trim() : (p.content || '');
  const tail = tm ? tagsOf(tm[0]) : [];
  const long = body.length > 90 && !more;
  const speakKey = 'p' + p.id;
  const openedToday = p.open_on && p.open_on === ymd();
  return (
    <article className="post" ref={vref}>
      <div className="post-hd">
        <Avatar m={a} size={42} ring={C.storyRing(a.id)} onClick={() => C.openProfile(a.id)}/>
        <div className="grow">
          <div><b>{a.name}</b>{p.isNew && <span className="newdot" title="새 소식"/>}</div>
          <div className="when">{relDay(p.happened_on, p.created_at)}{p.kind === 'daily' && <><LIcon name="camera" size={14}/>오늘의 한 장</>}{tagged.length > 0 && <><LIcon name="users" size={14}/>{josa(tagged.map(t => t.name).join(', '), '과', '와')} 함께</>}</div>
        </div>
        {(p.author_id === C.me || C.isAdmin) && <button className="iconbtn" onClick={() => setMenu(true)} aria-label="더 보기"><LIcon name="ellipsis"/></button>}
      </div>
      {openedToday && <span className="opened">🎁 오늘 열린 타임캡슐 · {fmtDate(ymd(new Date(p.created_at)), true)}에 남김</span>}
      {isLocked(p) && <span className="opened" style={{ background: '#F3EEFF', color: '#6a3fc8' }}>🔒 {fmtDate(p.open_on, true)}에 열려요 (나만 미리 보는 중)</span>}
      {photos.length > 0 && (
        <div className="car-wrap" onClick={tapImg} style={{ aspectRatio: String(r0) }}>
          <div className="car" style={{ height: '100%' }} onScroll={e => { const el = e.currentTarget; setIdx(Math.round(el.scrollLeft / el.clientWidth)); }}>
            {photos.map((ph, i) => isVideo(ph)
              ? <VideoSlide key={i} ph={ph} at={p.created_at} playing={playing === i} onPlay={() => setPlaying(i)}/>
              : <img key={i} src={ph.url} alt={`사진 ${i + 1}`} loading="lazy"/>)}
          </div>
          {photos.length > 1 && <><span className="pcount">{idx + 1}/{photos.length}</span><div className="dots">{photos.map((_, i) => <i key={i} className={i === idx ? 'on' : ''}/>)}</div></>}
          {p.title && idx === 0 && <span className="ovl">{p.title}</span>}
          {pop > 0 && <span key={pop} className="bigheart"><LIcon name="heart" size={96} fill="#fff" stroke="#fff"/></span>}
        </div>
      )}
      {p.music && <div style={{ padding: '10px 14px 0' }}><MusicChip m={p.music}/></div>}
      {!p.music && p.audio_url && <div style={{ padding: '10px 14px 0' }}><VoicePlayer src={p.audio_url}/></div>}
      <div className="acts">
        {bar && (
          <div className="rbar" role="menu" aria-label="마음 고르기">
            {REACTS.map(([e, w]) => <button key={e} className={mine === e ? 'on' : ''} onClick={() => pick(e)} aria-label={w}>{e}</button>)}
          </div>
        )}
        <button className="iconbtn" onClick={heartTap} onPointerDown={heartDown} onPointerUp={heartUp} onPointerLeave={heartUp} onContextMenu={e => e.preventDefault()} aria-label={mine ? `내 마음 ${mine} · 누르면 지워요` : '마음 남기기'}>
          {!mine ? <LIcon name="heart" size={28}/> : mine === '❤️' ? <LIcon name="heart" size={28} fill="#ED4956" stroke="#ED4956"/> : <span className="myr">{mine}</span>}
        </button>
        <button className="iconbtn" onClick={() => C.openComments(p)} aria-label="댓글"><LIcon name="message-circle" size={27}/></button>
        <button className="iconbtn" onClick={() => C.sharePost(p)} aria-label="보내기"><LIcon name="send" size={26}/></button>
        <button className="iconbtn" onClick={() => C.openComments(p, 'voice')} aria-label="목소리 댓글"><LIcon name="mic" size={24} stroke="#8e8e8e"/></button>
        <button className="iconbtn" onClick={() => C.toggleSpeak(speakKey, `${a.name}의 소식. ${p.title ? p.title + '. ' : ''}${p.content || '사진이 올라왔어요.'}${asked ? ` ${asked.name}께 질문. ${p.ask_text}` : ''}`)} aria-label="읽어 주기">
          <LIcon name={C.speaking === speakKey ? 'volume-x' : 'volume-2'} size={24} stroke="#8e8e8e"/>
        </button>
        <span className="grow"/>
        <button className="iconbtn" onClick={() => C.toggleSave(p)} aria-label={iSaved ? '보관 빼기' : '보관하기'}>{iSaved ? <LIcon name="bookmark" size={27} fill="#1a1a1a"/> : <LIcon name="bookmark" size={27}/>}</button>
      </div>
      {reacts.length > 0 && (
        <button className="liked" onClick={() => showBar(0)} aria-label="마음 바꾸기">
          <span className="faces">{reacts.slice(0, 4).map(r => <Avatar key={r.member_id} m={C.getM(r.member_id)} size={24}/>)}</span>
          <span><span className="rk">{kinds.slice(0, 4).join('')}</span> <b>{reacts.length}개</b> <span className="muted small">· {reacts.map(r => C.getM(r.member_id).name + r.emoji).join(', ')}</span></span>
        </button>
      )}
      {!photos.length && p.title && <div className="capt" style={{ fontFamily: "'Nanum Pen Script',cursive", fontSize: '1.6rem', lineHeight: 1.2 }}>{p.title}</div>}
      {body && (
        <div className="capt"><b>{a.name}</b> {long ? <><Tagged text={body.slice(0, 90)}/>… <button className="more" onClick={() => setMore(true)}>더 보기</button></> : <Tagged text={body}/>}</div>
      )}
      {tail.length > 0 && <div className="htags">{tail.map(t => <button key={t} className="htag" onClick={() => C.openTag(t)}>{t}</button>)}</div>}
      {asked && (
        <div className="askbox">
          <div className="tiny" style={{ color: '#b2502c', fontWeight: 700 }}>{asked.emoji} {asked.name}께 묻는 질문</div>
          <div className="q">“{p.ask_text}”</div>
          {answers.map(c => <div className="ans" key={c.id}><CommentThread c={c} max={1} onReply={replyTo}/></div>)}
          {!answers.length && (p.ask_to === C.me
            ? <button className="btn sm accent" onClick={() => C.openComments(p)}><LIcon name="mic" size={16}/>답하기</button>
            : <div className="small muted">{asked.name}의 답을 기다려요</div>)}
        </div>
      )}
      <div className="cmts">
        {plain.length > 2 && <button className="linkbtn" onClick={() => C.openComments(p)}>댓글 {plain.length}개 모두 보기</button>}
        {plain.slice(-2).map(c => <CommentThread key={c.id} c={c} max={1} onReply={replyTo}/>)}
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title="소식">
        <div style={{ display: 'grid', gap: 8 }}>
          {p.author_id === C.me && <button className="btn soft block" onClick={() => { setMenu(false); C.openComposer({ edit: p }); }}><LIcon name="pencil" size={18}/>글 고치기</button>}
          <button className="btn soft block danger" onClick={() => { setMenu(false); C.deletePost(p); }}><LIcon name="trash-2" size={18}/>소식 지우기</button>
        </div>
      </Sheet>
    </article>
  );
}

/* ═══════════ 댓글 시트 ═══════════ */
function CommentsSheet({ post, mode, reply, onClose }) {
  const C = useC();
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(null);   // 답글 달 댓글 {c: 맨 위 댓글, r: 누른 답글(있으면)}
  const dict = useDictation(t => setText(s => joinText(s, t)));
  const inRef = useRef(null);
  const open = !!post;
  useEffect(() => { setTo(reply || null); if (reply) setTimeout(() => inRef.current && inRef.current.focus(), 300); }, [post && post.id, reply]);
  const p = post ? (C.posts.find(x => x.id === post.id) || post) : null;
  const list = p ? C.commentsOf(p.id).filter(c => !c.parent_id) : [];
  const answering = p && p.ask_to === C.me && !list.some(c => c.is_answer && c.author_id === C.me);
  const toWho = to ? C.getM((to.r || to.c).author_id).name : '';
  const send = async (row) => {
    setBusy(true);
    const ok = await C.addComment({ post_id: p.id, author_id: C.me, is_answer: !to && !!answering, ...(to ? { parent_id: to.c.id } : {}), ...row });
    setBusy(false); if (ok) setTo(null); return ok;
  };
  const pickReply = (c, r) => { setTo({ c, r }); setTimeout(() => inRef.current && inRef.current.focus(), 50); };
  return (
    <Sheet open={open} onClose={onClose} title={answering && !to ? '질문에 답하기' : '댓글'} full
      footer={p && (
        <div style={{ display: 'grid', gap: 8 }}>
          {to && <div className="replying"><span><b>{toWho}</b>에게 답글 다는 중</span><button onClick={() => setTo(null)} aria-label="답글 그만두기"><LIcon name="x" size={16}/></button></div>}
          <RecordButton block label={to ? '목소리로 답글 달기' : answering ? '목소리로 답하기' : '목소리 댓글 남기기'} onDone={async r => { const url = await uploadVoice(r.blob, r.sec); await send({ audio_url: url, content: r.text || '' }); }}/>
          <div className="row gap">
            <input ref={inRef} className="input grow" placeholder={to ? `${toWho}에게 답글…` : answering ? '글로 답하기…' : '댓글 달기…'} value={text} onChange={e => setText(e.target.value)}/>
            <button className={'iconbtn'} style={{ background: dict.on ? 'var(--accent)' : '#f0f0f0', color: dict.on ? '#fff' : 'inherit' }} onClick={dict.toggle} aria-label="말로 쓰기"><LIcon name="mic"/></button>
            <button className="btn blue sm" disabled={!text.trim() || busy} onClick={async () => { if (await send({ content: text.trim() })) setText(''); }}>올리기</button>
          </div>
        </div>
      )}>
      {p && (
        <>
          {answering && <div className="askbox" style={{ margin: '0 0 12px' }}><div className="tiny" style={{ color: '#b2502c', fontWeight: 700 }}>{C.getM(p.author_id).name}의 질문</div><div className="q">“{p.ask_text}”</div><div className="small muted">글이나 목소리로 답해 주세요.</div></div>}
          {p.content && <div className="cmt" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 6 }}><Avatar m={C.getM(p.author_id)} size={28}/><div className="body"><b>{C.getM(p.author_id).name}</b> {p.content}</div></div>}
          {!list.length && <p className="empty">첫 댓글을 남겨 보세요.<br/><span className="small">타자가 어려우면 아래 마이크를 누르세요.</span></p>}
          {list.map(c => <CommentThread key={c.id} c={c} onDelete={C.deleteComment} onReply={pickReply}/>)}
          {mode === 'voice' && !list.length && <p className="small muted" style={{ textAlign: 'center' }}>↓ "목소리 댓글 남기기"를 누르고 말하면 돼요</p>}
        </>
      )}
    </Sheet>
  );
}

/* ═══════════ 올리기 (소식 / 오늘의 한 장 / 고치기) ═══════════ */
function Composer({ cfg, onClose }) {
  const C = useC();
  const open = !!cfg; const edit = cfg && cfg.edit; const daily = cfg && cfg.mode === 'daily';
  const [files, setFiles] = useState([]); const [text, setText] = useState(''); const [day, setDay] = useState(ymd());
  const [tagged, setTagged] = useState([]); const [cap, setCap] = useState(false); const [openOn, setOpenOn] = useState('');
  const [askTo, setAskTo] = useState(''); const [askText, setAskText] = useState(''); const [busy, setBusy] = useState(''); const pick = useRef(null);
  const [ovl, setOvl] = useState(''); const [kept, setKept] = useState([]);   // 고치기: 이미 올라가 있는 사진·동영상 (빼거나 새로 더할 수 있다)
  const [sound, setSound] = useState(''); const [music, setMusic] = useState(null); const [voice, setVoice] = useState(null);   // 오늘의 한 장: 음악 또는 목소리 깔기 ({blob,sec,url} 새 녹음 / {keep} 예전 것)
  const isDaily = daily || (edit && edit.kind === 'daily');
  const dict = useDictation(t => setText(s => joinText(s, t)));
  const dictQ = useDictation(t => setAskText(s => joinText(s, t)));
  const maxN = daily || (edit && edit.kind === 'daily') ? 1 : 10;
  useEffect(() => {
    if (!cfg) return;
    const e = cfg.edit;
    setFiles([]); setKept(e ? photosOf(e) : []); setText(e ? e.content || '' : ''); setDay(e ? e.happened_on : ymd());
    setMusic(e && e.music || null); setVoice(e && e.audio_url ? { keep: e.audio_url } : null); setSound(e && e.music ? 'music' : e && e.audio_url ? 'voice' : '');
    setTagged(e ? e.tagged || [] : []); setCap(!!(e && e.open_on)); setOpenOn(e && e.open_on || '');
    setAskTo(e && e.ask_to || ''); setAskText(e && e.ask_text || ''); setOvl(e && e.title || ''); setBusy('');
  }, [cfg]);
  const addFiles = async list => {
    let arr = Array.from(list || []).filter(f => /^image\//.test(f.type) || (!daily && /^video\//.test(f.type)));
    if (arr.some(f => /^video\//.test(f.type))) {
      if ((await gwVersion()) < 3) { C.toast('사진 창구를 새 버전(v3)으로 배포해야 동영상을 올릴 수 있어요'); arr = arr.filter(f => !/^video\//.test(f.type)); }
      else if (arr.some(f => f.size > VIDEO_MAX)) { C.toast('1.5GB보다 큰 동영상은 올릴 수 없어요'); arr = arr.filter(f => f.size <= VIDEO_MAX); }
    }
    setFiles(fs => [...fs, ...arr.map(f => ({ f, url: URL.createObjectURL(f), video: /^video\//.test(f.type) }))].slice(0, Math.max(0, maxN - kept.length)));
  };
  /* 고른 사진·동영상을 차례로 올린다 (동영상은 줄이기 → 드라이브 보관 → 틀기용 한 벌) */
  const uploadAll = async () => {
    const photos = [];
    const vids = files.filter(x => x.video);
    if (vids.length && navigator.connection && navigator.connection.type === 'cellular' && !window.confirm(`동영상은 데이터를 많이 써요 (${Math.round(vids.reduce((n, x) => n + x.f.size, 0) / 1e6)}MB). 와이파이가 아닌데 계속 올릴까요?`)) return null;
    for (let i = 0; i < files.length; i++) {
      const x = files[i], at = `${i + 1}/${files.length}`;
      if (x.video) {
        setBusy(`동영상 줄이는 중 ${at} · 0%`);
        const small = await shrinkVideo(x.f, p => setBusy(`동영상 줄이는 중 ${at} · ${p}% (화면을 끄지 말아 주세요)`));
        const mb = small !== x.f ? ` · ${Math.round(x.f.size / 1e6)}MB → ${Math.round(small.size / 1e6)}MB` : '';
        setBusy(`동영상 올리는 중 ${at} · 0%${mb}`); const v = await uploadVideo(small, p => setBusy(`동영상 올리는 중 ${at} · ${p}%${mb}`));
        setBusy(`바로 틀 수 있게 한 벌 더 저장하는 중 ${at}…`); const pc = await uploadPlayCopy(small);
        photos.push(pc ? { ...v, ...pc } : v);
      }
      else { setBusy(`사진 올리는 중 ${at} · 원본도 저장`); photos.push(await uploadPhoto(x.f, undefined, true)); }
    }   // 사진·동영상은 앱에서 지우지 않는다 (올리다 실패해도 드라이브에 남김)
    return photos;
  };
  const others = C.members.filter(m => m.id !== C.me);
  const capMember = tagged.length === 1 ? C.getM(tagged[0]) : null;
  const can = !busy && (edit ? true : daily ? files.length > 0 : (files.length > 0 || text.trim()));
  const submit = async () => {
    if (cap && !openOn) { C.toast('타임캡슐 여는 날을 골라 주세요'); return; }
    if (askTo && !askText.trim()) { C.toast('질문 내용을 적어 주세요'); return; }
    if (isDaily && sound === 'music' && !music) { C.toast('깔 노래를 골라 주세요 (또는 소리 없음)'); return; }
    if (isDaily && sound === 'voice' && !voice) { C.toast('목소리를 녹음해 주세요 (또는 소리 없음)'); return; }
    /* 소리 깔기: 음악은 곡 정보만, 목소리는 드라이브에 올린 주소 */
    const soundRow = async () => {
      if (!isDaily) return {};
      if (sound === 'music') return { music, audio_url: null };
      if (sound === 'voice') { if (voice.keep) return { music: null, audio_url: voice.keep }; setBusy('목소리 올리는 중…'); return { music: null, audio_url: await uploadVoice(voice.blob, voice.sec) }; }
      return { music: null, audio_url: null };
    };
    try {
      if (edit) {
        if (!kept.length && !files.length && !text.trim()) { C.toast('사진이나 글이 하나는 있어야 해요'); return; }
        const added = await uploadAll(); if (!added) { setBusy(''); return; }
        const snd = await soundRow();
        setBusy('고치는 중…');
        const photos = [...kept, ...added];
        const gone = photosOf(edit).filter(ph => !kept.includes(ph)).map(ph => ph.play_path).filter(Boolean);   // 뺀 동영상의 틀기용 한 벌만 지운다 (드라이브엔 남음)
        const ok = await C.write(() => db.patch('posts', edit.id, { ...snd, content: text.trim(), title: ovl.trim(), photos, happened_on: day, tagged, open_on: cap ? openOn : null, ask_to: askTo || null, ask_text: askTo ? askText.trim() : '', updated_at: new Date().toISOString() }), '고쳤어요');
        if (ok) { if (gone.length) vfn('del', { paths: gone }).catch(() => {}); onClose(); } else setBusy('');
        return;
      }
      const photos = await uploadAll(); if (!photos) { setBusy(''); return; }
      const snd = await soundRow();
      setBusy('소식 올리는 중…');
      const row = daily
        ? { author_id: C.me, kind: 'daily', content: text.trim(), photos, happened_on: ymd(), ...snd }
        : { author_id: C.me, kind: 'post', content: text.trim(), title: ovl.trim(), photos, happened_on: day, tagged, open_on: cap ? openOn : null, ask_to: askTo || null, ask_text: askTo ? askText.trim() : '' };
      const ok = await C.write(() => db.add('posts', row), daily ? '오늘의 한 장을 올렸어요' : cap ? `타임캡슐을 잠갔어요 · ${fmtDate(openOn, true)}에 열려요` : '소식을 올렸어요');
      if (ok) onClose(); else setBusy('');
    } catch (e) { setBusy(''); C.toast('올리지 못했어요: ' + e.message); }
  };
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} full title={edit ? '소식 고치기' : daily ? '오늘의 한 장' : '새 소식'}
      right={<button className="hdbtn" disabled={!can} onClick={submit}>{busy ? <span className="spin dark"/> : edit ? '저장' : '올리기'}</button>}>
      {busy && <div className="recbox" style={{ marginBottom: 14, background: '#EAF3FF' }}><div className="row gap"><span className="spin dark"/>{busy}</div></div>}
      {daily && <p className="small muted" style={{ marginTop: 0 }}>하루에 한 장씩 쌓여서, 1년 뒤엔 우리 가족 365일 달력이 돼요. 사라지지 않아요.</p>}
      {!edit && !daily && !busy && (
        <button className="banner poll-go" onClick={C.newPoll}>
          <div className="bic">🗳</div>
          <div className="grow"><b>가족 투표 만들기</b><span>함께 정할 일을 물어보고 다 같이 골라요</span></div>
          <LIcon name="chevron-right"/>
        </button>
      )}
      <div className="field">
        {edit && <label>사진·동영상 <span className="muted" style={{ fontWeight: 400 }}>(✕로 빼고, ＋로 새로 더해요)</span></label>}
        <div className="thumbs">
          {kept.map((ph, i) => <div className="t" key={'k' + i}><img src={ph.thumb || ph.url} alt=""/>{isVideo(ph) && <span className="vt"><LIcon name="play" size={14} fill="#fff"/>{fmtDur(ph.dur) || '동영상'}</span>}<button className="x" onClick={() => setKept(ks => ks.filter(k => k !== ph))} aria-label="빼기"><LIcon name="x" size={14}/></button></div>)}
          {files.map((x, i) => <div className="t" key={i}>{x.video ? <><video src={x.url + '#t=0.5'} muted playsInline preload="metadata"/><span className="vt"><LIcon name="play" size={14} fill="#fff"/>{Math.round(x.f.size / 1e6)}MB</span></> : <img src={x.url} alt=""/>}<button className="x" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} aria-label="빼기"><LIcon name="x" size={14}/></button></div>)}
          {kept.length + files.length < maxN && <button className="add" onClick={() => pick.current.click()}><LIcon name="image-plus" size={28}/>{maxN === 1 ? '사진 고르기' : '사진·동영상'}</button>}
        </div>
        <input ref={pick} type="file" accept={maxN === 1 ? 'image/*' : 'image/*,video/*'} multiple={maxN > 1} hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }}/>
        {edit && photosOf(edit).length > kept.length && <p className="small muted" style={{ margin: '8px 2px 0' }}>뺀 사진·동영상도 구글 드라이브에는 그대로 남아요.</p>}
      </div>
      <div className="field">
        <label>{daily ? '한 줄 (선택)' : '무슨 일이 있었나요?'}</label>
        <textarea className="input" rows={daily ? 2 : 4} placeholder={daily ? '오늘 하루 한 줄' : '편하게 적거나, 아래 "말로 쓰기"를 눌러 말해 보세요'} value={text} onChange={e => setText(e.target.value)}/>
        <div style={{ marginTop: 8 }}><MicButton dict={dict}/></div>
        {!daily && <p className="small muted" style={{ margin: '8px 2px 0' }}>글에 <span className="htag">#바다</span> <span className="htag">#할머니댁</span>처럼 적으면, 나중에 눌러서 같은 소식끼리 모아 볼 수 있어요.</p>}
      </div>
      {isDaily && (
        <div className="field">
          <label>소리 깔기 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
          <div className="seg3" role="radiogroup" aria-label="소리 깔기">
            {[['', '소리 없음'], ['music', '🎵 음악'], ['voice', '🎙 목소리']].map(([k, l]) => <button type="button" role="radio" aria-checked={sound === k} key={k} className={sound === k ? 'on' : ''} onClick={() => setSound(k)}>{l}</button>)}
          </div>
          {sound === 'music' && <div style={{ marginTop: 10 }}><MusicPicker value={music} onChange={setMusic}/></div>}
          {sound === 'voice' && <div style={{ marginTop: 10 }}>
            {voice
              ? <div className="row gap">{voice.keep ? <div className="grow"><VoicePlayer src={voice.keep}/></div> : <audio className="grow" controls src={voice.url}/>}<button type="button" className="btn soft sm" onClick={() => setVoice(null)}>다시 녹음</button></div>
              : <><RecordButton block label="눌러서 녹음하기 (30초쯤까지)" onDone={async r => setVoice({ ...r, url: URL.createObjectURL(r.blob) })}/><p className="small muted" style={{ margin: '8px 2px 0' }}>예) "오늘 텃밭 고추가 참 잘 됐다~", 아이 노래, 생일 축하 노래. 식구들이 스토리를 열면 이 목소리가 들려요.</p></>}
          </div>}
        </div>
      )}
      {!daily && (
        <>
          <div className="field">
            <label>사진 위 손글씨 한 줄 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
            <input className="input" maxLength={30} placeholder="예: 우리, 오늘도 함께 ♡" value={ovl} onChange={e => setOvl(e.target.value)} style={{ fontFamily: "'Nanum Pen Script',cursive", fontSize: '1.4rem' }}/>
          </div>
          <div className="field">
            <label>언제 있었던 일인가요?</label>
            <input type="date" className="input" max={ymd()} value={day} onChange={e => setDay(e.target.value)}/>
            {day !== ymd() && <p className="small muted" style={{ margin: '6px 2px 0' }}>옛날 사진도 그날 날짜로 올리면 "N년 전 오늘"에 다시 떠요.</p>}
          </div>
          <CapsulePicker on={cap} setOn={setCap} date={openOn} setDate={setOpenOn} member={capMember}/>
          <div className="field">
            <label>한 사람에게 물어보기 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
            <p className="small muted" style={{ margin: '0 2px 10px' }}>이 사진을 보고 식구 한 사람에게 묻고 싶은 게 있으면 얼굴을 누르세요. 그 식구에게 알림이 가고, 답이 소식 아래에 남아요.</p>
            <div className="whopick" role="radiogroup" aria-label="물어볼 식구">
              <button type="button" role="radio" aria-checked={!askTo} className={!askTo ? 'on' : ''} onClick={() => setAskTo('')}><span className="none"><LIcon name="x" size={22}/></span><span>없음</span></button>
              {others.map(m => <button type="button" role="radio" aria-checked={askTo === m.id} key={m.id} className={askTo === m.id ? 'on' : ''} onClick={() => setAskTo(m.id)}><Avatar m={m} size={52}/><span>{m.name}</span></button>)}
            </div>
            {askTo && <><input className="input" style={{ marginTop: 10 }} placeholder={`${C.getM(askTo).name}께: 예) 이 사진 속 집, 기억나세요?`} value={askText} onChange={e => setAskText(e.target.value)}/><div style={{ marginTop: 8 }}><MicButton dict={dictQ}/></div></>}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ═══════════ 오늘의 한 장 보기 (스토리) ═══════════ */
function StoryViewer({ items, onClose }) {
  const C = useC(); const [i, setI] = useState(0); const [t, setT] = useState(0);
  const open = !!(items && items.length);
  useLayer(open, onClose);
  useEffect(() => { setI(0); setT(0); }, [items]);
  const cur = open ? items[Math.min(i, items.length - 1)] : null;
  useEffect(() => { if (cur) C.markSeen(cur.id); }, [cur && cur.id]);
  /* 소리 깔기: 음악(30초 미리 듣기)이나 목소리가 있으면 틀고, 그 길이만큼 머문다 (없으면 6초) */
  const [muted, setMuted] = useState(() => store.get('fz_story_mute') === '1'); const [needTap, setNeedTap] = useState(false);
  const au = useRef(null);
  const sndSec = !cur ? 0 : cur.music ? Math.max(6, MUSIC_SEC - (cur.music.start || 0)) : cur.audio_url ? Math.min(60, Math.max(6, voiceSec(cur.audio_url) + 1)) : 0;
  const durMs = sndSec ? sndSec * 1000 : 6000;
  useEffect(() => {
    setNeedTap(false);
    if (!cur || (!cur.music && !cur.audio_url)) return;
    let alive = true;
    (async () => {
      const a = cur.music ? playMusic(cur.music) : new Audio(await voiceSrc(cur.audio_url).catch(() => ''));
      if (!alive) return;
      au.current = a; a.muted = muted;
      a.play().catch(() => alive && setNeedTap(true));   // 아이폰 등은 한 번 눌러야 소리가 난다
    })();
    return () => { alive = false; dropAudio(au.current); au.current = null; };
  }, [cur && cur.id]);
  const toggleMute = () => { const m = !muted; setMuted(m); store.set('fz_story_mute', m ? '1' : ''); if (au.current) { au.current.muted = m; if (!m) au.current.play().then(() => setNeedTap(false)).catch(() => {}); } };
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setT(x => x + 1), durMs / 100);
    return () => clearInterval(iv);
  }, [open, i, durMs]);
  useEffect(() => { if (t >= 100) { if (i < items.length - 1) { setI(i + 1); setT(0); } else onClose(); } }, [t]);
  if (!open) return null;
  const a = C.getM(cur.author_id); const ph = photosOf(cur)[0];
  const likes = C.likesOf(cur.id); const iLike = likes.includes(C.me);
  return (
    <div className="story">
      <div className="bars">{items.map((_, k) => <i key={k}><b style={{ width: k < i ? '100%' : k === i ? t + '%' : '0%' }}/></i>)}</div>
      <div className="sh">
        <Avatar m={a} size={34}/><b>{a.name}</b><span style={{ opacity: .7, fontSize: '.85rem' }}>{relDay(cur.happened_on, cur.created_at)}</span>
        <span className="grow"/>
        {(cur.music || cur.audio_url) && <button className="iconbtn" onClick={toggleMute} aria-label={muted ? '소리 켜기' : '소리 끄기'}><LIcon name={muted ? 'volume-x' : 'volume-2'} size={26} stroke="#fff"/></button>}
        <button className="iconbtn" onClick={onClose} aria-label="닫기"><LIcon name="x" size={28} stroke="#fff"/></button>
      </div>
      {cur.music && <div className="s-music"><MusicTag m={cur.music}/></div>}
      {!cur.music && cur.audio_url && <div className="s-music"><span className="s-voice">🎙 {a.name}의 목소리</span></div>}
      {needTap && !muted && <button className="s-tap" onClick={() => { if (au.current) au.current.play().then(() => setNeedTap(false)).catch(() => {}); }}>🔊 눌러서 소리 듣기</button>}
      <div className="simg">
        {ph ? <img src={ph.url} alt="오늘의 한 장"/> : <div style={{ fontSize: '1.3rem', padding: 30 }}>{cur.content}</div>}
        <button className="tapL" aria-label="이전" onClick={() => { if (i > 0) { setI(i - 1); setT(0); } else setT(0); }}/>
        <button className="tapR" aria-label="다음" onClick={() => { if (i < items.length - 1) { setI(i + 1); setT(0); } else onClose(); }}/>
      </div>
      <div className="sc">
        <div className="grow">{ph && cur.content}{likes.length > 0 && <div className="small" style={{ opacity: .8 }}>{likes.map(id => C.getM(id).name).join(', ')} ❤️</div>}</div>
        <button className="iconbtn" onClick={() => C.toggleLike(cur)} aria-label="좋아요">{iLike ? <LIcon name="heart" size={30} fill="#ED4956" stroke="#ED4956"/> : <LIcon name="heart" size={30} stroke="#fff"/>}</button>
      </div>
    </div>
  );
}

/* 소식 목록에 끼는 냉장고 메모: 시간 순으로 이웃한 메모끼리 한 장에 */
const noteColors = ['#FFF6B8', '#FFE1E1', '#DDF3E4', '#E2ECFF'];
function FridgeCard({ notes }) {
  const C = useC();
  return (
    <article className="fridge">
      <button className="feed-band fr" onClick={C.openLetters}><span>📌 냉장고 메모</span><span className="go">냉장고 열기 <LIcon name="chevron-right" size={16}/></span></button>
      <div className="notes">
        {notes.map((n, i) => (
          <button key={n.id} className="note" onClick={() => C.openNote(n)} style={{ background: noteColors[i % 4], transform: `rotate(${n.angle || 0}deg)` }}>
            <div className="nt-who"><Avatar m={C.getM(n.author_id)} size={20}/><span>{C.getM(n.author_id).name}</span></div>
            <div className="nt-txt">{n.content}</div>
            <div className="tiny muted">{relTime(n.created_at)}</div>
            <NoteMeta n={n}/>
          </button>
        ))}
      </div>
    </article>
  );
}

/* 📌 냉장고 메모 하나: 마음(이모지 하나)·답글 */
function NoteSheet({ note, onClose }) {
  const C = useC(); const [t, setT] = useState(''); const [busy, setBusy] = useState(false); const [editId, setEditId] = useState(null);
  const dict = useDictation(x => setT(s => joinText(s, x)));
  useEffect(() => { if (note) { setT(''); setEditId(null); } }, [note && note.id]);
  const n = note && (C.notes.find(x => x.id === note.id) || note);
  const reacts = n ? C.noteReactsOf(n.id) : []; const mine = n ? (reacts.find(r => r.member_id === C.me) || {}).emoji : null;
  const replies = n ? C.noteRepliesOf(n.id) : [];
  const send = async () => { if (!t.trim()) return; setBusy(true); if (await C.replyNote(n, t.trim())) setT(''); setBusy(false); };
  return (
    <Sheet open={!!n} onClose={onClose} title="📌 냉장고 메모">
      {n && <>
        <div className="note big" style={{ background: n.color && n.color !== '#F7F4EB' ? n.color : '#FFF6B8' }}>
          <div className="nt-who"><Avatar m={C.getM(n.author_id)} size={24}/><span>{C.getM(n.author_id).name} · {relTime(n.created_at)}</span></div>
          <div className="nt-txt">{n.content}</div>
        </div>
        <div className="rbar inline" role="group" aria-label="마음 남기기">
          {REACTS.map(([e, w]) => <button key={e} className={mine === e ? 'on' : ''} onClick={() => C.reactNote(n, e)} aria-label={w}>{e}</button>)}
        </div>
        {reacts.length > 0 && <div className="small muted" style={{ margin: '2px 4px 12px' }}>{reacts.map(r => C.getM(r.member_id).name + r.emoji).join(', ')}</div>}
        <div className="sec-t" style={{ padding: '6px 0' }}>답글 {replies.length > 0 ? replies.length : ''}</div>
        {!replies.length && <p className="small muted" style={{ margin: '0 2px 10px' }}>"내가 사 올게요!"처럼 한마디 남겨 보세요.</p>}
        {replies.map(r => (
          <div className="cmt" key={r.id}>
            <Avatar m={C.getM(r.author_id)} size={28}/>
            <div className="body"><div><b>{C.getM(r.author_id).name}</b> {editId !== r.id && <span>{r.content}</span>}</div>
              {editId === r.id
                ? <EditLine text={r.content} onCancel={() => setEditId(null)} onSave={async x => { const ok = await C.editNoteReply(r, x); if (ok) setEditId(null); return ok; }}/>
                : <div className="meta"><span>{relTime(r.created_at)}</span>{r.author_id === C.me && <button onClick={() => setEditId(r.id)}>수정</button>}{(r.author_id === C.me || C.isAdmin) && <button onClick={() => C.deleteNoteReply(r)}>지우기</button>}</div>}</div>
          </div>
        ))}
        <div className="row gap" style={{ marginTop: 10 }}>
          <input className="input grow" placeholder="답글 한마디" value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }}/>
          <button className="btn primary sm" disabled={busy || !t.trim()} onClick={send}>{busy ? <span className="spin"/> : '보내기'}</button>
        </div>
        <div style={{ marginTop: 8 }}><MicButton dict={dict}/></div>
      </>}
    </Sheet>
  );
}
/* 메모 아래 작은 줄: 남긴 마음·답글 수 (누르면 메모 창) */
function NoteMeta({ n }) {
  const C = useC(); const rs = C.noteReactsOf(n.id); const k = C.noteRepliesOf(n.id).length;
  const kinds = [...new Set(rs.map(r => r.emoji))].slice(0, 3).join('');
  return <div className="nt-meta">{rs.length ? <span>{kinds} {rs.length}</span> : <span className="muted">♡</span>}<span className={k ? '' : 'muted'}>💬 {k || ''}</span></div>;
}

/* ═══════════ 🗳 가족 투표 ═══════════
   한 사람이 묻고 온 가족이 골라서 정한다. 누가 무엇을 골랐는지 이름이 보인다.
   고르기 전에는 결과를 가려 두고(남 따라 고르지 않게), 내가 고르거나 투표가 끝나면 막대·이름이 보인다 */
const POLL_MAX = 8;
const pollClosed = p => !!p.closed_at || !!(p.closes_on && p.closes_on < ymd());
function pollTally(p, votes) {
  const opts = [...(p.options || []), ...(p.allow_other ? [{ id: 'other', text: '기타' }] : [])];
  const who = {}; opts.forEach(o => who[o.id] = []);
  votes.forEach(v => who[v.opt] && who[v.opt].push(v));
  const voters = [...new Set(votes.map(v => v.member_id))];
  const best = Math.max(0, ...opts.map(o => who[o.id].length));
  return { opts, who, voters, best, win: best ? opts.filter(o => who[o.id].length === best) : [] };
}
function PollCard({ p, focus, feed }) {
  const C = useC(); const a = C.getM(p.author_id); const ref = useRef(null);
  const [menu, setMenu] = useState(false); const [peek, setPeek] = useState(false); const [busy, setBusy] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false); const [otherT, setOtherT] = useState('');
  const dict = useDictation(t => setOtherT(s => joinText(s, t)));
  useEffect(() => { if (focus && ref.current) setTimeout(() => ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); }, [focus]);
  useViewed(ref, p.id, 'poll', p.author_id);
  const votes = C.votesOf(p.id); const T = pollTally(p, votes);
  const mineV = votes.filter(v => v.member_id === C.me); const mine = new Set(mineV.map(v => v.opt));
  const closed = pollClosed(p); const show = closed || mine.size > 0 || peek;
  const n = T.voters.length; const total = C.members.length;
  const notYet = C.members.filter(m => !T.voters.includes(m.id));
  const left = p.closes_on && !closed ? dayDiff(ymd(), p.closes_on) : null;
  const pick = async o => {
    if (closed || busy) return;
    if (o.id === 'other') { setOtherT((mineV.find(v => v.opt === 'other') || {}).other_text || ''); setOtherOpen(true); return; }
    setBusy(true); await C.vote(p, o.id); setBusy(false);
  };
  const sendOther = async t => { setBusy(true); if (await C.vote(p, 'other', t)) setOtherOpen(false); setBusy(false); };
  return (
    <article ref={ref} className={'pray poll' + (focus ? ' focus' : '')}>
      {feed && <div className="feed-band pl"><span>🗳 가족 투표</span><span className="go">{closed ? '끝난 투표' : `${n}/${total}명 투표`}</span></div>}
      <div className="pray-hd">
        <Avatar m={a} size={38} onClick={() => C.openProfile(a.id)}/>
        <div className="grow">
          <div><b>{a.name}</b>의 투표</div>
          <div className="pray-tags">
            <span>{relTime(p.created_at)}</span>
            {p.multi && <span className="tag pl">여러 개 고르기</span>}
            {closed ? <span className="tag">투표 끝</span> : p.closes_on && <span className={'tag pl' + (left === 0 ? ' today' : '')}>⏰ {left === 0 ? '오늘 마감' : `${fmtDate(p.closes_on)}까지 · D-${left}`}</span>}
          </div>
        </div>
        {(p.author_id === C.me || C.isAdmin) && <button className="iconbtn" onClick={() => setMenu(true)} aria-label="더 보기"><LIcon name="ellipsis"/></button>}
      </div>
      <div className="poll-q">{p.question}</div>
      {p.note && <div className="poll-note">{p.note}</div>}
      {closed && T.win.length > 0 && <div className="poll-win">🏆 {T.win.length > 1 ? '동점이에요' : '결정됐어요'}: <b>{T.win.map(o => o.id === 'other' ? `기타 (${T.who.other.map(v => `“${v.other_text}”`).join(', ')})` : o.text).join(', ')}</b> ({T.best}표)</div>}
      <div className="poll-opts">
        {T.opts.map(o => {
          const vs = T.who[o.id] || []; const pct = n ? Math.round(vs.length / n * 100) : 0; const on = mine.has(o.id);
          return (
            <div key={o.id}>
              <button className={'popt' + (on ? ' on' : '') + (closed && T.win.includes(o) ? ' win' : '') + (o.photo ? ' ph' : '')} disabled={closed || busy} onClick={() => pick(o)} aria-pressed={on}>
                {o.photo && <img src={o.photo.thumb || o.photo.url} alt="" loading="lazy"/>}
                <span className="pbody">
                  {show && <span className="pfill" style={{ width: pct + '%' }}/>}
                  <span className="ptxt">{on && <LIcon name="circle-check" size={19}/>}{o.id === 'other' ? '✏️ 기타 (직접 적기)' : o.text}</span>
                  {show && <span className="ppct">{pct}%</span>}
                </span>
              </button>
              {show && vs.length > 0 && <div className="pwho">{vs.map(v => <span key={v.member_id}><Avatar m={C.getM(v.member_id)} size={20}/>{C.getM(v.member_id).name}{v.other_text && <i>“{v.other_text}”</i>}</span>)}</div>}
            </div>
          );
        })}
      </div>
      <div className="pray-ft">
        <span className="qh-faces">{T.voters.slice(0, 6).map(id => <span key={id}><Avatar m={C.getM(id)} size={24}/></span>)}</span>
        <span className="grow small muted">{closed ? `${n}명이 투표했어요` : !show ? (n ? `${n}명 투표했어요 · 고르면 결과가 보여요` : '아직 아무도 고르지 않았어요') : n >= total ? '온 가족이 투표했어요 🎉' : `${n}/${total}명 투표 · 아직: ${notYet.map(m => m.name).join(', ')}`}</span>
        {!show && n > 0 && <button className="pray-btn on" onClick={() => setPeek(true)}>결과 보기</button>}      </div>
      <Sheet open={otherOpen} onClose={() => setOtherOpen(false)} title="✏️ 기타 (직접 적기)">
        <p className="small muted" style={{ marginTop: 0 }}>“{p.question}”</p>
        <textarea className="input" rows={2} placeholder="내 생각을 적어 주세요" value={otherT} onChange={e => setOtherT(e.target.value)}/>
        <div style={{ margin: '8px 0 14px' }}><MicButton dict={dict}/></div>
        <div className="row gap">
          {mine.has('other') && <button className="btn soft grow" disabled={busy} onClick={() => sendOther('')}>내 의견 빼기</button>}
          <button className="btn primary grow" disabled={busy || !otherT.trim()} onClick={() => sendOther(otherT.trim())}>{busy ? <span className="spin"/> : '이걸로 투표'}</button>
        </div>
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)} title="가족 투표">
        <div style={{ display: 'grid', gap: 8 }}>
          {p.author_id === C.me && !closed && <button className="btn soft block" onClick={() => { setMenu(false); if (window.confirm('투표를 마칠까요? 지금 결과로 정해져요.')) C.write(() => db.patch('polls', p.id, { closed_at: new Date().toISOString() }), '투표를 마쳤어요 🏆'); }}>🏁 투표 마치기 (결과 정하기)</button>}
          {p.author_id === C.me && closed && <button className="btn soft block" onClick={() => { setMenu(false); C.write(() => db.patch('polls', p.id, { closed_at: null, closes_on: p.closes_on && p.closes_on < ymd() ? null : p.closes_on }), '투표를 다시 열었어요'); }}>🔓 투표 다시 열기</button>}
          <button className="btn soft block danger" onClick={() => { setMenu(false); if (window.confirm('이 투표를 지울까요? 고른 것도 함께 지워져요.')) C.write(() => db.del('polls', `id=eq.${p.id}`), '투표를 지웠어요'); }}><LIcon name="trash-2" size={18}/>지우기</button>
        </div>
      </Sheet>
    </article>
  );
}

/* 🗳 투표 만들기: 질문 + 보기(보기마다 사진 한 장 넣을 수 있음) + 기타·여러 개·마감 */
function PollCompose({ open, onClose }) {
  const C = useC();
  const newOpt = () => ({ id: 'o' + Math.random().toString(36).slice(2, 8), text: '', file: null, url: '' });
  const [q, setQ] = useState(''); const [note, setNote] = useState(''); const [opts, setOpts] = useState([]);
  const [other, setOther] = useState(true); const [multi, setMulti] = useState(false); const [due, setDue] = useState(''); const [busy, setBusy] = useState('');
  const pick = useRef(null); const picking = useRef(null);
  const dict = useDictation(t => setQ(s => joinText(s, t)));
  useEffect(() => { if (open) { setQ(''); setNote(''); setOpts([newOpt(), newOpt()]); setOther(true); setMulti(false); setDue(''); setBusy(''); } }, [open]);
  const setOpt = (id, patch) => setOpts(os => os.map(o => o.id === id ? { ...o, ...patch } : o));
  const filled = opts.filter(o => o.text.trim() || o.file);
  const can = !busy && q.trim() && filled.length >= 2;
  const today = ymd();
  const dues = [['', '마감 없음'], [dayAdd(today, 1), '내일까지'], [dayAdd(today, 3), '3일 뒤'], [dayAdd(today, 7), '일주일']];
  const submit = async () => {
    if (filled.some(o => !o.text.trim())) { C.toast('사진만 넣은 보기에도 이름을 적어 주세요'); return; }
    try {
      const options = [];
      for (let i = 0; i < filled.length; i++) {
        const o = filled[i];
        if (o.file) setBusy(`사진 올리는 중 ${i + 1}/${filled.length}`);
        options.push({ id: o.id, text: o.text.trim(), photo: o.file ? await uploadPhoto(o.file, 900) : null });
      }
      setBusy('투표 올리는 중…');
      const ok = await C.write(() => db.add('polls', { author_id: C.me, question: q.trim(), note: note.trim(), options, allow_other: other, multi, closes_on: due || null }), '투표를 올렸어요 🗳');
      if (ok) onClose(); else setBusy('');
    } catch (e) { setBusy(''); C.toast('올리지 못했어요: ' + e.message); }
  };
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} full title="🗳 가족 투표 만들기"
      right={<button className="hdbtn" disabled={!can} onClick={submit}>{busy ? <span className="spin dark"/> : '올리기'}</button>}>
      {busy && <div className="recbox" style={{ marginBottom: 14, background: '#EAF3FF' }}><div className="row gap"><span className="spin dark"/>{busy}</div></div>}
      <p className="small muted" style={{ marginTop: 0 }}>가족이 함께 정할 일을 물어보세요. 누가 무엇을 골랐는지 이름이 보여요.</p>
      <div className="field">
        <label>무엇을 정할까요?</label>
        <input className="input" placeholder="예: 이번 토요일 저녁 뭐 먹을까?" value={q} onChange={e => setQ(e.target.value)}/>
        <div style={{ marginTop: 8 }}><MicButton dict={dict}/></div>
      </div>
      <div className="field">
        <label>보기 <span className="muted" style={{ fontWeight: 400 }}>(왼쪽 네모를 누르면 사진을 넣어요)</span></label>
        <div style={{ display: 'grid', gap: 8 }}>
          {opts.map((o, i) => (
            <div className="row gap" key={o.id}>
              <button type="button" className="popt-ph" onClick={() => { picking.current = o.id; pick.current.click(); }} aria-label={`${i + 1}번 보기 사진`}>
                {o.url ? <img src={o.url} alt=""/> : <LIcon name="image-plus" size={24}/>}
              </button>
              <input className="input grow" maxLength={40} placeholder={`${i + 1}번 보기`} value={o.text} onChange={e => setOpt(o.id, { text: e.target.value })}/>
              {opts.length > 2 && <button type="button" className="iconbtn" onClick={() => setOpts(os => os.filter(x => x.id !== o.id))} aria-label="보기 빼기"><LIcon name="x" size={20}/></button>}
            </div>
          ))}
          {opts.length < POLL_MAX && <button type="button" className="btn soft block" onClick={() => setOpts(os => [...os, newOpt()])}><LIcon name="plus" size={18}/>보기 더하기</button>}
        </div>
        <input ref={pick} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files && e.target.files[0]; if (f && picking.current) setOpt(picking.current, { file: f, url: URL.createObjectURL(f) }); e.target.value = ''; }}/>
      </div>
      <div className="field" style={{ display: 'grid', gap: 4 }}>
        <Toggle on={other} onChange={setOther} label="✏️ 기타 (직접 적기) 넣기" sub="보기에 없는 생각을 적어서 투표할 수 있어요"/>
        <Toggle on={multi} onChange={setMulti} label="여러 개 고를 수 있게" sub="끄면 한 사람이 하나만 골라요"/>
      </div>
      <div className="field">
        <label>언제까지 투표할까요?</label>
        <div className="chips">{dues.map(([d, l]) => <button type="button" key={l} className={'chip' + (due === d ? ' on' : '')} onClick={() => setDue(d)}>{l}</button>)}</div>
        <input type="date" className="input" style={{ marginTop: 8 }} min={today} value={due} onChange={e => setDue(e.target.value)}/>
        <p className="small muted" style={{ margin: '6px 2px 0' }}>{due ? `${fmtDate(due, true)} 밤까지 고를 수 있어요. 그날 아침에 아직 안 한 식구에게 알림이 가요.` : '마감 없이 두고, 올린 사람이 "투표 마치기"를 눌러 정할 수 있어요.'}</p>
      </div>
      <div className="field">
        <label>한마디 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
        <textarea className="input" rows={2} placeholder="예: 다수결로 정해요! 동점이면 할머니 마음대로 ☺" value={note} onChange={e => setNote(e.target.value)}/>
      </div>
    </Sheet>
  );
}

/* ═══════════ 홈 ═══════════ */
function HomeTab() {
  const C = useC(); const today = ymd();
  /* 소식 목록: 소식(오늘의 한 장 포함)·기도·냉장고 메모를 날짜 순으로 섞는다. 이웃한 메모는 한 장으로 묶는다 */
  const feed = useMemo(() => {
    const items = [
      ...C.posts.map(p => ({ k: 'p' + p.id, t: 'post', p, s: p.happened_on + '|' + p.created_at })),
      ...C.prayers.map(p => ({ k: 'r' + p.id, t: 'pray', p, s: ymd(new Date(p.created_at)) + '|' + p.created_at })),
      ...C.notes.map(n => ({ k: 'n' + n.id, t: 'note', p: n, s: ymd(new Date(n.created_at)) + '|' + n.created_at })),
      ...C.polls.map(p => ({ k: 'v' + p.id, t: 'poll', p, s: ymd(new Date(p.created_at)) + '|' + p.created_at })),
    ].sort((a, b) => b.s.localeCompare(a.s));
    const out = [];
    items.forEach(x => { const last = out[out.length - 1]; if (x.t === 'note' && last && last.t === 'notes') last.list.push(x.p); else out.push(x.t === 'note' ? { k: x.k, t: 'notes', list: [x.p] } : x); });
    return out;
  }, [C.posts, C.prayers, C.notes, C.polls]);
  const [shown, setShown] = useState(15); const endRef = useRef(null);
  useEffect(() => {
    const el = endRef.current; if (!el || !window.IntersectionObserver) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setShown(n => n + 15); }, { rootMargin: '800px' });
    io.observe(el); return () => io.disconnect();
  }, [shown, feed.length]);
  const order = [C.me, ...C.members.map(m => m.id).filter(id => id !== C.me)];
  const stories = order.map(id => C.getM(id)).sort((x, y) => {
    if (x.id === C.me) return -1; if (y.id === C.me) return 1;
    const rank = m => ({ '': 3, plain: 3, seen: 2, bday: 0 }[C.storyRing(m.id) || ''] ?? 1);
    return rank(x) - rank(y);
  });
  const md = today.slice(5);
  const ago = C.posts.filter(p => p.happened_on.slice(5) === md && p.happened_on < today.slice(0, 4) && !isLocked(p));
  const agoYears = [...new Set(ago.map(p => +today.slice(0, 4) - +p.happened_on.slice(0, 4)))].sort((a, b) => a - b);
  const agoPhotos = ago.flatMap(p => photosOf(p)).slice(0, 3);
  const askedMe = C.posts.filter(p => p.ask_to === C.me && !isLocked(p) && !C.commentsOf(p.id).some(c => c.is_answer && c.author_id === C.me));
  const wq = C.weekQ;
  return (
    <>
      <div className="topbar brand-hd">
        <div>
          <span className="brand">Familygram<LIcon name="heart" size={20} fill="#ED4956" stroke="#ED4956"/></span>
          <span className="brand-sub">함께하는 모든 순간이 소중해요 ♥</span>
        </div>
        <div className="row">
          <button className="iconbtn" onClick={C.openNoti} aria-label="알림"><LIcon name={C.newCount > 0 ? 'bell-ring' : 'bell'} size={26}/>{C.newCount > 0 && <span className="cnt" style={{ top: -1, right: -6 }}>{C.newCount}</span>}</button>
          <button className="iconbtn" onClick={C.openLetters} aria-label="편지함"><LIcon name="send" size={26}/>{C.unread > 0 && <span className="cnt">{C.unread}</span>}</button>
        </div>
      </div>
      <div className="stories">
        {stories.map(m => {
          const ring = C.storyRing(m.id) || 'plain'; const bd = C.bdayDays(m.id);
          const mine = m.id === C.me; const has = C.dailyToday(m.id).length > 0;
          /* 그림·＋·이름 어디를 눌러도 되게 한 칸 전체가 단추 (예전엔 그림만 반응해서 ＋나 이름을 누르면 아무 일도 없었다) */
          const tap = () => { if (mine && !has) C.openComposer({ mode: 'daily' }); else if (has) C.openStory(C.dailyToday(m.id)); else C.openProfile(m.id); };
          return (
            <button type="button" className="st" key={m.id} onClick={tap} aria-label={mine && !has ? '내 스토리 올리기' : mine ? '내 스토리 보기' : `${m.name} ${has ? '스토리 보기' : '프로필'}`}>
              {mine && !has
                ? <span className="me0">{m.avatar ? <Avatar m={m} size={68}/> : <LIcon name="users" size={30}/>}</span>
                : <Avatar m={m} size={62} ring={ring}/>}
              {mine && !has && <span className="addp"><LIcon name="plus" size={13} sw={3}/></span>}
              {bd !== null && bd <= 7 && !(mine && !has) && <span className="mini">🎂{ddayText(bd)}</span>}
              <span className="lb">{mine ? '내 스토리' : m.name}</span>
            </button>
          );
        })}
      </div>
      {wq && <QHero q={wq} onOpen={() => C.openQuestion(wq)}/>}
      <InstallCard/>
      <PushCard/>
      {askedMe.length > 0 && (
        <button className="banner" onClick={() => C.openComments(askedMe[0])}>
          <Avatar m={C.getM(askedMe[0].author_id)} size={42}/>
          <div className="grow"><b>{josa(C.getM(askedMe[0].author_id).name, '이', '가')} 질문했어요</b><span>“{askedMe[0].ask_text}”{askedMe.length > 1 ? ` 외 ${askedMe.length - 1}개` : ''}</span></div>
          <LIcon name="chevron-right"/>
        </button>
      )}
      {ago.length > 0 && (
        <button className="banner ago" onClick={() => C.openAgo(ago)}>
          {agoPhotos.length > 0 ? <div className="th">{agoPhotos.map((ph, i) => <img key={i} src={ph.thumb || ph.url} alt=""/>)}</div> : <div className="bic" style={{ background: '#FFF5E2', color: '#B5861C' }}><LIcon name="history"/></div>}
          <div className="grow"><b>{agoYears.map(y => `${y}년`).join('·')} 전 오늘</b><span>그날의 소식 {ago.length}개 · 눌러서 보기</span></div>
          <LIcon name="chevron-right"/>
        </button>
      )}
      <div style={{ height: 4 }}/>
      {!feed.length && <div className="empty">아직 소식이 없어요.<br/>아래 가운데 <b>＋ 새 소식</b>을 눌러 첫 소식을 올려 보세요.<div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => C.openComposer({})}><LIcon name="square-plus" size={20}/>첫 소식 올리기</button></div></div>}
      {feed.slice(0, shown).map(x => x.t === 'post' ? <PostCard key={x.k} p={x.p}/> : x.t === 'pray' ? <PrayCard key={x.k} p={x.p} feed/> : x.t === 'poll' ? <PollCard key={x.k} p={x.p} feed/> : <FridgeCard key={x.k} notes={x.list}/>)}
      {shown < feed.length
        ? <div ref={endRef} className="empty small"><button className="btn soft" onClick={() => setShown(n => n + 15)}>소식 더 보기 ({feed.length - shown}개 남음)</button></div>
        : feed.length > 0 && <p className="empty small" style={{ padding: '24px 20px' }}>여기까지가 우리 가족 소식 전부예요 🌿</p>}
    </>
  );
}

/* ═══════════ 달력 ═══════════ */
function CalendarTab() {
  const C = useC(); const today = ymd();
  const [mode, setMode] = useState('ev');
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(today); const [who, setWho] = useState('all'); const [adding, setAdding] = useState(false);
  const Y = cur.getFullYear(), M = cur.getMonth();
  const allEvents = C.allEvents;
  const byDay = useMemo(() => {
    const map = {};
    allEvents.forEach(ev => occurIn(ev, Y).forEach(s => { if (+s.slice(5, 7) === M + 1) (map[s] = map[s] || []).push(ev); }));
    return map;
  }, [allEvents, Y, M]);
  const hol = holidays(Y);
  const dailies = useMemo(() => {
    const map = {};
    C.posts.filter(p => p.kind === 'daily' && (who === 'all' || p.author_id === who)).forEach(p => (map[p.happened_on] = map[p.happened_on] || []).push(p));
    return map;
  }, [C.posts, who]);
  const first = new Date(Y, M, 1).getDay(); const days = new Date(Y, M + 1, 0).getDate();
  const cells = []; for (let i = 0; i < first; i++) cells.push(null); for (let d = 1; d <= days; d++) cells.push(`${Y}-${pad(M + 1)}-${pad(d)}`);
  const upcoming = allEvents.map(ev => ({ ev, d: nextOccur(ev, today) })).filter(x => x.d && dayDiff(today, x.d) <= 120).sort((a, b) => a.d.localeCompare(b.d));
  const holUp = [];
  for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) Object.entries(holidays(y)).forEach(([d, n]) => { if (d >= today && dayDiff(today, d) <= 60 && !/연휴/.test(n)) holUp.push({ d, n }); });
  const selEvents = (byDay[sel] || []);
  const kindIcon = k => ({ birthday: '🎂', anniversary: '💍', memorial: '🕯️' }[k] || '📌');
  const colorOf = ev => ev.member_id ? C.getM(ev.member_id).color : '#555';
  return (
    <>
      <div className="topbar"><span className="h1">달력</span><button className="iconbtn" onClick={() => setAdding(true)} aria-label="일정 넣기"><LIcon name="plus" size={28}/></button></div>
      <div className="pad" style={{ marginBottom: 6 }}>
        <div className="seg"><button className={mode === 'ev' ? 'on' : ''} onClick={() => setMode('ev')}>📅 일정</button><button className={mode === 'ph' ? 'on' : ''} onClick={() => setMode('ph')}>🖼 오늘의 한 장</button></div>
      </div>
      <div className="cal-hd">
        <button className="iconbtn" onClick={() => setCur(new Date(Y, M - 1, 1))} aria-label="이전 달"><LIcon name="chevron-left"/></button>
        <b>{Y}년 {M + 1}월</b>
        <button className="iconbtn" onClick={() => setCur(new Date(Y, M + 1, 1))} aria-label="다음 달"><LIcon name="chevron-right"/></button>
      </div>
      {mode === 'ph' && (
        <div className="chips pad" style={{ marginBottom: 8 }}>
          <button className={'chip' + (who === 'all' ? ' on' : '')} onClick={() => setWho('all')}>모두</button>
          {C.members.map(m => <button key={m.id} className={'chip' + (who === m.id ? ' on' : '')} onClick={() => setWho(m.id)}>{m.emoji} {m.name}</button>)}
        </div>
      )}
      <div className="cal-wd">{WD.map(w => <span key={w}>{w}</span>)}</div>
      <div className="cal" style={{ gap: mode === 'ph' ? 2 : 0 }}>
        {cells.map((s, i) => {
          if (!s) return <div key={'e' + i}/>;
          const dow = parseYmd(s).getDay(); const cls = ['cell', s === today && 'today', hol[s] && 'hol', dow === 0 && 'sun', dow === 6 && 'sat'].filter(Boolean);
          if (mode === 'ph') {
            const ds = dailies[s] || []; const ph = ds.length ? photosOf(ds[0])[0] : null;
            return <button key={s} className={[...cls, 'ph'].join(' ')} onClick={() => ds.length && C.openStory(ds)} aria-label={s}>{ph ? <img src={ph.thumb || ph.url} alt=""/> : <span style={{ width: '100%', height: '100%', background: '#f6f6f6', borderRadius: 8, display: 'block' }}/>}<span className="dn">{+s.slice(8)}</span></button>;
          }
          const evs = byDay[s] || [];
          return (
            <button key={s} className={[...cls, sel === s && 'sel'].filter(Boolean).join(' ')} onClick={() => setSel(s)}>
              <span className="dn">{+s.slice(8)}</span>
              {hol[s] && <span className="hn">{hol[s]}</span>}
              {evs.slice(0, 2).map(ev => <span key={ev.id} className="ev" style={{ background: colorOf(ev) }}>{ev.title}</span>)}
              {evs.length > 2 && <span className="tiny muted">+{evs.length - 2}</span>}
            </button>
          );
        })}
      </div>
      {mode === 'ev' && (
        <>
          <div className="sec-t"><span>{fmtDate(sel)} ({WD[parseYmd(sel).getDay()]}) <span className="small muted" style={{ fontWeight: 400 }}>{lunarText(sel)}</span></span></div>
          {hol[sel] && <div className="up-item"><span style={{ fontSize: '1.4rem' }}>🎌</span><b style={{ color: '#e0453a' }}>{hol[sel]}</b></div>}
          {!selEvents.length && !hol[sel] && <p className="small muted pad">이날은 일정이 없어요.</p>}
          {selEvents.map(ev => <EventRow key={ev.id} ev={ev} d={sel}/>)}
          <div className="sec-t">다가오는 날</div>
          {!upcoming.length && !holUp.length && <p className="small muted pad">다가오는 일정이 없어요. 오른쪽 위 ＋로 생일·기념일을 넣어 보세요.</p>}
          {upcoming.map(({ ev, d }) => <EventRow key={ev.id + d} ev={ev} d={d} showDday/>)}
          {holUp.slice(0, 4).map(h => <div key={h.d} className="up-item"><span style={{ fontSize: '1.4rem' }}>🎌</span><div className="grow"><b>{h.n}</b><span className="small muted" style={{ display: 'block' }}>{fmtDate(h.d)} ({WD[parseYmd(h.d).getDay()]})</span></div><span className="dday" style={{ color: '#e0453a' }}>{ddayText(dayDiff(today, h.d))}</span></div>)}
        </>
      )}
      {mode === 'ph' && <p className="small muted pad" style={{ marginTop: 12 }}>날짜를 누르면 그날의 한 장을 크게 봐요. 홈 맨 위 내 동그라미의 ＋로 오늘의 한 장을 올려요.</p>}
      <EventSheet open={adding} onClose={() => setAdding(false)} day={sel}/>
    </>
  );
  function EventRow({ ev, d, showDday }) {
    const n = dayDiff(today, d); const m = ev.member_id ? C.getM(ev.member_id) : null;
    return (
      <div className="up-item">
        <span style={{ fontSize: '1.4rem' }}>{kindIcon(ev.kind)}</span>
        <div className="grow">
          <b>{ev.title}</b>
          <span className="small muted" style={{ display: 'block' }}>{fmtDate(d)} ({WD[parseYmd(d).getDay()]}){ev.calendar === 'lunar' ? ` · 음력 ${ev.lunar_month}월 ${ev.lunar_day}일` : ''}{ev.yearly ? ' · 매년' : ''}{m ? ` · ${m.name}` : ''}</span>
        </div>
        {showDday && <span className={'dday' + (n <= 7 ? ' near' : '')}>{ddayText(n)}</span>}
        {!ev.virtual && <button className="iconbtn" onClick={() => C.deleteEvent(ev)} aria-label="일정 지우기"><LIcon name="trash-2" size={18}/></button>}
      </div>
    );
  }
}

function EventSheet({ open, onClose, day }) {
  const C = useC();
  const [title, setTitle] = useState(''); const [kind, setKind] = useState('event'); const [cal, setCal] = useState('solar');
  const [date, setDate] = useState(day || ymd()); const [lm, setLm] = useState(1); const [ld, setLd] = useState(1);
  const [yearly, setYearly] = useState(false); const [mid, setMid] = useState('');
  useEffect(() => { if (open) { setTitle(''); setKind('event'); setCal('solar'); setDate(day || ymd()); setYearly(false); setMid(''); const l = lunarOf(parseYmd(day || ymd())); if (l) { setLm(l.m); setLd(l.d); } } }, [open]);
  const kinds = [['event', '📌 일정'], ['birthday', '🎂 생일'], ['anniversary', '💍 기념일'], ['memorial', '🕯️ 기일']];
  const save = async () => {
    if (!title.trim()) { C.toast('이름을 적어 주세요'); return; }
    const row = { title: title.trim(), kind, member_id: mid || null, calendar: cal, yearly: cal === 'lunar' ? true : yearly,
      event_date: cal === 'solar' ? date : null, lunar_month: cal === 'lunar' ? +lm : null, lunar_day: cal === 'lunar' ? +ld : null };
    if (await C.write(() => db.add('events', row), '달력에 넣었어요')) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="일정 넣기" right={<button className="hdbtn" onClick={save}>저장</button>}>
      <div className="field"><label>무슨 날인가요?</label><input className="input" placeholder="예: 할아버지 기일, 결혼기념일" value={title} onChange={e => setTitle(e.target.value)}/></div>
      <div className="field"><label>종류</label><div className="chips">{kinds.map(([k, l]) => <button key={k} type="button" className={'chip' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); if (k !== 'event') setYearly(true); }}>{l}</button>)}</div></div>
      <div className="field"><label>양력 / 음력</label><div className="seg"><button type="button" className={cal === 'solar' ? 'on' : ''} onClick={() => setCal('solar')}>양력</button><button type="button" className={cal === 'lunar' ? 'on' : ''} onClick={() => setCal('lunar')}>음력 (매년 자동 계산)</button></div></div>
      {cal === 'solar'
        ? <div className="field"><label>날짜</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)}/></div>
        : <div className="field"><label>음력 날짜</label><div className="row gap">
            <select className="input" value={lm} onChange={e => setLm(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}</select>
            <select className="input" value={ld} onChange={e => setLd(e.target.value)}>{Array.from({ length: 30 }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}</select>
          </div>
          {(() => { const s = solarOfLunar(new Date().getFullYear(), +lm, +ld); const n = s && s < ymd() ? solarOfLunar(new Date().getFullYear() + 1, +lm, +ld) : s; return n ? <p className="small muted" style={{ margin: '6px 2px 0' }}>다음은 양력 {fmtDate(n, true)}이에요.</p> : null; })()}
        </div>}
      {cal === 'solar' && <div className="field"><Toggle on={yearly} onChange={setYearly} label="매년 반복" sub="생일·기념일은 켜 두세요"/></div>}
      <div className="field"><label>누구의 날인가요? <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
        <div className="chips"><button type="button" className={'chip' + (!mid ? ' on' : '')} onClick={() => setMid('')}>가족 모두</button>{C.members.map(m => <button type="button" key={m.id} className={'chip' + (mid === m.id ? ' on' : '')} onClick={() => setMid(m.id)}>{m.emoji} {m.name}</button>)}</div>
      </div>
      <p className="small muted">식구 생일은 "식구 → 프로필 고치기"에서 생년월일을 넣으면 달력에 저절로 들어가요.</p>
    </Sheet>
  );
}

/* ═══════════ 편지함 ═══════════ */
function LettersTab({ onBack }) {
  const C = useC(); const [fil, setFil] = useState('all'); const [note, setNote] = useState('');
  const list = C.letters.filter(l => fil === 'all' || (fil === 'in' ? l.receiver_id === C.me : l.sender_id === C.me));
  const wq = C.weekQ;
  const year = new Date().getFullYear();
  const yp = C.posts.filter(p => p.happened_on.startsWith(year + '') && !isLocked(p));
  const yPhotos = yp.reduce((n, p) => n + photosOf(p).length, 0);
  const yVoices = C.comments.filter(c => c.audio_url && c.created_at.startsWith(year + '')).length + C.answers.filter(a => a.audio_url && a.created_at.startsWith(year + '')).length;
  return (
    <>
      <div className="topbar" style={{ paddingLeft: 4 }}>
        <div className="row">{onBack && <button className="iconbtn" onClick={onBack} aria-label="뒤로"><LIcon name="chevron-left" size={28}/></button>}<span className="h1">편지함</span></div>
        <button className="iconbtn" onClick={() => C.openLetterCompose({})} aria-label="편지 쓰기"><LIcon name="square-pen" size={26}/></button>
      </div>
      {wq && (
        <QHero q={wq} onOpen={() => C.openQuestion(wq)}/>
      )}
      <div className="fil">{[['all', '모두'], ['in', '나에게 온'], ['out', '내가 보낸']].map(([k, l]) => <button key={k} className={'chip' + (fil === k ? ' on' : '')} onClick={() => setFil(k)}>{l}</button>)}</div>
      {!list.length && <div className="empty">아직 편지가 없어요.<br/>오른쪽 위 연필을 눌러 첫 편지를 써 보세요.</div>}
      {list.map(l => {
        const s = C.getM(l.sender_id), r = C.getM(l.receiver_id); const lock = isLocked(l);
        const isNew = l.receiver_id === C.me && !l.read_at && !lock;
        return (
          <button className="lt" key={l.id} onClick={() => C.openLetter(l)}>
            <div className="env" style={lock ? { background: '#EEE8F7', color: '#6A55A3' } : isNew ? { background: '#FDEBE3', color: '#D0603A' } : { background: '#E3F1E9', color: '#2E7D5B' }}>
              <LIcon name={lock ? 'lock' : isNew ? 'mail' : 'mail-open'}/>
            </div>
            <div className="grow"><b>{s.name} → {r.name}</b><span>{lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.audio_url ? '🎙 ' : '') + (l.title || l.content)}</span></div>
            {isNew ? <span className="new">새 편지</span> : <span className="tiny muted">{relTime(l.created_at)}</span>}
          </button>
        );
      })}
      <div className="sec-t">📌 냉장고 메모</div>
      <div className="notes">
        {C.notes.map((n, i) => <div key={n.id} className="note" onClick={() => C.openNote(n)} style={{ background: noteColors[i % 4], transform: `rotate(${n.angle || 0}deg)` }}><button className="x" onClick={e => { e.stopPropagation(); C.deleteNote(n); }} aria-label="메모 떼기"><LIcon name="x" size={16}/></button><div className="tiny muted">{C.getM(n.author_id).name}</div>{n.content}</div>)}
        {!C.notes.length && <p className="small muted">"우유 사 오기" 같은 짧은 쪽지를 붙여 두세요.</p>}
      </div>
      <div className="row gap pad">
        <input className="input grow" placeholder="쪽지 한 줄" value={note} onChange={e => setNote(e.target.value)}/>
        <button className="btn primary sm" disabled={!note.trim()} onClick={async () => { if (await C.addNote(note.trim())) setNote(''); }}>붙이기</button>
      </div>
      <button className="book" onClick={() => C.openBook(year)}>
        <div className="cv">{year}<br/>우리<br/>가족</div>
        <div><b>올해 우리 가족 책</b><span>소식 {yp.length}개 · 사진 {yPhotos}장 · 목소리 {yVoices}개<br/>눌러서 한 권으로 미리 보기 · PDF 저장</span></div>
      </button>
    </>
  );
}

function LetterCompose({ cfg, onClose }) {
  const C = useC(); const open = !!cfg;
  const [to, setTo] = useState(''); const [title, setTitle] = useState(''); const [text, setText] = useState('');
  const [voice, setVoice] = useState(null); const [cap, setCap] = useState(false); const [openOn, setOpenOn] = useState(''); const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => { if (!cfg) return; const first = C.members.find(m => m.id !== C.me); setTo(cfg.to || (first ? first.id : C.me)); setTitle(''); setText(''); setVoice(null); setCap(false); setOpenOn(''); setBusy(false); }, [cfg]);
  const send = async () => {
    if (!text.trim() && !voice) { C.toast('편지 내용을 적거나 목소리를 남겨 주세요'); return; }
    if (cap && !openOn) { C.toast('여는 날을 골라 주세요'); return; }
    setBusy(true);
    try {
      const audio = voice ? await uploadVoice(voice.blob, voice.sec) : null;
      const body = text.trim() || (voice && voice.text) || '';
      const ok = await C.write(() => db.add('letters', { sender_id: C.me, receiver_id: to, title: title.trim() || body.slice(0, 24) || '목소리 편지', content: body, audio_url: audio, open_on: cap ? openOn : null }),
        cap ? `타임캡슐 편지를 잠갔어요 · ${fmtDate(openOn, true)}에 열려요` : '편지를 보냈어요');
      if (ok) onClose(); else setBusy(false);
    } catch (e) { setBusy(false); C.toast('보내지 못했어요: ' + e.message); }
  };
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} full title="편지 쓰기" right={<button className="hdbtn" disabled={busy} onClick={send}>{busy ? <span className="spin dark"/> : '보내기'}</button>}>
      <div className="field"><label>누구에게?</label><div className="chips">{C.members.map(m => <button key={m.id} type="button" className={'chip' + (to === m.id ? ' on' : '')} onClick={() => setTo(m.id)}>{m.emoji} {m.name}{m.id === C.me ? ' (나)' : ''}</button>)}</div></div>
      <div className="field"><label>제목 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 스무 살의 지우에게"/></div>
      <div className="field"><label>편지</label><textarea className="input" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="꾹꾹 눌러 적어 보세요"/><div style={{ marginTop: 8 }}><MicButton dict={dict}/></div></div>
      <div className="field"><label>목소리도 담을까요?</label>
        {voice ? <div className="row gap"><div className="vp"><span className="vp-b"><LIcon name="check" size={16} stroke="#fff"/></span><div className="wave"/><small>{fmtSec(voice.sec)}</small></div><button className="btn sm soft" onClick={() => setVoice(null)}>다시</button></div>
          : <RecordButton label="목소리 편지 녹음" onDone={async r => setVoice(r)}/>}
      </div>
      <CapsulePicker on={cap} setOn={setCap} date={openOn} setDate={setOpenOn} member={C.getM(to)}/>
    </Sheet>
  );
}

function LetterView({ l, onClose }) {
  const C = useC(); const [peek, setPeek] = useState(false);
  useEffect(() => { setPeek(false); if (l && l.receiver_id === C.me && !l.read_at && !isLocked(l)) C.markRead(l); }, [l && l.id]);
  const open = !!l;
  const s = l ? C.getM(l.sender_id) : null, r = l ? C.getM(l.receiver_id) : null;
  const lock = l && isLocked(l) && !peek;
  return (
    <Sheet open={open} onClose={onClose} title="편지" full>
      {l && (lock ? (
        <div className="locked" style={{ margin: 0, padding: '40px 20px' }}>
          <div className="lk"><LIcon name="lock" size={26}/></div>
          <b>{josa(s.name, '이', '가')} {r.name}에게 남긴 타임캡슐</b>
          <p>{fmtDate(l.open_on, true)}에 열려요 · {ddayText(dayDiff(ymd(), l.open_on))}</p>
          <p className="small">{fmtDate(ymd(new Date(l.created_at)), true)}에 잠갔어요</p>
          {l.sender_id === C.me && <button className="btn sm line" style={{ marginTop: 12, background: '#fff' }} onClick={() => setPeek(true)}>내가 쓴 것 · 미리 보기</button>}
        </div>
      ) : (
        <>
          <div className="row gap" style={{ marginBottom: 12 }}>
            <Avatar m={s} size={40}/><div className="grow"><b>{s.name}</b> → {r.name}<div className="small muted">{fmtDate(ymd(new Date(l.created_at)), true)}{l.open_on ? ` · 🎁 ${fmtDate(l.open_on, true)}에 열린 타임캡슐` : ''}</div></div>
            <button className="iconbtn" onClick={() => C.toggleSpeak('l' + l.id, `${josa(s.name, '이', '가')} ${r.name}에게 쓴 편지. ${l.content}`)} aria-label="읽어 주기"><LIcon name={C.speaking === 'l' + l.id ? 'volume-x' : 'volume-2'}/></button>
          </div>
          {l.title && <h3 style={{ margin: '0 0 10px' }}>{l.title}</h3>}
          {l.audio_url && <div style={{ marginBottom: 10 }}><VoicePlayer src={l.audio_url}/></div>}
          {l.content && <div className="letter-paper">{l.content}</div>}
          <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
            {l.receiver_id === C.me && l.sender_id !== C.me && <button className="btn primary block" onClick={() => { onClose(); setTimeout(() => C.openLetterCompose({ to: l.sender_id }), 50); }}><LIcon name="send" size={18}/>답장 쓰기</button>}
            {(l.sender_id === C.me || l.receiver_id === C.me) && <button className="btn soft block danger" onClick={() => C.deleteLetter(l)}><LIcon name="trash-2" size={18}/>편지 지우기</button>}
          </div>
        </>
      ))}
    </Sheet>
  );
}

/* ═══════════ 이번 주 질문 ═══════════ */
/* ═══════════ 이번 주의 질문: 한 사람이 묻고 온 가족이 답한다 ═══════════
   - 식구 순서대로 한 주씩 질문자가 돌아간다 (지난 질문자의 다음 식구)
   - 질문자는 질문 상자에서 고르거나, 글·말로 직접 묻는다. 한마디도 붙일 수 있다
   - 수요일 아침까지 안 정하면 서버가 상자에서 자동으로 고른다
   - 다 같이 공개: 모두 답하거나 토요일 밤 9시가 되면 답이 열린다 (그 전엔 내 답만 보임) */
const nextOf = (order, id) => { const i = order.findIndex(m => m.id === id); return order[(i + 1) % order.length] || order[0]; };
const revealAt = wk => { const d = parseYmd(wk); d.setDate(d.getDate() + 5); d.setHours(21, 0, 0, 0); return d; };   // 토요일 밤 9시
function qState(C, q) {
  const ans = q ? C.answers.filter(a => a.question_id === q.id) : [];
  const done = [...new Set(ans.map(a => a.member_id))];
  const isCur = !!q && q.week_start === weekStart();
  const allDone = C.members.length > 0 && C.members.every(m => done.includes(m.id));
  return { ans, done, isCur, picking: !!q && !q.text, allDone, revealed: !isCur || allDone || Date.now() >= revealAt(q.week_start) };
}

/* 이번 주 질문 카드. inline=질문 창 안 (버튼 없음) */
function QHero({ q, onOpen, inline }) {
  const C = useC(); const S = qState(C, q); const asker = C.getM(q.asker_id); const iAsk = q.asker_id === C.me;
  const mine = S.done.includes(C.me);
  const left = dayDiff(ymd(), ymd(revealAt(q.week_start)));   // 공개일(토요일)까지 남은 날
  const status = S.picking ? '수요일 아침까지 안 정하면 자동으로 골라요'
    : S.allDone ? '모두 답했어요! 답이 열렸어요 🎁'
    : !S.isCur || S.revealed ? `답 ${S.done.length}개 · 답이 열렸어요 🎁`
    : `답 ${S.done.length}/${C.members.length} · ${left <= 0 ? '오늘' : left === 1 ? '내일' : '토요일'} 밤 9시에 다 같이 공개`;
  const cta = S.picking ? (iAsk ? ['질문 정하기 →', ''] : ['순서 보기', 'done']) : S.revealed ? ['답 보러 가기 🎁', ''] : mine ? ['내 답 남김 ✓', 'done'] : ['답하기 →', ''];
  const Tag = inline ? 'div' : 'button';
  return (
    <Tag className={'qhero' + (inline ? ' inline' : '')} onClick={inline ? undefined : onOpen}>
      <div className="qh-top"><span className="pill">{S.isCur ? '이번 주 질문' : `${fmtDate(q.week_start)} 주 질문`} ❓</span>{q.auto && !S.picking && <span className="pill">자동으로 골랐어요</span>}</div>
      {S.picking
        ? <div className="qh-q wait">{iAsk ? '이번 주는 내가 온 가족에게 질문할 차례예요 🎤' : `${josa(asker.name, '이', '가')} 온 가족에게 물어볼 질문을 고르는 중이에요 🤔`}</div>
        : <div className="qh-q">{q.text}</div>}
      {!S.picking && q.note && <div className="qh-note">💬 “{q.note}”</div>}
      {!S.picking && q.audio_url && inline && <div style={{ position: 'relative', marginBottom: 10 }}><VoicePlayer src={q.audio_url}/></div>}
      {!q.asker_id ? <div className="qh-by" style={{ paddingLeft: 12 }}><span>예전 방식 질문</span></div> : <div className="qh-by"><Avatar m={asker} size={26}/><span><b>{asker.name}</b>{S.picking ? ' 차례 🎤' : josa(asker.name, '이', '가').slice(asker.name.length) + ' 물어요'}{q.audio_url && !inline ? ' · 🎙' : ''}</span></div>}
      <div className="qh-ft">
        <span className="qh-faces">{C.members.map(m => <span key={m.id} style={{ opacity: S.done.includes(m.id) ? 1 : .35 }}><Avatar m={m} size={24}/></span>)}</span>
        <span className="qh-st">{status}</span>
        {!inline && <span className={'qh-cta ' + cta[1]}>{cta[0]}</span>}
        {inline && !S.picking && <button className="qh-cta done" onClick={e => { e.stopPropagation(); C.toggleSpeak('q' + q.id, `${asker.name}의 질문. ${q.text}`); }}><LIcon name="volume-2" size={16}/>읽어 주기</button>}
      </div>
    </Tag>
  );
}

/* 순서표: 지난주 · 이번 주 · 다음 주들 */
function QTurns({ cur, onOrder }) {
  const C = useC(); const order = C.members;
  const past = C.questions.filter(q => q.week_start < cur.week_start && q.asker_id && q.asker_id !== cur.asker_id).sort((a, b) => a.week_start.localeCompare(b.week_start)).slice(-1);
  const items = past.map(q => ({ m: C.getM(q.asker_id), wk: q.week_start, tag: '✓', cls: 'done' }));
  items.push({ m: C.getM(cur.asker_id), wk: cur.week_start, tag: '🎤', cls: 'now' });
  let id = cur.asker_id;
  for (let i = 1; i <= Math.min(6, Math.max(1, order.length - 1)); i++) { const n = nextOf(order, id); id = n && n.id; if (!n) break; items.push({ m: n, wk: ymd(addDays(parseYmd(cur.week_start), 7 * i)), cls: '' }); }
  const label = (wk, cls) => cls === 'now' ? '이번 주' : wk === ymd(addDays(parseYmd(cur.week_start), 7)) ? '다음 주' : wk === ymd(addDays(parseYmd(cur.week_start), -7)) ? '지난주' : fmtDot(wk).slice(5);
  return (
    <div className="turns">
      <div className="turns-hd"><b>질문 순서</b><button className="linkbtn" style={{ minHeight: 0, padding: 0 }} onClick={onOrder}>순서 바꾸기</button></div>
      <div className="turns-row">
        {items.map((x, i) => (
          <React.Fragment key={x.wk}>
            {i > 0 && <span className="turns-ar">›</span>}
            <div className={'turn ' + x.cls}><Avatar m={x.m} size={38}/><b>{x.m.name}{x.tag && <> {x.tag}</>}</b><span>{label(x.wk, x.cls)}</span></div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* 질문 순서 바꾸기 (= 식구 순서) */
function TurnOrder({ open, onClose }) {
  const C = useC(); const [list, setList] = useState([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setList(C.members.map(m => m.id)); }, [open]);
  const move = (i, d) => setList(l => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = async () => { setBusy(true); const ok = await C.write(() => Promise.all(list.map((id, i) => db.patch('members', id, { sort: i + 1 }))), '질문 순서를 바꿨어요'); setBusy(false); if (ok) onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="질문 순서" right={<button className="hdbtn" disabled={busy} onClick={save}>저장</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>위에서부터 차례로 한 주씩 질문해요. 이 순서는 식구 목록·스토리 순서와 같아요.</p>
      {list.map((id, i) => { const m = C.getM(id); return (
        <div key={id} className="row gap" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <b style={{ width: 22, color: 'var(--sub)' }}>{i + 1}</b><Avatar m={m} size={38}/><b className="grow">{m.name}</b>
          <button className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로"><LIcon name="chevron-up"/></button>
          <button className="iconbtn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="아래로"><LIcon name="chevron-down"/></button>
        </div>); })}
    </Sheet>
  );
}

/* 질문자가 질문 정하기: 상자에서 고르기 / 글·말로 쓰기 + 한마디 */
function QPicker({ cur, onDone }) {
  const C = useC();
  const [mode, setMode] = useState('box'); const [text, setText] = useState(cur.text || ''); const [note, setNote] = useState(cur.note || '');
  const [voice, setVoice] = useState(cur.audio_url || null); const [more, setMore] = useState(false); const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t))); const dictN = useDictation(t => setNote(s => joinText(s, t)));
  const used = new Set(C.questions.filter(q => q.id !== cur.id).map(q => q.text));
  const pool = C.bank.filter(b => !used.has(b.text)).sort((a, b) => (b.added_by ? 1 : 0) - (a.added_by ? 1 : 0));
  const shown = more ? pool : pool.slice(0, 8);
  const submit = async () => {
    if (!text.trim()) { C.toast('질문을 고르거나 적어 주세요'); return; }
    setBusy(true);
    const ok = await C.write(() => db.patch('questions', cur.id, { text: text.trim(), note: note.trim() || null, audio_url: mode === 'write' ? voice : null, auto: false, picked_at: new Date().toISOString() }), '온 가족에게 질문을 냈어요 🎤');
    setBusy(false); if (ok && onDone) onDone();
  };
  return (
    <div className="qpick">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'box' ? 'on' : ''} onClick={() => setMode('box')}>📦 질문 상자에서</button>
        <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')}>✍️ 직접 쓰기·말하기</button>
      </div>
      {mode === 'box' && <>
        <button className="btn sm soft" style={{ marginBottom: 8 }} onClick={() => { const p = pool[Math.floor(Math.random() * pool.length)]; if (p) setText(p.text); }}>🎲 아무거나 하나 골라 줘</button>
        <div className="qlist">
          {shown.map(b => (
            <button key={b.id} className={'qitem' + (text === b.text ? ' on' : '')} onClick={() => setText(b.text)}>
              <span>{b.text}</span>{b.added_by && <small>{josa(C.getM(b.added_by).name, "이", "가")} 넣은 질문</small>}
            </button>
          ))}
          {!pool.length && <p className="small muted">상자가 비었어요. 직접 써 주세요.</p>}
        </div>
        {pool.length > 8 && <button className="linkbtn" onClick={() => setMore(m => !m)}>{more ? '접기' : `질문 ${pool.length - 8}개 더 보기`}</button>}
      </>}
      {mode === 'write' && <>
        <textarea className="input" rows={3} placeholder="온 가족에게 묻고 싶은 것을 적어 보세요" value={text} onChange={e => setText(e.target.value)}/>
        <div className="row gap" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <MicButton dict={dict}/>
        </div>
        <div style={{ marginTop: 10 }}>
          {voice ? <div className="row gap"><VoicePlayer src={voice}/><button className="btn sm soft" onClick={() => setVoice(null)}>목소리 빼기</button></div>
            : <RecordButton block label="🎤 내 목소리로 질문 남기기" onDone={async r => { const url = await uploadVoice(r.blob, r.sec); setVoice(url); if (!text.trim() && r.text) setText(r.text); }}/>}
          <p className="small muted" style={{ margin: '6px 2px 0' }}>목소리를 남기면 식구들이 내 목소리로 질문을 들어요.</p>
        </div>
      </>}
      <div className="field" style={{ margin: '14px 0 10px' }}>
        <label>💬 질문자의 한마디 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
        <input className="input" placeholder="예: 어제 옛날 사진 보다가 궁금해졌어요" value={note} onChange={e => setNote(e.target.value)}/>
        <div style={{ marginTop: 8 }}><MicButton dict={dictN}/></div>
      </div>
      {text.trim() && <div className="qpreview">“{text.trim()}”</div>}
      <button className="btn primary block" disabled={busy || !text.trim()} onClick={submit}>{busy ? <span className="spin"/> : <LIcon name="send" size={18}/>}이 질문을 온 가족에게 내기</button>
    </div>
  );
}

/* 우리 가족 질문 상자: 언젠가 물어보고 싶은 질문 넣어 두기 */
function QBox() {
  const C = useC(); const [t, setT] = useState(''); const [open, setOpen] = useState(false);
  const dict = useDictation(x => setT(s => joinText(s, x)));
  const used = new Set(C.questions.map(q => q.text));
  const left = C.bank.filter(b => !used.has(b.text));
  const mine = C.bank.filter(b => b.added_by).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const add = async () => { const v = t.trim(); if (!v) return; if (C.bank.some(b => b.text === v)) { C.toast('이미 상자에 있는 질문이에요'); return; } if (await C.write(() => db.add('question_bank', { text: v, added_by: C.me }), '질문 상자에 넣었어요 📦')) setT(''); };
  return (
    <div className="qbox">
      <button className="sec-t" style={{ width: '100%', padding: '18px 0 6px' }} onClick={() => setOpen(o => !o)}>
        <span>📦 우리 가족 질문 상자 <span className="small muted" style={{ fontWeight: 400 }}>· 남은 질문 {left.length}개</span></span><LIcon name={open ? 'chevron-up' : 'chevron-down'} size={20}/>
      </button>
      <p className="small muted" style={{ margin: '0 0 8px' }}>언젠가 온 가족에게 묻고 싶은 질문을 넣어 두세요. 질문자가 고를 때 맨 위에 보이고, 아무도 안 고르면 이것부터 자동으로 나와요.</p>
      <div className="row gap">
        <input className="input grow" placeholder="예: 할머니가 처음 받은 선물은?" value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }}/>
        <button className="iconbtn" style={{ background: dict.on ? 'var(--accent)' : '#f0f0f0', color: dict.on ? '#fff' : 'inherit' }} onClick={dict.toggle} aria-label="말로 쓰기"><LIcon name="mic"/></button>
        <button className="btn sm blue" disabled={!t.trim()} onClick={add}>넣기</button>
      </div>
      {open && <div style={{ marginTop: 10 }}>
        {!mine.length && <p className="small muted">아직 식구가 넣은 질문이 없어요. 기본 질문 {C.bank.length}개가 들어 있어요.</p>}
        {mine.map(b => (
          <div key={b.id} className="row gap" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <Avatar m={C.getM(b.added_by)} size={28}/><span className="grow" style={{ fontSize: '.95rem' }}>{b.text}{used.has(b.text) && <span className="small muted"> · 이미 나왔어요</span>}</span>
            {b.added_by === C.me && !used.has(b.text) && <button className="linkbtn" style={{ minHeight: 0 }} onClick={() => C.write(() => db.del('question_bank', `id=eq.${b.id}`), '상자에서 뺐어요')}>빼기</button>}
          </div>
        ))}
      </div>}
    </div>
  );
}

function QuestionSheet({ q, onClose }) {
  const C = useC(); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [view, setView] = useState(null);
  const [editing, setEditing] = useState(false); const [orderOpen, setOrderOpen] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => { setView(q); setText(''); setEditing(false); }, [q]);
  const cur = view ? (C.questions.find(x => x.id === view.id) || view) : null;
  const S = cur ? qState(C, cur) : null;
  const asker = cur ? C.getM(cur.asker_id) : null;
  const iAsk = cur && cur.asker_id === C.me;
  const past = C.questions.filter(x => !cur || x.id !== cur.id).filter(x => x.text);
  const answer = async row => { setBusy(true); const ok = await C.write(() => db.add('answers', { question_id: cur.id, member_id: C.me, ...row }), '답을 남겼어요'); setBusy(false); return ok; };
  const showPicker = cur && S.isCur && iAsk && (S.picking || editing);
  const shownAns = cur ? (S.revealed ? S.ans : S.ans.filter(a => a.member_id === C.me)) : [];
  const passTo = cur && C.members.length > 1 ? nextOf(C.members, cur.asker_id) : null;
  return (
    <Sheet open={!!q} onClose={onClose} full title="이번 주의 질문"
      footer={cur && !S.picking && !showPicker && (
        <div style={{ display: 'grid', gap: 8 }}>
          <RecordButton block label="목소리로 답하기" onDone={async r => { const url = await uploadVoice(r.blob, r.sec); await answer({ audio_url: url, content: r.text || '' }); }}/>
          <div className="row gap">
            <input className="input grow" placeholder="글로 답하기…" value={text} onChange={e => setText(e.target.value)}/>
            <button className="iconbtn" style={{ background: dict.on ? 'var(--accent)' : '#f0f0f0', color: dict.on ? '#fff' : 'inherit' }} onClick={dict.toggle} aria-label="말로 쓰기"><LIcon name="mic"/></button>
            <button className="btn blue sm" disabled={!text.trim() || busy} onClick={async () => { if (await answer({ content: text.trim() })) setText(''); }}>올리기</button>
          </div>
        </div>
      )}>
      {cur && (
        <>
          {S.isCur && <QTurns cur={cur} onOrder={() => setOrderOpen(true)}/>}
          <QHero q={cur} inline/>

          {showPicker && <QPicker key={cur.id + (editing ? 'e' : '')} cur={cur} onDone={() => setEditing(false)}/>}
          {S.isCur && iAsk && S.picking && passTo && passTo.id !== C.me && (
            <button className="linkbtn" onClick={() => { if (window.confirm(`이번 주 질문 차례를 ${passTo.name}에게 넘길까요?\n그다음 차례도 한 칸씩 밀려요.`)) C.write(() => db.patch('questions', cur.id, { asker_id: passTo.id }), `${passTo.name}에게 차례를 넘겼어요`); }}>⏭ 이번 주는 {passTo.name}에게 넘기기</button>
          )}
          {S.isCur && iAsk && !S.picking && !editing && !S.ans.length && <button className="linkbtn" onClick={() => setEditing(true)}>✏️ 질문 다시 고르기</button>}
          {editing && <button className="linkbtn" onClick={() => setEditing(false)}>고치기 그만두기</button>}

          {!S.picking && (
            <div className="qans">
              <div className="row gap" style={{ marginBottom: 6 }}>
                <b className="grow">답 {S.done.length}/{C.members.length}</b>
                <span className="faces">{C.members.map(m => <span key={m.id} style={{ opacity: S.done.includes(m.id) ? 1 : .3 }}><Avatar m={m} size={26}/></span>)}</span>
              </div>
              {!S.revealed && <div className="qlock">🎁 다 같이 공개 · 모두 답하거나 <b>토요일 밤 9시</b>가 되면 한꺼번에 열려요.{S.done.includes(C.me) ? ' 내 답만 먼저 보여요.' : ' 내 답을 남겨 보세요.'}</div>}
              {S.revealed && !S.ans.length && <p className="empty" style={{ padding: 20 }}>아직 답이 없어요. 아래에서 말로 답해 보세요.</p>}
              {shownAns.map(a => (
                <div className="cmt" key={a.id}>
                  <Avatar m={C.getM(a.member_id)} size={32}/>
                  <div className="body"><b>{C.getM(a.member_id).name}</b>{a.audio_url ? <><VoicePlayer src={a.audio_url}/>{a.content && <div className="small" style={{ color: '#5b4a86' }}>“{a.content}”</div>}</> : <div>{a.content}</div>}
                    <div className="meta"><span>{relTime(a.created_at)}</span>{a.member_id === C.me && <button onClick={() => C.write(() => db.del('answers', `id=eq.${a.id}`), '답을 지웠어요')}>지우기</button>}</div></div>
                </div>
              ))}
            </div>
          )}

          <QBox/>
          {past.length > 0 && <>
            <div className="sec-t" style={{ padding: '18px 0 6px' }}>지난 질문들</div>
            {past.map(x => { const n = C.answers.filter(a => a.question_id === x.id).length; const am = C.getM(x.asker_id); return (
              <button key={x.id} className="lt" style={{ padding: '10px 0' }} onClick={() => { setView(x); setEditing(false); }}>
                {x.asker_id ? <Avatar m={am} size={36}/> : <div className="bic" style={{ width: 36, height: 36, background: '#F3EEFF', color: '#6a3fc8', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>❓</div>}<div className="grow"><b style={{ fontSize: '.95rem' }}>{x.text}</b><span>{fmtDate(x.week_start)} 주 · {x.asker_id ? `${am.name}의 질문` : '예전 방식 질문'} · 답 {n}개</span></div>
              </button>); })}
          </>}
        </>
      )}
      <TurnOrder open={orderOpen} onClose={() => setOrderOpen(false)}/>
    </Sheet>
  );
}

/* ═══════════ 함께 기도해요 ═══════════
   - 기도 제목(request): 글·말·목소리로 나누고, 누구를 위한 기도인지·그날(시험날 등)을 정한다
   - 목소리 기도(prayer): 식구를 위해 드린 기도를 목소리 그대로 남긴다
   - 🙏 기도했어요: 하루 한 번씩 쌓인다 (prayer_marks) · ✨ 응답됐어요: 감사 한 줄과 함께 응답 노트로
   - 그날 아침 8시엔 서버가 온 가족에게 "오늘 함께 기도해요" 알림 */
const prayFor = (C, p) => p.for_member ? C.getM(p.for_member).name : (p.for_text || '');
function PrayCard({ p, focus, feed }) {
  const C = useC(); const a = C.getM(p.author_id); const [menu, setMenu] = useState(false); const [ans, setAns] = useState(false); const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (focus && ref.current) setTimeout(() => ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); }, [focus]);
  useViewed(ref, p.id, 'pray', p.author_id);
  const marks = C.pmarks.filter(m => m.prayer_id === p.id);
  const who = [...new Set(marks.map(m => m.member_id))];
  const today = ymd(); const todayWho = [...new Set(marks.filter(m => m.day === today).map(m => m.member_id))];
  const iDid = todayWho.includes(C.me);
  const fw = prayFor(C, p); const due = p.due_on ? dayDiff(today, p.due_on) : null;
  const mine = p.author_id === C.me; const voice = p.kind === 'prayer';
  return (
    <article ref={ref} className={'pray' + (focus ? ' focus' : '') + (p.answered_at ? ' done' : '')}>
      {feed && <button className="feed-band pr" onClick={() => C.openPray(p.id)}><span className="ph-row"><PrayHands size={20}/>함께 기도해요</span><span className="go">기도 탭 <LIcon name="chevron-right" size={16}/></span></button>}
      <div className="pray-hd">
        <Avatar m={a} size={38} onClick={() => C.openProfile(a.id)}/>
        <div className="grow">
          <div><b>{a.name}</b>{voice ? '의 목소리 기도 🎙' : '의 기도 제목'}</div>
          <div className="pray-tags">
            <span>{relTime(p.created_at)}</span>
            <span className="tag ph-row"><PrayHands size={15}/>{fw ? `${josa(fw, '을', '를')} 위해` : '온 가족을 위해'}</span>
            {p.due_on && !p.answered_at && <span className={'tag' + (due === 0 ? ' today' : '')}>📅 {due === 0 ? '오늘!' : due > 0 ? `${fmtDate(p.due_on)} · D-${due}` : fmtDate(p.due_on)}</span>}
          </div>
        </div>
        {mine && <button className="iconbtn" onClick={() => setMenu(true)} aria-label="더 보기"><LIcon name="ellipsis"/></button>}
      </div>
      {p.content && <div className="pray-text">{p.content}</div>}
      {p.audio_url && <div style={{ padding: '0 16px 8px' }}><VoicePlayer src={p.audio_url}/></div>}
      {p.answered_at && <div className="pray-ans">✨ <b>응답됐어요</b> · {fmtDate(ymd(new Date(p.answered_at)), true)}{p.answer_note && <div>“{p.answer_note}”</div>}</div>}
      <div className="pray-ft">
        <span className="qh-faces">{who.slice(0, 6).map(id => <span key={id}><Avatar m={C.getM(id)} size={24}/></span>)}</span>
        <span className="grow small muted">{marks.length ? `${marks.length}번 함께 기도했어요${todayWho.length ? ` · 오늘 ${todayWho.map(id => C.getM(id).name).join(', ')}` : ''}` : '아직 아무도 기도하지 않았어요'}</span>
        {!p.answered_at && <button className={'pray-btn' + (iDid ? ' on' : '')} onClick={() => C.togglePray(p)}>{iDid ? '오늘 기도했어요 ✓' : <span className="ph-row"><PrayHands size={20}/>{voice ? '아멘' : '기도했어요'}</span>}</button>}
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title={voice ? '목소리 기도' : '기도 제목'}>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="btn soft block" onClick={() => { setMenu(false); setEditing(true); }}><LIcon name="pencil" size={18}/>글 고치기</button>
          {!voice && !p.answered_at && <button className="btn soft block" onClick={() => { setMenu(false); setAns(true); }}>✨ 응답됐어요 (감사 나누기)</button>}
          {p.answered_at && <button className="btn soft block" onClick={() => { setMenu(false); C.write(() => db.patch('prayers', p.id, { answered_at: null, answer_note: null }), '다시 기도 중으로 옮겼어요'); }}>다시 기도 중으로 옮기기</button>}
          <button className="btn soft block danger" onClick={() => { setMenu(false); if (window.confirm('이 기도를 지울까요?')) { C.write(() => db.del('prayers', `id=eq.${p.id}`), '지웠어요'); const id = driveId(p.audio_url); if (id) gw('delete', { id }).catch(() => {}); } }}><LIcon name="trash-2" size={18}/>지우기</button>
        </div>
      </Sheet>
      <PrayAnswer p={ans ? p : null} onClose={() => setAns(false)}/>
      <PrayCompose open={editing} edit={p} onClose={() => setEditing(false)}/>
    </article>
  );
}

/* ✨ 응답됐어요: 감사 한 줄 */
function PrayAnswer({ p, onClose }) {
  const C = useC(); const [t, setT] = useState(''); const dict = useDictation(x => setT(s => joinText(s, x)));
  useEffect(() => { if (p) setT(''); }, [p]);
  const save = async () => { if (await C.write(() => db.patch('prayers', p.id, { answered_at: new Date().toISOString(), answer_note: t.trim() || null }), '응답 노트에 담았어요 ✨')) onClose(); };
  return (
    <Sheet open={!!p} onClose={onClose} title="✨ 응답됐어요" right={<button className="hdbtn" onClick={save}>저장</button>}>
      {p && <>
        <p className="small muted" style={{ marginTop: 0 }}>“{p.content || '목소리 기도'}”</p>
        <div className="field"><label>감사 한 줄 <span className="muted" style={{ fontWeight: 400 }}>(선택)</span></label>
          <textarea className="input" rows={3} placeholder="예: 수술 잘 끝났어요. 함께 기도해 줘서 고마워요" value={t} onChange={e => setT(e.target.value)}/>
          <div style={{ marginTop: 8 }}><MicButton dict={dict}/></div></div>
        <p className="small muted">응답 노트에 차곡차곡 쌓이고, 연말 가족 책에도 실려요. 온 가족에게 알림이 가요.</p>
      </>}
    </Sheet>
  );
}

/* 기도 나누기 (기도 제목 / 목소리 기도) */
function PrayCompose({ open, onClose, edit }) {
  const C = useC();
  const [kind, setKind] = useState('request'); const [text, setText] = useState(''); const [voice, setVoice] = useState(null);
  const [keep, setKeep] = useState(null);   // 고칠 때: 이미 남긴 목소리 (빼면 null)
  const [forWho, setForWho] = useState(''); const [other, setOther] = useState(''); const [due, setDue] = useState(''); const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => {
    if (!open) return;
    const e = edit;
    setKind(e ? e.kind : 'request'); setText(e ? e.content || '' : ''); setVoice(null); setKeep(e ? e.audio_url || null : null);
    setForWho(e ? (e.for_member || (e.for_text ? 'other' : '')) : ''); setOther(e ? e.for_text || '' : ''); setDue(e ? e.due_on || '' : ''); setBusy(false);
  }, [open]);
  const can = !busy && (kind === 'prayer' ? !!(voice || keep) : !!(text.trim() || voice || keep));
  const submit = async () => {
    setBusy(true);
    try {
      const audio = voice ? await uploadVoice(voice.blob, voice.sec) : keep;
      const row = { kind, content: text.trim() || (kind === 'prayer' && voice && voice.text ? voice.text : ''), audio_url: audio,
        for_member: forWho && forWho !== 'other' ? forWho : null, for_text: forWho === 'other' ? (other.trim() || null) : null, due_on: kind === 'request' && due ? due : null };
      if (edit) {   // 고치기: 바뀐 목소리면 옛 녹음은 드라이브에서 지운다
        const ok = await C.write(() => db.patch('prayers', edit.id, row), '기도를 고쳤어요');
        if (ok) { if (edit.audio_url && edit.audio_url !== audio) { const id = driveId(edit.audio_url); if (id) gw('delete', { id }).catch(() => {}); } onClose(); } else setBusy(false);
        return;
      }
      if (await C.write(() => db.add('prayers', { ...row, author_id: C.me }), kind === 'prayer' ? '목소리 기도를 남겼어요 🎙' : '기도 제목을 나눴어요 🙏')) onClose(); else setBusy(false);
    } catch (e) { setBusy(false); C.toast('올리지 못했어요: ' + e.message); }
  };
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} full title={edit ? '기도 고치기' : '기도 나누기'} right={<button className="hdbtn" disabled={!can} onClick={submit}>{busy ? <span className="spin dark"/> : edit ? '저장' : '올리기'}</button>}>
      {!edit && <div className="seg" style={{ marginBottom: 16 }}>
        <button className={kind === 'request' ? 'on' : ''} onClick={() => setKind('request')}><span className="ph-row"><PrayHands size={20}/>기도 제목 나누기</span></button>
        <button className={kind === 'prayer' ? 'on' : ''} onClick={() => setKind('prayer')}>🎙 목소리 기도 남기기</button>
      </div>}
      {kind === 'request' ? (
        <div className="field">
          <label>어떤 기도가 필요하세요?</label>
          <textarea className="input" rows={4} placeholder="예: 지온이 수학 시험 잘 보게 / 할머니 무릎 수술 잘 되게" value={text} onChange={e => setText(e.target.value)}/>
          <div style={{ marginTop: 8 }}><MicButton dict={dict}/></div>
          <div style={{ marginTop: 10 }}>
            {voice ? <div className="row gap"><div className="vp"><span className="vp-b"><LIcon name="check" size={16} stroke="#fff"/></span><div className="wave"/><small>{fmtSec(voice.sec)}</small></div><button className="btn sm soft" onClick={() => setVoice(null)}>목소리 빼기</button></div>
              : keep ? <div className="row gap"><VoicePlayer src={keep}/><button className="btn sm soft" onClick={() => setKeep(null)}>목소리 빼기</button></div>
              : <RecordButton label="목소리로도 남기기 (선택)" onDone={async r => { setVoice(r); if (!text.trim() && r.text) setText(r.text); }}/>}
          </div>
        </div>
      ) : (
        <div className="field">
          <label>식구를 위해 드리는 기도를 목소리로 남겨요</label>
          <p className="small muted" style={{ margin: '0 0 8px' }}>할머니·할아버지의 기도는 오래오래 들을 수 있는 보물이 돼요. 내 프로필의 <b>목소리</b>에도 모여요.</p>
          {voice ? <div className="row gap"><div className="vp"><span className="vp-b"><LIcon name="check" size={16} stroke="#fff"/></span><div className="wave"/><small>{fmtSec(voice.sec)}</small></div><button className="btn sm soft" onClick={() => setVoice(null)}>다시 녹음</button></div>
            : keep ? <div className="row gap"><VoicePlayer src={keep}/><button className="btn sm soft" onClick={() => setKeep(null)}>다시 녹음</button></div>
            : <RecordButton block label="🎙 기도 녹음하기" onDone={async r => { setVoice(r); }}/>}
          <input className="input" style={{ marginTop: 10 }} placeholder="한 줄 (선택) 예: 손주들을 위한 아침 기도" value={text} onChange={e => setText(e.target.value)}/>
        </div>
      )}
      <div className="field">
        <label>누구를 위한 기도인가요?</label>
        <div className="chips">
          <button type="button" className={'chip' + (!forWho ? ' on' : '')} onClick={() => setForWho('')}>👨‍👩‍👧‍👦 온 가족</button>
          {C.members.map(m => <button type="button" key={m.id} className={'chip' + (forWho === m.id ? ' on' : '')} onClick={() => setForWho(m.id)}>{m.emoji} {m.name}{m.id === C.me ? ' (나)' : ''}</button>)}
          <button type="button" className={'chip' + (forWho === 'other' ? ' on' : '')} onClick={() => setForWho('other')}>다른 사람</button>
        </div>
        {forWho === 'other' && <input className="input" style={{ marginTop: 8 }} placeholder="예: 외삼촌, 교회 집사님" value={other} onChange={e => setOther(e.target.value)}/>}
      </div>
      {kind === 'request' && (
        <div className="field">
          <label>그날이 있나요? <span className="muted" style={{ fontWeight: 400 }}>(선택 · 시험날, 수술날, 면접날)</span></label>
          <input type="date" className="input" min={ymd()} value={due} onChange={e => setDue(e.target.value)}/>
          {due && <p className="small muted" style={{ margin: '6px 2px 0' }}>{due === ymd() && new Date().getHours() >= 8 ? '오늘 아침 알림 시간(8시)은 지났어요. 기도 탭에서는 "오늘!"로 맨 위에 보여요.' : `${fmtDate(due, true)} 아침 8시에 온 가족에게 "오늘 함께 기도해요 🙏" 알림이 가요.`}</p>}
        </div>
      )}
    </Sheet>
  );
}

function PrayTab() {
  const C = useC(); const [view, setView] = useState('now'); const [compose, setCompose] = useState(false);
  const all = C.prayers;
  const now = all.filter(p => !p.answered_at); const done = all.filter(p => p.answered_at).sort((a, b) => b.answered_at.localeCompare(a.answered_at));
  const today = ymd();
  const todays = now.filter(p => p.due_on === today);
  const list = view === 'now' ? [...todays, ...now.filter(p => p.due_on !== today)] : done;
  const prayedToday = [...new Set(C.pmarks.filter(m => m.day === today).map(m => m.member_id))];
  useEffect(() => { if (C.prayFocus) { const p = all.find(x => x.id === C.prayFocus); if (p) setView(p.answered_at ? 'done' : 'now'); } }, [C.prayFocus]);
  return (
    <>
      <div className="topbar">
        <span className="h1 ph-row">함께 기도해요 <PrayHands size={34}/></span>
        <button className="iconbtn" onClick={() => setCompose(true)} aria-label="기도 나누기"><LIcon name="square-pen" size={26}/></button>
      </div>
      <div className="pray-hero">
        <b>기도 제목을 나누고, 서로를 위해 기도해요</b>
        <span>{prayedToday.length ? `오늘 ${prayedToday.map(id => C.getM(id).name).join(', ')}${josa(C.getM(prayedToday[prayedToday.length - 1]).name, '이', '가').slice(-1)} 함께 기도했어요` : '오늘 첫 번째로 기도해 보세요'}</span>
        <button className="btn sm primary" onClick={() => setCompose(true)}><LIcon name="hand-heart" size={18}/>기도 나누기</button>
      </div>
      <div className="pad" style={{ margin: '2px 0 10px' }}>
        <div className="seg">
          <button className={view === 'now' ? 'on' : ''} onClick={() => setView('now')}><span className="ph-row"><PrayHands size={22}/>기도 중 {now.length}</span></button>
          <button className={view === 'done' ? 'on' : ''} onClick={() => setView('done')}>✨ 응답 노트 {done.length}</button>
        </div>
      </div>
      {!list.length && <div className="empty">{view === 'now' ? <>아직 기도 제목이 없어요.<br/><span className="small">위의 <b>기도 나누기</b>로 첫 기도 제목을 올려 보세요.</span></> : <>아직 응답 노트가 없어요.<br/><span className="small">기도가 이루어지면 그 기도 제목의 ••• → <b>응답됐어요</b>를 눌러 감사를 나눠요.</span></>}</div>}
      {list.map(p => <PrayCard key={p.id} p={p} focus={C.prayFocus === p.id}/>)}
      <PrayCompose open={compose} onClose={() => setCompose(false)}/>
    </>
  );
}

/* ═══════════ 알림 (맨 위 ❤ 로 여는 창) ═══════════ */
function NotiPage({ open, onClose }) {
  useLayer(open, onClose);
  if (!open) return null;
  return <div className="page" style={{ background: 'var(--bg)' }}><NotiTab onBack={onClose}/></div>;
}
function NotiTab({ onBack }) {
  const C = useC();
  const fresh = C.activity.filter(x => x.isNew); const old = C.activity.filter(x => !x.isNew);
  const row = x => (
    <div key={x.key} className="ltw" style={x.isNew ? { background: '#FFF7F3' } : undefined}>
      <button className="lt" onClick={x.go}>
        <Avatar m={C.getM(x.who)} size={46}/>
        <div className="grow"><b style={{ fontSize: '.98rem', whiteSpace: 'normal' }}>{x.text}</b><span>{relTime(x.t)}</span></div>
        {x.thumb && <img src={x.thumb} alt="" style={{ width: 50, height: 50, borderRadius: 10, objectFit: 'cover' }}/>}
      </button>
      <button className="ltx" onClick={() => C.hideNoti(x.key)} aria-label="이 알림 지우기"><LIcon name="x" size={18}/></button>
    </div>
  );
  const soon = C.members.map(m => ({ m, d: C.bdayDays(m.id) })).filter(x => x.d !== null && x.d <= 14).sort((x, y) => x.d - y.d);
  return (
    <>
      <div className="topbar" style={{ paddingLeft: 4 }}><div className="row">{onBack && <button className="iconbtn" onClick={onBack} aria-label="뒤로"><LIcon name="chevron-left" size={28}/></button>}<span className="h1">알림</span></div>{C.activity.length > 0 && <button className="btn sm soft" onClick={() => { if (window.confirm('알림을 모두 지울까요? (이 폰에서만 지워져요)')) { C.clearNoti(); C.toast('알림을 모두 지웠어요'); } }}><LIcon name="trash-2" size={16}/>모두 지우기</button>}</div>
      <div className="sheetcard">
        {soon.map(({ m, d }) => (
          <button key={m.id} className="lt" onClick={() => C.openProfile(m.id)}>
            <Avatar m={m} size={46} ring="bday"/>
            <div className="grow"><b>🎂 {m.name} 생일 {d === 0 ? '오늘이에요!' : `${d}일 남았어요`}</b><span>눌러서 축하 편지 쓰기·사진 보기</span></div>
          </button>
        ))}
        {fresh.length > 0 && <div className="sec-t">새로 온 소식</div>}
        {fresh.map(row)}
        {old.length > 0 && <div className="sec-t">지난 2주</div>}
        {old.map(row)}
        {!C.activity.length && !soon.length && <div className="empty">아직 알림이 없어요.<br/><span className="small">식구가 소식·댓글·편지를 남기면 여기 모여요.</span></div>}
      </div>
    </>
  );
}

/* ═══════════ 관리자 · 가족 포인트 (관리자 폰에서만) ═══════════ */
/* 방문: 앱을 열 때·10분 넘게 쉬었다 다시 볼 때 한 번 (점수는 하루 1번만) */
const logVisit = member => {
  if (!member || !familyKey) return;
  const t = Date.now(), key = `${member}|${ymd()}`;
  if (store.get('fz_vis_k') === key && t - +(store.get('fz_vis_t') || 0) < 10 * 60e3) return;
  db.rpc('log_visit', { p_member: member }).then(() => { store.set('fz_vis_k', key); store.set('fz_vis_t', String(t)); }).catch(() => {});   // 적힌 뒤에만 "적었음" (PIN 전 실패는 다음에 다시)
};
/* 조회: 남의 소식·기도가 화면에 1초 넘게 보이면 한 번 (같은 건 다시 안 셈) */
const viewed = new Set((() => { try { return JSON.parse(store.get('fz_viewed') || '[]'); } catch (e) { return []; } })());
const markViewed = (me, id, kind) => {
  const k = me + ':' + id; if (viewed.has(k)) return;
  viewed.add(k); store.set('fz_viewed', JSON.stringify([...viewed].slice(-3000)));
  db.addOnce('views', { item_id: id, member_id: me, kind }, 'item_id,member_id').catch(() => viewed.delete(k));
};
function useViewed(ref, id, kind, author) {
  const C = useC();
  useEffect(() => {
    const el = ref.current;
    if (!el || !id || !C.me || author === C.me || viewed.has(C.me + ':' + id) || !window.IntersectionObserver) return;
    let t = 0;
    const io = new IntersectionObserver(es => { clearTimeout(t); if (es[0].isIntersecting) t = setTimeout(() => { io.disconnect(); markViewed(C.me, id, kind); }, 1000); }, { threshold: 0.35 });
    io.observe(el); return () => { clearTimeout(t); io.disconnect(); };
  }, [id, C.me]);
}

const TABLE_KO = { members: '식구', posts: '소식', comments: '댓글', reactions: '마음', notes: '냉장고 메모', events: '일정', letters: '편지', questions: '이번 주 질문', answers: '답', question_bank: '질문 상자',
  prayers: '기도', prayer_marks: '기도했어요', polls: '투표', poll_votes: '투표에서 고른 것', comment_reacts: '댓글 마음', memories: '추억', wishes: '바라는 것', event_tasks: '할 일', visits: '방문 기록', views: '조회 기록', app_settings: '설정' };
/* 점수 규칙 (서버 family_points 와 같은 기본값) */
const POINT_DEF = { visit: 2, post: 10, daily: 5, answer: 10, comment: 3, letter: 5, prayer: 5, pmark: 2, react: 1, view: 1,
  post_cap: 3, daily_cap: 1, comment_cap: 10, letter_cap: 3, prayer_cap: 3, view_cap: 30 };
/* [규칙, 이름, 기록 칸, 따로 붙는 설명] · 규칙_cap 이 있으면 "하루 n개까지"를 붙인다 */
const POINT_ROWS = [['visit', '앱 들어오기', 'visits', '하루 1번만'], ['post', '새 소식 올리기', 'posts'], ['daily', '오늘의 한 장', 'daily'], ['answer', '이번 주 질문에 답', 'answers'],
  ['comment', '댓글', 'comments'], ['letter', '편지 보내기', 'letters'], ['prayer', '기도 제목 나누기', 'prayers'], ['pmark', '기도했어요', 'pmarks', '기도마다 하루 1번'],
  ['react', '마음(이모지) 남기기', 'reacts', '남의 소식에만'], ['view', '소식 보기 (조회)', 'views', '하나당 1번']];
const ruleNote = (k, rules, note) => [note, rules[k + '_cap'] !== undefined ? `하루 ${rules[k + '_cap']}개까지` : ''].filter(Boolean).join(' · ');
const dayAdd = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
function periodOf(k) {
  const t = ymd(), d = parseYmd(t);
  if (k === 'week') return [dayAdd(t, -((d.getDay() + 6) % 7)), t];
  if (k === 'last') return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (k === 'year') return [`${d.getFullYear()}-01-01`, t];
  return [t.slice(0, 8) + '01', t];
}

function AdminSheet({ open, onClose }) {
  const C = useC(); const today = ymd();
  const [D, setD] = useState(null); const [per, setPer] = useState('month'); const [pts, setPts] = useState(null);
  const [rules, setRules] = useState(POINT_DEF); const [edit, setEdit] = useState(null); const [detail, setDetail] = useState(null);
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState(''); const [pinMode, setPinMode] = useState(null);
  const [resetFor, setResetFor] = useState(null); const [rpin, setRpin] = useState(''); const [bk, setBk] = useState({});   // 'new' 처음 정하기 · 'change' 바꾸기
  const recent = useMemo(() => [
    ...C.posts.filter(p => !isLocked(p)).map(p => ({ id: p.id, kind: 'post', author: p.author_id, t: p.created_at, text: p.kind === 'daily' ? `오늘의 한 장${p.content ? ' · ' + p.content : ''}` : (p.title || p.content || `사진 ${photosOf(p).length}장`) })),
    ...C.prayers.map(p => ({ id: p.id, kind: 'pray', author: p.author_id, t: p.created_at, text: `🙏 ${p.content || '목소리 기도'}` }))
  ].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6), [C.posts, C.prayers]);
  const load = async () => {
    const since = dayAdd(today, -40);
    const ids = recent.map(x => x.id);
    const [vs, ws, ps, st, first, hasPin, pins] = await Promise.all([
      db.list('visits', `select=*&day=gte.${since}&order=day,member_id`).catch(() => []),
      ids.length ? db.list('views', `select=item_id,member_id&item_id=in.(${ids.join(',')})&order=item_id,member_id`).catch(() => []) : [],
      db.list('push_subs', 'select=member_id&order=member_id').catch(() => []),
      db.list('app_settings', 'select=*&k=eq.points&order=k').catch(() => []),
      sb('visits?select=day&order=day.asc&limit=1').catch(() => []),
      db.rpc('admin_pin_set').catch(() => false),
      db.rpc('pins_state').catch(() => [])
    ]);
    setRules({ ...POINT_DEF, ...((st[0] && st[0].v) || {}) });
    setD({ vs, ws, ps, first: first[0] && first[0].day, hasPin: !!hasPin, pins: pins || [] });
  };
  const loadPts = async k => { setPts(null); const [a, b] = periodOf(k); try { setPts(await db.rpc('family_points', { p_from: a, p_to: b }) || []); } catch (e) { setPts([]); } };
  useEffect(() => { if (open) { setD(null); load(); loadPts(per); } }, [open]);
  const pick = k => { setPer(k); loadPts(k); };
  /* 점수 규칙은 관리자 PIN 이 맞아야 서버가 바꿔 준다 (가족 암호만으로는 못 바꿈) */
  const saveRules = async () => {
    if (!pin) { C.toast('관리자 PIN을 넣어 주세요'); return; }
    const v = {}; Object.keys(POINT_DEF).forEach(k => { v[k] = Math.max(0, Math.round(+edit[k] || 0)); });
    if (await C.write(() => rpcOk('set_points', { p_pin: pin, p_rules: v }), '점수 규칙을 바꿨어요')) { setRules(v); setEdit(null); setPin(''); loadPts(per); }
  };
  /* 백업에서 되살리기: 목록(창구 v4) 또는 파일 → 미리 세어 보기 → 되살리기 */
  const loadBackups = async () => {
    setBk({ busy: true });
    if ((await gwVersion()) < 4) { setBk({}); C.toast('사진 창구를 v4로 배포하면 목록이 보여요. 지금은 "파일에서 고르기"를 써 주세요'); return; }
    try { setBk({ list: (await gw('bklist')).list || [] }); } catch (e) { setBk({}); C.toast('백업 목록을 못 불러왔어요: ' + e.message); }
  };
  const pickBackup = async x => {
    setBk(b => ({ ...b, busy: true }));
    try {
      let text = x.text;
      if (!text) { const r = await gw('get', { id: x.id }); const bin = atob(r.data); text = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); }
      const data = JSON.parse(text);
      if (data.app !== 'THE FAMILY ZONE') throw new Error('패밀리그램 백업 파일이 아니에요');
      setBk(b => ({ ...b, busy: false, data, day: x.day && /^\d{4}-/.test(x.day) ? fmtDate(x.day, true) : x.day }));
    } catch (e) { setBk(b => ({ ...b, busy: false })); C.toast('백업을 읽지 못했어요: ' + e.message); }
  };
  const runRestore = async dry => {
    if (!rpin) { C.toast('관리자 PIN을 넣어 주세요'); return; }
    setBk(b => ({ ...b, busy: true }));
    try {
      const r = await rpcOk('restore_backup', { p_pin: rpin, p_data: bk.data, p_dry: dry });
      if (dry) setBk(b => ({ ...b, busy: false, added: r.added || {} }));
      else { C.toast(`되살렸어요 · ${Object.entries(r.added || {}).map(([t, n]) => `${TABLE_KO[t] || t} ${n}개`).join(', ')}`); setBk({}); setRpin(''); await C.reload(); load(); }
    } catch (e) { setBk(b => ({ ...b, busy: false })); C.toast(e.message); }
  };
  const savePin = async () => {
    if (!/^\d{4,8}$/.test(pin2)) { C.toast('PIN은 숫자 4~8자리로 정해 주세요'); return; }
    if (await C.write(() => rpcOk('set_admin_pin', { p_new: pin2, p_old: pinMode === 'change' ? pin : null }), pinMode === 'change' ? '관리자 PIN을 바꿨어요' : '관리자 PIN을 정했어요')) { setPin(''); setPin2(''); setPinMode(null); setD(x => ({ ...x, hasPin: true })); }
  };
  const ms = C.members;
  const vs = D ? D.vs : [];
  const lastOf = id => vs.filter(v => v.member_id === id).sort((a, b) => a.last_at.localeCompare(b.last_at)).pop();
  const [w0] = periodOf('week'); const week = [...Array(7)].map((_, i) => dayAdd(w0, i));
  const pushOn = new Set(D ? D.ps.map(p => p.member_id) : []);
  const rows = (pts || []).map(r => ({ ...r, m: C.getM(r.member_id) })).filter(r => ms.some(m => m.id === r.member_id));
  const top = rows.length ? Math.max(1, rows[0].points) : 1;
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <Sheet open={open} onClose={onClose} full title="🏆 관리자 · 가족 포인트">
      <p className="small muted" style={{ marginTop: 0 }}>관리자 폰에서만 보여요.{D && D.first ? ` 방문·조회는 ${fmtDate(D.first, true)}부터 세고 있어요.` : ' 방문·조회는 오늘부터 세기 시작해요.'}</p>

      <div className="adm">
        <div className="adm-t">오늘 누가 들어왔나</div>
        {!D ? <div className="row gap small muted"><span className="spin dark"/>불러오는 중…</div> : ms.map(m => {
          const l = lastOf(m.id); const td = vs.find(v => v.member_id === m.id && v.day === today);
          const gap = l ? dayDiff(l.day, today) : null;
          return (
            <div className="adm-r" key={m.id}>
              <Avatar m={m} size={32}/><b className="grow">{m.name}</b>
              {td ? <span className="small muted">{relTime(td.last_at)} · 오늘 {td.opens}번</span>
                : l ? <span className={'small' + (gap >= 3 ? ' warn' : ' muted')}>{gap === 1 ? '어제' : `${gap}일째 안 들어왔어요`}</span>
                : <span className="small muted">아직 기록 없어요</span>}
              {(!l || gap >= 3) && m.id !== C.me && <button className="btn sm soft" onClick={() => { onClose(); C.openLetterCompose({ to: m.id }); }}>💌</button>}
            </div>
          );
        })}
      </div>

      <div className="adm">
        <div className="adm-t">이번 주 출석부</div>
        <div className="att"><span/>{week.map((d, i) => <span key={d} className={'h' + (d === today ? ' td' : '')}>{'월화수목금토일'[i]}</span>)}</div>
        {ms.map(m => (
          <div className="att" key={m.id}><span className="nm">{m.name}</span>{week.map(d => <i key={d} className={vs.some(v => v.member_id === m.id && v.day === d) ? 'on' : d > today ? 'fu' : ''}/>)}</div>
        ))}
      </div>

      <div className="adm">
        <div className="adm-t">포인트 순위</div>
        <div className="chips" style={{ marginBottom: 8 }}>{[['week', '이번 주'], ['month', '이번 달'], ['last', '지난달'], ['year', '올해']].map(([k, l]) => <button key={k} className={'chip' + (per === k ? ' on' : '')} onClick={() => pick(k)}>{l}</button>)}</div>
        <div className="small muted" style={{ marginBottom: 6 }}>{(() => { const [a, b] = periodOf(per); return `${fmtDate(a, true)} ~ ${fmtDate(b, true)}`; })()}</div>
        {!pts ? <div className="row gap small muted"><span className="spin dark"/>계산하는 중…</div> : rows.map((r, i) => (
          <button className="rank" key={r.member_id} onClick={() => setDetail(r)}>
            <span className="no">{r.points > 0 && medal[i] ? medal[i] : i + 1}</span><Avatar m={r.m} size={28}/><span className="nm">{r.m.name}</span>
            <span className="bar"><i style={{ width: `${Math.round(r.points / top * 100)}%` }}/></span><b>{r.points}점</b>
          </button>
        ))}
        {pts && rows.length > 0 && <p className="small muted" style={{ margin: '6px 2px 0' }}>이름을 누르면 점수가 어떻게 나왔는지 보여요. 매달 1일 아침 9시에 지난달 1등을 온 가족에게 알려요.</p>}
      </div>

      <div className="adm">
        <div className="adm-t">식구별 기록 <span className="small muted" style={{ fontWeight: 400 }}>({{ week: '이번 주', month: '이번 달', last: '지난달', year: '올해' }[per]})</span></div>
        <table className="atb">
          <thead><tr><th/><th>방문</th><th>조회</th><th>새 글</th><th>댓글</th><th>마음</th><th>기도</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.member_id} onClick={() => setDetail(r)}><td>{r.m.name}</td><td>{r.visits}</td><td>{r.views}</td><td>{r.posts + r.daily}</td><td>{r.comments}</td><td>{r.reacts}</td><td>{r.prayers + r.pmarks}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="adm">
        <div className="adm-t row" style={{ justifyContent: 'space-between' }}>점수 규칙{!edit && D && D.hasPin && <button className="btn sm soft" onClick={() => { setEdit({ ...rules }); setPin(''); }}><LIcon name="pencil" size={16}/>바꾸기</button>}</div>
        {D && !D.hasPin && !pinMode && (
          <div className="pinbox"><b>🔒 먼저 관리자 PIN을 정해 주세요</b><span>점수 규칙은 이 PIN을 아는 사람만 바꿀 수 있어요. 가족 암호와 다른 숫자로 정해 주세요.</span>
            <button className="btn sm primary" onClick={() => { setPinMode('new'); setPin(''); setPin2(''); }}>PIN 정하기</button></div>
        )}
        {pinMode && (
          <div className="pinbox">
            <b>{pinMode === 'change' ? '관리자 PIN 바꾸기' : '관리자 PIN 정하기'}</b>
            {pinMode === 'change' && <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="지금 PIN" value={pin} onChange={e => setPin(e.target.value.trim())}/>}
            <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="새 PIN (숫자 4~8자리)" value={pin2} onChange={e => setPin2(e.target.value.trim())}/>
            <div className="row gap"><button className="btn soft grow" onClick={() => { setPinMode(null); setPin(''); setPin2(''); }}>그만두기</button><button className="btn primary grow" onClick={savePin}>저장</button></div>
          </div>
        )}
        {POINT_ROWS.map(([k, l, , note]) => (
          <div className="rule" key={k}>
            <span className="grow">{l}{ruleNote(k, rules, note) && <span className="small muted"> · {ruleNote(k, rules, note)}</span>}</span>
            {edit ? <input className="input pt" type="number" inputMode="numeric" min="0" value={edit[k]} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))}/> : <b className="pt">+{rules[k]}</b>}
          </div>
        ))}
        {edit && <>
          <div className="adm-t" style={{ margin: '14px 0 2px', fontSize: '.92rem' }}>하루에 점수로 세는 최대 개수</div>
          {POINT_ROWS.filter(([k]) => POINT_DEF[k + '_cap'] !== undefined).map(([k, l]) => (
            <div className="rule" key={k + '_cap'}><span className="grow">{l}</span><input className="input pt" type="number" inputMode="numeric" min="0" value={edit[k + '_cap']} onChange={e => setEdit(x => ({ ...x, [k + '_cap']: e.target.value }))}/><span className="small muted">개</span></div>
          ))}
          <div className="rule"><span className="grow">🔒 관리자 PIN</span><input className="input" style={{ width: 120 }} type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" value={pin} onChange={e => setPin(e.target.value.trim())}/></div>
          <div className="row gap" style={{ marginTop: 10 }}><button className="btn soft grow" onClick={() => { setEdit(null); setPin(''); }}>그만두기</button><button className="btn primary grow" onClick={saveRules}>저장</button></div>
        </>}
        {!edit && !pinMode && D && D.hasPin && <button className="more" style={{ marginTop: 8 }} onClick={() => { setPinMode('change'); setPin(''); setPin2(''); }}>관리자 PIN 바꾸기</button>}
        <p className="small muted" style={{ margin: '8px 2px 0' }}>하루에 정한 개수보다 많이 올려도 점수는 그만큼만 세요. 소식을 지우면 그 점수도 빠져요.</p>
      </div>

      <div className="adm">
        <div className="adm-t">폰 알림</div>
        {D && <>
          <div className="adm-r"><span className="pill ok">켜짐</span><span className="grow">{ms.filter(m => pushOn.has(m.id)).map(m => m.name).join(', ') || '없음'}</span></div>
          <div className="adm-r"><span className="pill no">꺼짐</span><span className="grow">{ms.filter(m => !pushOn.has(m.id)).map(m => m.name).join(', ') || '없음 · 모두 켜져 있어요'}</span></div>
          <p className="small muted" style={{ margin: '4px 2px 0' }}>꺼진 식구는 앱을 한 번 열고 "알림 받기"를 눌러야 소식 알림이 가요.</p>
        </>}
      </div>

      <div className="adm">
        <div className="adm-t">식구 PIN</div>
        <p className="small muted" style={{ margin: '0 0 6px' }}>식구가 PIN을 잊었으면 지워 주세요. 그 식구 폰에서 앱을 열면 새 PIN을 정하게 돼요.</p>
        {D && ms.map(m => (
          <div className="adm-r" key={m.id}>
            <Avatar m={m} size={28}/><b className="grow">{m.name}</b>
            {D.pins.includes(m.id) ? <span className="pill ok">PIN 있음</span> : <span className="pill no">아직 없음</span>}
            {D.pins.includes(m.id) && <button className="btn sm soft" onClick={() => setResetFor(m)}>지우기</button>}
          </div>
        ))}
        {resetFor && (
          <div className="pinbox">
            <b>{resetFor.name}의 PIN 지우기</b>
            <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="관리자 PIN" value={rpin} onChange={e => setRpin(e.target.value.replace(/\D/g, ''))}/>
            <div className="row gap"><button className="btn soft grow" onClick={() => { setResetFor(null); setRpin(''); }}>그만두기</button>
              <button className="btn primary grow" onClick={async () => { if (await C.write(() => rpcOk('reset_member_pin', { p_pin: rpin, p_member: resetFor.id }), `${resetFor.name}의 PIN을 지웠어요`)) { setResetFor(null); setRpin(''); load(); } }}>지우기</button></div>
          </div>
        )}
      </div>

      <div className="adm">
        <div className="adm-t">백업에서 되살리기</div>
        <p className="small muted" style={{ margin: '0 0 8px' }}>드라이브에 날마다 쌓인 백업에서 <b>지워진 것만</b> 다시 넣어요. 지금 있는 소식은 그대로예요. 되살리는 동안 폰 알림은 가지 않아요.</p>
        {!bk.list && <div className="row gap">
          <button className="btn sm soft" disabled={bk.busy} onClick={loadBackups}>{bk.busy ? <span className="spin dark"/> : <LIcon name="cloud-download" size={16}/>}백업 목록 보기</button>
          <label className="btn sm soft"><LIcon name="file-up" size={16}/>파일에서 고르기<input type="file" accept="application/json,.json" hidden onChange={async e => { const f = e.target.files[0]; e.target.value = ''; if (f) pickBackup({ day: f.name, text: await f.text() }); }}/></label>
        </div>}
        {bk.list && !bk.data && <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {bk.list.map(x => <button key={x.id} className="rank" onClick={() => pickBackup(x)}><LIcon name="file-json" size={18}/><span className="grow">{fmtDate(x.day, true)} 백업</span><span className="small muted">{Math.max(1, Math.round(x.size / 1024))}KB</span></button>)}
          {!bk.list.length && <p className="small muted">아직 백업이 없어요.</p>}
        </div>}
        {bk.data && <div className="pinbox">
          <b>📦 {bk.day} 백업</b>
          <span>{bk.data.saved_at ? `${new Date(bk.data.saved_at).toLocaleString('ko-KR')}에 저장` : ''}</span>
          <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="관리자 PIN" value={rpin} onChange={e => setRpin(e.target.value.replace(/\D/g, ''))}/>
          {bk.added && (Object.keys(bk.added).length
            ? <div className="small"><b>되살릴 것:</b> {Object.entries(bk.added).map(([t, n]) => `${TABLE_KO[t] || t} ${n}개`).join(' · ')}</div>
            : <div className="small"><b>빠진 게 없어요.</b> 이 백업의 내용이 지금 모두 있어요.</div>)}
          <div className="row gap">
            <button className="btn soft grow" onClick={() => { setBk({}); setRpin(''); }}>그만두기</button>
            {!bk.added
              ? <button className="btn primary grow" disabled={bk.busy} onClick={() => runRestore(true)}>{bk.busy ? <span className="spin"/> : '무엇이 돌아오는지 보기'}</button>
              : Object.keys(bk.added).length > 0 && <button className="btn primary grow" disabled={bk.busy} onClick={() => runRestore(false)}>{bk.busy ? <span className="spin"/> : '되살리기'}</button>}
          </div>
        </div>}
      </div>

      <div className="adm">
        <div className="adm-t">최근 소식 · 본 사람</div>
        {D && recent.map(x => {
          const saw = D.ws.filter(w => w.item_id === x.id).map(w => w.member_id);
          const not = ms.filter(m => m.id !== x.author && !saw.includes(m.id));
          return (
            <div className="seen" key={x.id}>
              <div className="row gap"><Avatar m={C.getM(x.author)} size={24}/><b className="grow ell">{C.getM(x.author).name} · {x.text}</b><span className="small muted">{saw.length}명 봄</span></div>
              <div className="small" style={{ paddingLeft: 32 }}>
                {saw.length > 0 && <span>👀 {saw.map(id => C.getM(id).name).join(', ')}</span>}
                {not.length > 0 && <span className="muted">{saw.length ? ' · ' : ''}아직: {not.map(m => m.name).join(', ')}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.m.name} · 점수 자세히` : ''}>
        {detail && <>
          {POINT_ROWS.map(([k, l, f]) => (
            <div className="rule" key={k}><span className="grow">{l}</span><span className="small muted">{detail[f]}번 × {rules[k]}</span><b className="pt">{detail[f] * rules[k]}점</b></div>
          ))}
          <div className="rule" style={{ borderTop: '2px solid #222' }}><b className="grow">합계</b><b className="pt" style={{ fontSize: '1.2rem' }}>{detail.points}점</b></div>
          <p className="small muted">앱은 {detail.opens}번 열었어요 (점수는 하루 1번만). 횟수는 하루 최대 개수까지만 센 숫자예요.</p>
        </>}
      </Sheet>
    </Sheet>
  );
}

/* ═══════════ 내 프로필 (+ 우리 식구) ═══════════ */
function MeTab() {
  const C = useC();
  return (
    <>
      <div className="topbar">
        <span className="h1">내 프로필</span>
        <div className="row">
          {C.isAdmin && <button className="iconbtn" onClick={C.openAdmin} aria-label="관리자 · 가족 포인트"><LIcon name="trophy" size={23}/></button>}
          <button className="iconbtn" onClick={() => C.openMemberEdit(C.getM(C.me))} aria-label="프로필 고치기"><LIcon name="pencil" size={22}/></button>
          <button className="iconbtn" onClick={C.openSettings} aria-label="설정"><LIcon name="settings"/></button>
        </div>
      </div>
      {C.isAdmin && <button className="banner adm-go" onClick={C.openAdmin}><span className="bic">🏆</span><div className="grow"><b>관리자 · 가족 포인트</b><span>순위 · 방문 · 조회 · 알림 상태 보기</span></div><LIcon name="chevron-right"/></button>}
      <div className="sheetcard" style={{ paddingTop: 6 }}>
        <div className="sec-t" style={{ paddingTop: 8 }}>우리 식구 <span className="small muted" style={{ fontWeight: 400 }}>누르면 그 사람의 사진·연표·목소리</span></div>
        <div className="famrow">
          {C.members.filter(m => m.id !== C.me).map(m => {
            const bd = C.bdayDays(m.id);
            return (
              <button key={m.id} className="fm" onClick={() => C.openProfile(m.id)}>
                <Avatar m={m} size={60} ring={C.storyRing(m.id) || 'plain'}/>
                <b>{m.name}</b>
                <span>{bd !== null && bd <= 30 ? `🎂 ${ddayText(bd)}` : m.role || ' '}</span>
              </button>
            );
          })}
          <button className="fm" onClick={() => C.openMemberEdit({})}><span className="fm-add"><LIcon name="user-plus" size={26}/></span><b>식구 더하기</b><span> </span></button>
        </div>
      </div>
      <div className="sheetcard" style={{ paddingBottom: 6 }}><ProfileBody mid={C.me}/></div>
    </>
  );
}

/* ═══════════ 해시태그 모아 보기 ═══════════ */
function TagPage({ tag, onClose }) {
  const C = useC();
  const list = tag ? C.posts.filter(p => p.kind !== 'daily' && !isLocked(p) && tagsOf(p.content).includes(tag)) : [];
  return (
    <Page open={!!tag} onClose={onClose} title={tag || ''}>
      <p className="small muted pad" style={{ margin: '4px 0 10px' }}>{tag} 소식 {list.length}개</p>
      <div className="tagfeed">{list.map(p => <PostCard key={p.id} p={p}/>)}</div>
    </Page>
  );
}

/* 편지함은 맨 위 종이비행기로 여는 창 */
function LettersPage({ open, onClose }) {
  useLayer(open, onClose);
  if (!open) return null;
  return <div className="page"><LettersTab onBack={onClose}/></div>;
}

function ProfilePage({ mid, onClose }) {
  const C = useC(); const m = mid ? C.getM(mid) : null;
  return (
    <Page open={!!m} onClose={onClose} title={m ? m.name : ''} right={m && <button className="iconbtn" onClick={() => C.openMemberEdit(m)} aria-label="프로필 고치기"><LIcon name="pencil" size={20}/></button>}>
      {m && <ProfileBody mid={mid}/>}
    </Page>
  );
}

function ProfileBody({ mid, top = 56 }) {
  const C = useC(); const [tab, setTab] = useState('ph'); const [detail, setDetail] = useState(null);
  useEffect(() => { setTab('ph'); }, [mid]);
  const m = mid ? C.getM(mid) : null; const today = ymd();
  const posts = m ? C.posts.filter(p => (p.author_id === m.id || (p.tagged || []).includes(m.id)) && !isLocked(p)) : [];
  const photoPosts = posts.filter(p => photosOf(p).length || p.kind === 'post');
  const byYear = {}; photoPosts.forEach(p => (byYear[p.happened_on.slice(0, 4)] = byYear[p.happened_on.slice(0, 4)] || []).push(p));
  const years = Object.keys(byYear).sort().reverse();
  const bd = m ? C.bdayDays(m.id) : null;
  const tl = useMemo(() => {
    if (!m) return [];
    const out = [];
    C.posts.forEach(p => {
      if (p.author_id === m.id) out.push({ d: p.happened_on, t: p.created_at, ic: p.kind === 'daily' ? 'camera' : photosOf(p).length ? 'image' : 'pencil', bg: '#FFF1E8', c: '#D0603A', title: isLocked(p) ? '🔒 타임캡슐 소식을 남김' : p.kind === 'daily' ? '오늘의 한 장' : (p.content || '사진 소식').slice(0, 40), sub: isLocked(p) ? `${fmtDate(p.open_on, true)}에 열려요` : `소식 · 사진 ${photosOf(p).length}장`, p: isLocked(p) ? null : p });
      else if ((p.tagged || []).includes(m.id) && !isLocked(p)) out.push({ d: p.happened_on, t: p.created_at, ic: 'users', bg: '#EAF3FF', c: '#2d5c9e', title: `${C.getM(p.author_id).name}의 사진에 함께`, sub: (p.content || '').slice(0, 40), p });
    });
    C.letters.forEach(l => {
      const lock = isLocked(l); const d = ymd(new Date(l.created_at));
      if (l.sender_id === m.id) out.push({ d, t: l.created_at, ic: lock ? 'lock' : 'send', bg: '#F3EEFF', c: '#6a3fc8', title: `${C.getM(l.receiver_id).name}에게 편지`, sub: lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.title || l.content).slice(0, 40), l });
      else if (l.receiver_id === m.id) out.push({ d, t: l.created_at, ic: lock ? 'lock' : 'mail', bg: '#F3EEFF', c: '#6a3fc8', title: `${C.getM(l.sender_id).name}에게 편지 받음`, sub: lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.title || l.content).slice(0, 40), l });
    });
    C.answers.filter(a => a.member_id === m.id).forEach(a => { const q = C.questions.find(x => x.id === a.question_id); out.push({ d: ymd(new Date(a.created_at)), t: a.created_at, ic: 'circle-help', bg: '#FFF5E2', c: '#B5861C', title: `질문에 답: ${q ? q.text : ''}`.slice(0, 44), sub: a.audio_url ? '🎙 목소리 답' : a.content.slice(0, 40), q }); });
    if (m.birth_date) out.push({ d: m.birth_date, t: '', ic: 'cake', bg: '#FDEBE3', c: '#D0603A', title: `${m.name} 태어난 날`, sub: m.bday_lunar && lunarOf(parseYmd(m.birth_date)) ? `음력 ${lunarOf(parseYmd(m.birth_date)).m}월 ${lunarOf(parseYmd(m.birth_date)).d}일` : '' });
    return out.sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t));
  }, [m, C.posts, C.letters, C.answers]);
  const voices = m ? [
    ...C.comments.filter(c => c.author_id === m.id && c.audio_url).map(c => { const p = C.posts.find(x => x.id === c.post_id); return { id: c.id, src: c.audio_url, t: c.created_at, text: c.content, ctx: p ? `${C.getM(p.author_id).name}의 소식에 남긴 목소리` : '목소리 댓글' }; }),
    ...C.answers.filter(a => a.member_id === m.id && a.audio_url).map(a => { const q = C.questions.find(x => x.id === a.question_id); return { id: a.id, src: a.audio_url, t: a.created_at, text: a.content, ctx: q ? `질문 “${q.text}”에 답` : '질문에 답' }; }),
    ...C.prayers.filter(p => p.author_id === m.id && p.audio_url).map(p => ({ id: p.id, src: p.audio_url, t: p.created_at, text: p.content, ctx: p.kind === 'prayer' ? '목소리 기도' : '기도 제목' })),
    ...C.posts.filter(p => p.author_id === m.id && p.audio_url && !isLocked(p)).map(p => ({ id: p.id, src: p.audio_url, t: p.created_at, text: p.content, ctx: '오늘의 한 장 목소리' })),
    ...C.letters.filter(l => l.sender_id === m.id && l.audio_url && !isLocked(l)).map(l => ({ id: l.id, src: l.audio_url, t: l.created_at, text: l.content, ctx: `${C.getM(l.receiver_id).name}에게 보낸 목소리 편지` }))
  ].sort((a, b) => b.t.localeCompare(a.t)) : [];
  const mine = m && m.id === C.me;
  const age = m && m.birth_date ? ageOn(m.birth_date, today) : null;
  const saved = mine ? C.posts.filter(p => C.isSaved(p.id) && !isLocked(p)) : [];
  return (
    <>
      {m && <>
        <div className="prof">
          <div className="row" style={{ gap: 16 }}>
            <Avatar m={m} size={86} ring={C.storyRing(m.id) || 'plain'} onClick={C.dailyToday(m.id).length ? () => C.openStory(C.dailyToday(m.id)) : undefined}/>
            <div className="cnts">
              <div><span>소식</span><b>{C.posts.filter(p => p.author_id === m.id && p.kind !== 'daily').length}</b></div>
              <div><span>받은 편지</span><b>{C.letters.filter(l => l.receiver_id === m.id).length}</b></div>
              {age !== null
                ? <div><span>나이</span><b>{age}</b></div>
                : <div><span>사진</span><b>{posts.reduce((n, p) => n + photosOf(p).length, 0)}</b></div>}
            </div>
          </div>
          <h3>{m.name}{m.role ? ` · ${m.role}` : ''}</h3>
          <p>
            {m.birth_date ? <>{fmtDate(m.birth_date, true)}생{m.bday_lunar ? ' (생일은 음력)' : ''}{bd !== null && <> · 🎂 생일까지 {bd === 0 ? '오늘!' : `${bd}일`}</>}<br/></> : <span className="muted">생일을 넣으면 나이와 생일 알림이 보여요<br/></span>}
            {m.likes && <>좋아하는 것: {m.likes}</>}
          </p>
          <div className="pbtns">
            {mine ? <>
              <button className="btn soft" onClick={() => C.openMemberEdit(m)}><LIcon name="pencil" size={18}/>프로필 고치기</button>
              <button className="btn soft" onClick={() => C.openComposer({ mode: 'daily' })}><LIcon name="camera" size={18}/>오늘의 한 장</button>
            </> : <>
              <button className="btn soft" onClick={() => C.openLetterCompose({ to: m.id })}>💌 편지 쓰기</button>
              <button className="btn soft" onClick={() => C.openLetterCompose({ to: m.id })}>🎤 말 남기기</button>
            </>}
          </div>
        </div>
        <div className="ptabs" style={{ top }}>
          <button className={tab === 'ph' ? 'on' : ''} onClick={() => setTab('ph')}><LIcon name="grid-3x3" size={18}/>사진</button>
          <button className={tab === 'tl' ? 'on' : ''} onClick={() => setTab('tl')}><LIcon name="git-commit-vertical" size={18}/>연표</button>
          <button className={tab === 'vo' ? 'on' : ''} onClick={() => setTab('vo')}><LIcon name="audio-lines" size={18}/>목소리</button>
          {mine && <button className={tab === 'sv' ? 'on' : ''} onClick={() => setTab('sv')}><LIcon name="bookmark" size={18}/>보관</button>}
        </div>
        {tab === 'sv' && (<>
          {!saved.length && <div className="empty">보관한 소식이 없어요.<br/><span className="small">소식 오른쪽 아래 <b>책갈피</b>를 누르면 여기 모여요.</span></div>}
          <div className="grid">{saved.map(p => { const ph = photosOf(p)[0]; return (
            <button key={p.id} onClick={() => setDetail(p)} aria-label="소식 보기">
              {ph ? <img src={ph.thumb || ph.url} alt="" loading="lazy"/> : <div className="txt">{(p.content || '').slice(0, 40)}</div>}
              {photosOf(p).length > 1 && <span className="multi"><LIcon name="copy" size={18} stroke="#fff"/></span>}
            </button>); })}</div>
        </>)}
        {tab === 'ph' && (<>
          {!years.length && <div className="empty">아직 {m.name}의 사진이 없어요.<br/><span className="small">{josa(m.name, '이', '가')} 올린 사진이 여기 해마다 모여요.</span></div>}
          {years.map(y => { const ps = byYear[y]; const last = ps.map(p => p.happened_on).sort().pop(); const cnt = ps.reduce((n, p) => n + photosOf(p).length, 0); return (
            <div key={y}>
              <div className="yr">{y}년{m.birth_date && last >= m.birth_date ? ` · ${ageOn(m.birth_date, last)}살` : ''} <span>사진 {cnt}장</span></div>
              <div className="grid">{ps.map(p => { const ph = photosOf(p)[0]; return (
                <button key={p.id} onClick={() => setDetail(p)} aria-label="소식 보기">
                  {ph ? <img src={ph.thumb || ph.url} alt="" loading="lazy"/> : <div className="txt">{(p.content || '').slice(0, 40)}</div>}
                  {photosOf(p).length > 1 && <span className="multi"><LIcon name="copy" size={18} stroke="#fff"/></span>}
                </button>); })}</div>
            </div>); })}
        </>)}
        {tab === 'tl' && (
          <div className="tl">
            {!tl.length && <div className="empty">아직 기록이 없어요.</div>}
            {tl.map((x, i) => (
              <button key={i} className="tl-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => { if (x.p) setDetail(x.p); else if (x.l) C.openLetter(x.l); else if (x.q) C.openQuestion(x.q); }}>
                <div className="tl-ic" style={{ background: x.bg, color: x.c }}><LIcon name={x.ic} size={20}/></div>
                <div className="grow"><span>{fmtDate(x.d, true)}</span><b>{x.title}</b><span>{x.sub}</span></div>
              </button>
            ))}
          </div>
        )}
        {tab === 'vo' && (
          <div className="tl">
            {!voices.length && <div className="empty">아직 {m.name}의 목소리가 없어요.<br/><span className="small">댓글·질문 답·편지를 목소리로 남기면 여기 모여서 오래 남아요.</span></div>}
            {voices.map(v => <div key={v.id} className="tl-item"><div className="tl-ic" style={{ background: '#F4F1FF', color: '#7b4bd1' }}><LIcon name="audio-lines" size={20}/></div><div className="grow"><span>{fmtDate(ymd(new Date(v.t)), true)} · {v.ctx}</span><VoicePlayer src={v.src}/>{v.text && <span style={{ color: '#5b4a86' }}>“{v.text}”</span>}</div></div>)}
          </div>
        )}
      </>}
      <Page open={!!detail} onClose={() => setDetail(null)} title="소식">{detail && (C.posts.find(x => x.id === detail.id) ? <PostCard p={C.posts.find(x => x.id === detail.id)}/> : <p className="empty">지워진 소식이에요.</p>)}</Page>
    </>
  );
}

function MemberEdit({ m, onClose }) {
  const C = useC(); const open = !!m; const isNew = m && !m.id;
  const [f, setF] = useState({}); const [busy, setBusy] = useState(false); const pick = useRef(null);
  useEffect(() => { if (m) setF({ name: m.name || '', emoji: m.emoji || '🙂', role: m.role || '', birth_date: m.birth_date || '', bday_lunar: !!m.bday_lunar, likes: m.likes || '', color: m.color || '#F0603A', avatar: m.avatar || '' }); }, [m]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const emojis = ['👵','👴','👩','👨','🧒','👧','👦','👶','🧑','👱‍♀️','🐶','🐱'];
  const colors = ['#F0603A','#D9407A','#6a3fc8','#2F7BF6','#2E7D5B','#B5861C','#555555'];
  const save = async () => {
    if (!f.name.trim()) { C.toast('이름을 적어 주세요'); return; }
    const row = { name: f.name.trim(), emoji: f.emoji || '🙂', role: f.role.trim(), birth_date: f.birth_date || null, bday_lunar: !!f.bday_lunar, likes: f.likes.trim(), color: f.color, avatar: f.avatar || '' };
    const ok = await C.write(() => isNew ? db.add('members', { ...row, sort: Math.max(0, ...C.members.map(x => x.sort || 0)) + 1 }) : db.patch('members', m.id, row), isNew ? '식구를 더했어요' : '프로필을 고쳤어요');
    if (ok) onClose();
  };
  const l = f.birth_date ? lunarOf(parseYmd(f.birth_date)) : null;
  return (
    <Sheet open={open} onClose={onClose} full title={isNew ? '식구 더하기' : '프로필 고치기'} right={<button className="hdbtn" disabled={busy} onClick={save}>저장</button>}>
      {open && <>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Avatar m={{ ...f }} size={96}/>
          <div className="row gap" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn sm soft" disabled={busy} onClick={() => pick.current.click()}>{busy ? <span className="spin dark"/> : <LIcon name="camera" size={18}/>}사진으로</button>
            {f.avatar && <button className="btn sm soft" onClick={() => set('avatar', '')}>사진 빼기</button>}
          </div>
          <input ref={pick} type="file" accept="image/*" hidden onChange={async e => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; setBusy(true); try { const r = await uploadPhoto(file, 480); set('avatar', r.thumb); } catch (err) { C.toast('사진을 올리지 못했어요: ' + err.message); } setBusy(false); }}/>
        </div>
        <div className="field"><label>이름·호칭</label><input className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="예: 할머니, 지우"/></div>
        {!f.avatar && <div className="field"><label>얼굴 그림</label><div className="chips">{emojis.map(x => <button key={x} type="button" className={'chip' + (f.emoji === x ? ' on' : '')} style={{ fontSize: '1.3rem' }} onClick={() => set('emoji', x)}>{x}</button>)}</div></div>}
        <div className="field"><label>한 줄 소개</label><input className="input" value={f.role} onChange={e => set('role', e.target.value)} placeholder="예: 막내 손주, 텃밭 대장"/></div>
        <div className="field"><label>생년월일 (양력)</label><input type="date" className="input" max={ymd()} value={f.birth_date} onChange={e => set('birth_date', e.target.value)}/>
          {l && <p className="small muted" style={{ margin: '6px 2px 0' }}>음력으로는 {l.leap ? '윤' : ''}{l.m}월 {l.d}일이에요.</p>}</div>
        {f.birth_date && <div className="field"><Toggle on={f.bday_lunar} onChange={v => set('bday_lunar', v)} label="생일을 음력으로 쇠요" sub={l ? `켜면 매년 음력 ${l.m}월 ${l.d}일에 맞춰 달력에 들어가요` : ''}/></div>}
        <div className="field"><label>좋아하는 것</label><input className="input" value={f.likes} onChange={e => set('likes', e.target.value)} placeholder="예: 김밥, 공룡, 할머니 텃밭"/></div>
        <div className="field"><label>내 색깔 (달력 표시)</label><div className="chips">{colors.map(c => <button key={c} type="button" aria-label={c} onClick={() => set('color', c)} style={{ width: 40, height: 40, borderRadius: '50%', background: c, border: f.color === c ? '3px solid #1a1a1a' : '3px solid #fff', boxShadow: '0 0 0 1px #ddd' }}/>)}</div></div>
        {!isNew && <button className="btn soft block danger" style={{ marginTop: 10 }} onClick={() => C.deleteMember(m)}><LIcon name="trash-2" size={18}/>명단에서 빼기</button>}
      </>}
    </Sheet>
  );
}

function SettingsSheet({ open, onClose }) {
  const C = useC(); const [pinCh, setPinCh] = useState(null); const [ko, setKo] = useState(''); const [kn, setKn] = useState(''); const [bk, setBk] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) return; setBk(null); gwVersion().then(v => { if (v >= 2) gw('bkinfo').then(setBk).catch(() => setBk({ err: true })); else setBk({ old: true, v }); }); }, [open]);
  const fs = C.fontSize;
  return (
    <Sheet open={open} onClose={onClose} full title="설정">
      {!isStandalone() && <div className="field"><label>📲 앱으로 설치</label><InstallCard inSettings/></div>}
      <div className="field"><label>🔔 새 소식 알림</label><PushSettings/></div>
      <div className="field"><label>글씨 크기</label><div className="seg seg3">{[['m', '보통'], ['l', '크게'], ['xl', '아주 크게']].map(([k, l]) => <button key={k} className={fs === k ? 'on' : ''} onClick={() => C.setFontSize(k)}>{l}</button>)}</div></div>
      <div className="field"><label>이 폰은</label><div className="row gap"><Avatar m={C.getM(C.me)} size={40}/><b className="grow">{C.getM(C.me).name}</b><button className="btn sm soft" onClick={() => setPinCh(x => x ? null : { a: '', b: '' })}>내 PIN 바꾸기</button><button className="btn sm soft" onClick={() => { onClose(); C.changeMe(); }}>나 바꾸기</button></div>
        {pinCh && <div className="pinbox" style={{ marginTop: 10 }}>
          <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="지금 PIN" value={pinCh.a} onChange={e => setPinCh(x => ({ ...x, a: e.target.value.replace(/\D/g, '') }))}/>
          <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="새 PIN (숫자 4~8자리)" value={pinCh.b} onChange={e => setPinCh(x => ({ ...x, b: e.target.value.replace(/\D/g, '') }))}/>
          <div className="row gap"><button className="btn soft grow" onClick={() => setPinCh(null)}>그만두기</button><button className="btn primary grow" onClick={async () => { if (await C.write(() => rpcOk('change_my_pin', { p_old: pinCh.a, p_new: pinCh.b }), '내 PIN을 바꿨어요')) setPinCh(null); }}>저장</button></div>
        </div>}
      </div>
      <div className="field">
        <label>☁️ 자동 백업 (내 구글 드라이브)</label>
        <div style={{ background: '#f6f6f6', borderRadius: 14, padding: 12, fontSize: '.95rem' }}>
          {!bk && <div className="row gap"><span className="spin dark"/>확인하는 중…</div>}
          {bk && bk.old && <div>사진 창구 스크립트를 <b>새 버전으로 한 번 배포</b>해야 백업이 시작돼요. (지금 버전 {bk.v || '연결 안 됨'})</div>}
          {bk && bk.err && <div>백업 상태를 읽지 못했어요.</div>}
          {bk && bk.count !== undefined && <div>마지막 백업: <b>{bk.last ? fmtDate(bk.last, true) : '아직 없음'}</b> · 쌓인 백업 {bk.count}개<br/><span className="small muted">매일 처음 열 때 저절로 저장돼요. 지난 날 백업은 지우지 않고 쌓아 둬요.</span></div>}
          {bk && bk.count !== undefined && <div className="row gap" style={{ marginTop: 10 }}>
            <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); const ok = await C.runBackup(true); if (ok) setBk(await gw('bkinfo')); setBusy(false); }}>{busy ? <span className="spin"/> : <LIcon name="cloud-upload" size={18}/>}지금 백업</button>
            {bk.folder && <a className="btn sm soft" href={bk.folder} target="_blank" rel="noopener" style={{ textDecoration: 'none', color: 'inherit' }}>드라이브 폴더 열기</a>}
          </div>}
        </div>
      </div>
      <form className="field" onSubmit={async e => { e.preventDefault(); if (await C.changeKey(ko, kn)) { setKo(''); setKn(''); } }}>
        <label>🔒 가족 암호 바꾸기</label>
        <div style={{ display: 'grid', gap: 8 }}>
          <input type="password" className="input" autoComplete="current-password" placeholder="지금 암호" value={ko} onChange={e => setKo(e.target.value)}/>
          <input type="password" className="input" autoComplete="new-password" placeholder="새 암호 (6자 이상)" value={kn} onChange={e => setKn(e.target.value)}/>
          <button className="btn soft" type="submit">암호 바꾸기</button>
          <span className="small muted">바꾸면 다른 식구 폰은 새 암호를 다시 넣어야 해요.</span>
        </div>
      </form>
      <button className="btn soft block danger" onClick={() => { if (window.confirm('이 폰에서 나갈까요? 다시 들어오려면 가족 암호가 필요해요.')) { onClose(); C.leave(); } }}><LIcon name="log-out" size={18}/>이 폰에서 나가기</button>
    </Sheet>
  );
}

/* 지난번 이후 새 소식 */
/* ═══════════ 연말 가족 책 ═══════════ */
function BookView({ year, onClose }) {
  const C = useC(); const [y, setY] = useState(year); const [withLetters, setWithLetters] = useState(false); const [withTalk, setWithTalk] = useState(true);
  useLayer(!!year, onClose);
  useEffect(() => { if (year) setY(year); }, [year]);
  if (!year) return null;
  const years = [...new Set([new Date().getFullYear(), ...C.posts.map(p => +p.happened_on.slice(0, 4))])].sort((a, b) => b - a);
  const posts = C.posts.filter(p => p.happened_on.startsWith(y + '') && !isLocked(p)).sort((a, b) => a.happened_on.localeCompare(b.happened_on) || a.created_at.localeCompare(b.created_at));
  const months = {}; posts.forEach(p => (months[+p.happened_on.slice(5, 7)] = months[+p.happened_on.slice(5, 7)] || []).push(p));
  const qs = C.questions.filter(q => q.week_start.startsWith(y + '')).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const letters = C.letters.filter(l => !isLocked(l) && (l.open_on || ymd(new Date(l.created_at))).startsWith(y + ''));
  const nPhotos = posts.reduce((n, p) => n + photosOf(p).length, 0);
  return (
    <div className="bookpage">
      <div className="bookbar">
        <button className="iconbtn" onClick={onClose} aria-label="닫기"><LIcon name="x"/></button>
        <select className="input" style={{ width: 'auto', minHeight: 40 }} value={y} onChange={e => setY(+e.target.value)}>{years.map(x => <option key={x} value={x}>{x}년</option>)}</select>
        <label className="row gap small" style={{ minHeight: 40 }}><input type="checkbox" checked={withLetters} onChange={e => setWithLetters(e.target.checked)} style={{ width: 20, height: 20 }}/>편지도 넣기</label>
        <label className="row gap small" style={{ minHeight: 40 }}><input type="checkbox" checked={withTalk} onChange={e => setWithTalk(e.target.checked)} style={{ width: 20, height: 20 }}/>댓글·마음 넣기</label>
        <span className="grow"/>
        <button className="btn sm primary" onClick={() => window.print()}><LIcon name="printer" size={18}/>PDF로 저장 · 인쇄</button>
      </div>
      <div className="bk">
        <div className="bk-cover">
          <div className="y">{y}</div>
          <h1>우리 가족 이야기</h1>
          <div style={{ fontSize: 28, margin: '14px 0' }}>{C.members.map(m => m.emoji).join(' ')}</div>
          <div>{C.members.map(m => m.name).join(' · ')}</div>
          <div style={{ color: '#888', marginTop: 10, fontSize: 14 }}>소식 {posts.length}개 · 사진 {nPhotos}장 · 질문 {qs.length}개</div>
        </div>
        {!posts.length && <p style={{ textAlign: 'center', color: '#888' }}>{y}년에는 아직 소식이 없어요.</p>}
        {Object.keys(months).sort((a, b) => a - b).map(mo => (
          <div key={mo}>
            <h2>{mo}월</h2>
            {months[mo].map(p => { const ph = photosOf(p).slice(0, 4); const ans = C.commentsOf(p.id).filter(c => c.is_answer); return (
              <div key={p.id} className="bk-post">
                <div className="m">{fmtDate(p.happened_on, true)} · {C.getM(p.author_id).name}{p.kind === 'daily' ? ' · 오늘의 한 장' : ''}{(p.tagged || []).length ? ` · 함께: ${(p.tagged || []).map(id => C.getM(id).name).join(', ')}` : ''}</div>
                {ph.length > 0 && <div className={'bk-ph' + (ph.length === 1 ? ' one' : '')}>{ph.map((x, i) => <img key={i} src={x.url} alt=""/>)}</div>}
                {p.content && <div style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>}
                {withTalk && (() => {   /* 가족이 남긴 마음(이모지)과 댓글도 책에 */
                  const rs = C.reactsOf(p.id); const cm = C.commentsOf(p.id).filter(c => !c.is_answer);
                  return <>
                    {rs.length > 0 && <div className="bk-re">{[...new Set(rs.map(r => r.emoji))].join('')} {rs.length} · {rs.map(r => C.getM(r.member_id).name + r.emoji).join(', ')}</div>}
                    {cm.length > 0 && <div className="bk-cm">{cm.map(c => <div key={c.id}><b>{C.getM(c.author_id).name}</b> {c.content || '(목소리 댓글)'}{c.audio_url && c.content ? ' 🎙' : ''}</div>)}</div>}
                  </>;
                })()}
                {p.ask_to && <div style={{ marginTop: 6, color: '#8a4a2a' }}>Q. {C.getM(p.ask_to).name}께 — {p.ask_text}{ans.map(a => <div key={a.id} style={{ color: '#333' }}>A. {C.getM(a.author_id).name}: {a.content || '(목소리 답)'}</div>)}</div>}
              </div>); })}
          </div>
        ))}
        {qs.length > 0 && <>
          <h2>이번 주의 질문</h2>
          {qs.filter(q => q.text).map(q => <div key={q.id} className="bk-post"><div className="m">{fmtDate(q.week_start, true)} 주 · 질문자 {C.getM(q.asker_id).name}{q.audio_url ? ' 🎙' : ''}</div><b>Q. {q.text}</b>{q.note && <div className="m">💬 {q.note}</div>}
            {C.answers.filter(a => a.question_id === q.id).map(a => <div key={a.id}>A. {C.getM(a.member_id).name}: {a.content || '(목소리로 답함)'}{a.audio_url && a.content ? ' 🎙' : ''}</div>)}</div>)}
        </>}
        {C.prayers.some(p => p.answered_at && p.answered_at.startsWith(y + '')) && <>
          <h2>✨ 응답 노트</h2>
          {C.prayers.filter(p => p.answered_at && p.answered_at.startsWith(y + '')).map(p => <div key={p.id} className="bk-post"><div className="m">{fmtDate(ymd(new Date(p.created_at)), true)} · {C.getM(p.author_id).name}의 기도 제목{prayFor(C, p) ? ` · ${prayFor(C, p)}을(를) 위해` : ''}</div><b>🙏 {p.content || '목소리 기도'}</b><div>✨ {fmtDate(ymd(new Date(p.answered_at)), true)} 응답{p.answer_note ? ` — ${p.answer_note}` : ''}</div></div>)}
        </>}
        {withLetters && letters.length > 0 && <>
          <h2>편지</h2>
          {letters.map(l => <div key={l.id} className="bk-post"><div className="m">{fmtDate(ymd(new Date(l.created_at)), true)} · {C.getM(l.sender_id).name} → {C.getM(l.receiver_id).name}</div>{l.title && <b>{l.title}</b>}<div style={{ whiteSpace: 'pre-wrap' }}>{l.content}</div></div>)}
        </>}
      </div>
    </div>
  );
}

function AgoPage({ items, onClose }) {
  const today = ymd();
  return (
    <Page open={!!items} onClose={onClose} title="N년 전 오늘">
      {items && items.sort((a, b) => b.happened_on.localeCompare(a.happened_on)).map(p => (
        <div key={p.id}><div className="sec-t" style={{ color: '#8a6d2a' }}>{+today.slice(0, 4) - +p.happened_on.slice(0, 4)}년 전 · {fmtDate(p.happened_on, true)}</div><PostCard p={p}/></div>
      ))}
    </Page>
  );
}

/* ═══════════ 첫 화면들 ═══════════ */
function Gate({ onEnter }) {
  const [mode, setMode] = useState('checking'); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { familyKey = ''; db.rpc('family_ready').then(r => setMode(r ? 'enter' : 'setup')).catch(() => { setErr('가족 공간에 연결하지 못했어요. 인터넷을 확인하고 다시 열어 주세요.'); setMode('error'); }); }, []);
  const submit = async e => {
    e.preventDefault(); setErr('');
    const k = pw.trim();
    if (k.length < 6) { setErr('가족 암호는 6자 이상이에요.'); return; }
    if (mode === 'setup' && k !== pw2.trim()) { setErr('두 번 적은 암호가 서로 달라요.'); return; }
    setBusy(true);
    try {
      if (mode === 'setup') await db.rpc('set_family_key', { new_key: k });
      familyKey = k;
      if (!(await db.rpc('is_family'))) { familyKey = ''; throw new Error('암호가 맞지 않아요. 다시 확인해 주세요.'); }
      store.set('fz_key', k); onEnter();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="gate">
      <div className="brand">Familygram<LIcon name="heart" size={26} fill="#ED4956" stroke="#ED4956"/></div>
      <p className="muted" style={{ margin: '6px 0 26px' }}>우리 식구끼리만 보는 공간</p>
      {mode === 'checking' && <p className="muted">가족 공간을 찾는 중…</p>}
      {mode === 'error' && <p style={{ color: '#c33' }}>{err}</p>}
      {(mode === 'setup' || mode === 'enter') && (
        <form onSubmit={submit} style={{ width: '100%', display: 'grid', gap: 10 }}>
          <p style={{ textAlign: 'center', margin: '0 0 6px' }}>{mode === 'setup' ? <>처음 오셨네요. 우리 가족만 들어올 수 있게<br/><b>가족 암호</b>를 정해 주세요.</> : <><b>가족 암호</b>를 넣어 주세요.</>}</p>
          <input type="password" className="input" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} placeholder="가족 암호 (6자 이상)" value={pw} onChange={e => setPw(e.target.value)}/>
          {mode === 'setup' && <input type="password" className="input" autoComplete="new-password" placeholder="한 번 더" value={pw2} onChange={e => setPw2(e.target.value)}/>}
          {err && <p style={{ color: '#c33', textAlign: 'center', margin: 0 }}>{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? '확인하는 중…' : mode === 'setup' ? '가족 암호 정하기' : '들어가기'}</button>
        </form>
      )}
    </div>
  );
}

function PickMe({ members, onPick, onLeave }) {
  return (
    <div className="gate">
      <div className="brand">Familygram<LIcon name="heart" size={26} fill="#ED4956" stroke="#ED4956"/></div>
      <h2 style={{ margin: '18px 0 4px', fontSize: '1.3rem' }}>이 폰은 누구의 것인가요?</h2>
      <p className="small muted" style={{ marginTop: 0 }}>고른 이름으로 소식과 편지가 올라가요. 나중에 바꿀 수 있어요.</p>
      <div className="famgrid" style={{ width: '100%', padding: 0 }}>
        {members.map(m => <button key={m.id} className="famcard" onClick={() => onPick(m.id)}><Avatar m={m} size={68}/><b>{m.name}</b><span>{m.role}</span></button>)}
      </div>
      <button className="linkbtn" style={{ marginTop: 18 }} onClick={onLeave}>이 폰에서 나가기</button>
    </div>
  );
}

/* 이 폰이 누구인지 서버에 증명: 식구마다 개인 PIN → 폰 열쇠. 열쇠가 있어야 그 이름으로 글을 쓸 수 있다 */
function PinGate({ member, onDone, onOther }) {
  const [state, setState] = useState(null);   // 'new' 처음 정하기 · 'enter' 넣기
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { db.rpc('pins_state').then(ids => setState((ids || []).includes(member.id) ? 'enter' : 'new')).catch(() => setState('enter')); }, [member.id]);
  const go = async () => {
    setErr('');
    if (!/^\d{4,8}$/.test(a)) { setErr('숫자 4~8자리로 넣어 주세요'); return; }
    if (state === 'new' && a !== b) { setErr('두 번 넣은 숫자가 달라요'); return; }
    setBusy(true);
    try { const r = await rpcOk('claim_member', { p_member: member.id, p_pin: a }); onDone(r.token); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const pinInput = (v, set, ph) => <input className="input pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder={ph} value={v} onChange={e => set(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter') go(); }}/>;
  return (
    <div className="gate">
      <div className="brand">Familygram<LIcon name="heart" size={26} fill="#ED4956" stroke="#ED4956"/></div>
      <Avatar m={member} size={84}/>
      <h2 style={{ margin: '12px 0 4px', fontSize: '1.3rem' }}>{member.name}{state === 'new' ? ' · 나만의 PIN 정하기' : ' · PIN 넣기'}</h2>
      {!state ? <p className="muted"><span className="spin dark"/></p> : <>
        <p className="small muted" style={{ margin: '0 0 14px', textAlign: 'center', lineHeight: 1.6 }}>
          {state === 'new'
            ? <>{member.name}만 아는 숫자 4자리를 정해 주세요.<br/>다른 식구가 {member.name} 이름으로 글을 쓸 수 없게 지켜 줘요.<br/>이 폰에서는 한 번만 넣으면 돼요.</>
            : <>{member.name}의 PIN을 넣어 주세요.<br/>이 폰에서는 한 번만 넣으면 돼요.</>}
        </p>
        <div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 260 }}>
          {pinInput(a, setA, state === 'new' ? '숫자 4자리' : 'PIN')}
          {state === 'new' && pinInput(b, setB, '한 번 더')}
          {err && <div className="small" style={{ color: '#d0402a', textAlign: 'center' }}>{err}</div>}
          <button className="btn primary block" disabled={busy} onClick={go}>{busy ? <span className="spin"/> : state === 'new' ? 'PIN 정하고 들어가기' : '들어가기'}</button>
        </div>
        <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>PIN을 잊었으면 관리자(아빠)에게 지워 달라고 하세요.</p>
      </>}
      <button className="linkbtn" style={{ marginTop: 10 }} onClick={onOther}>{josa(member.name, '이', '가')} 아니에요</button>
    </div>
  );
}

/* ═══════════ 앱 ═══════════ */
function App() {
  const [hasKey, setHasKey] = useState(!!familyKey);
  const [me, setMeState] = useState(store.get('fz_me') || '');
  const [auth, setAuth] = useState('');   // '' 확인 중 · 'need' PIN 필요 · 'ok'
  const [loaded, setLoaded] = useState(false); const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState('home');
  const [toastMsg, setToastMsg] = useState('');
  const [D, setD] = useState({ members: [], posts: [], reactions: [], comments: [], notes: [], events: [], letters: [], questions: [], answers: [], bank: [], prayers: [], pmarks: [], nreacts: [], nreplies: [], polls: [], pvotes: [], creacts: [] });
  const [noteView, setNoteView] = useState(null);
  /* 알림 지우기: 이 폰에서만 숨긴다 (지운 알림 열쇠들 + "이때까지 모두 지움") */
  const [notiHide, setNotiHide] = useState(() => { try { const j = JSON.parse(store.get('fz_noti_hide') || '{}'); return { keys: j.keys || [], before: j.before || '' }; } catch (e) { return { keys: [], before: '' }; } });
  const saveHide = h => { setNotiHide(h); store.set('fz_noti_hide', JSON.stringify({ keys: h.keys.slice(-600), before: h.before })); };
  const [speaking, setSpeaking] = useState(null);
  const [fontSize, setFontSizeState] = useState(store.get('fz_fs') || 'm');
  const [seen, setSeen] = useState(() => { try { return JSON.parse(store.get('fz_story') || '[]'); } catch (e) { return []; } });
  const [prevSeen, setPrevSeen] = useState(() => store.get('fz_seen') || new Date(Date.now() - 3 * 864e5).toISOString());
  /* 창들 */
  const [composer, setComposer] = useState(null); const [cmtPost, setCmtPost] = useState(null); const [cmtMode, setCmtMode] = useState(''); const [cmtReply, setCmtReply] = useState(null);
  const [profile, setProfile] = useState(null); const [story, setStory] = useState(null); const [letterCfg, setLetterCfg] = useState(null);
  const [letterView, setLetterView] = useState(null); const [question, setQuestion] = useState(null); const [book, setBook] = useState(null);
  const [postView, setPostView] = useState(null); const [notiOpen, setNotiOpen] = useState(false); const [prayFocus, setPrayFocus] = useState(null); const [pollView, setPollView] = useState(null); const [pollNew, setPollNew] = useState(false);
  /* 알림을 누르고 들어온 주소(?post=… 등): 자료가 다 오면 그 소식을 연다 */
  const [linkReq, setLinkReq] = useState(() => /[?&](post|letter|q|story|pray|note|poll)=/.test(location.search) ? location.search : '');
  const [settings, setSettings] = useState(false); const [admin, setAdmin] = useState(false); const [lettersOpen, setLettersOpen] = useState(false); const [tagView, setTagView] = useState(null); const [memberEdit, setMemberEdit] = useState(null); const [ago, setAgo] = useState(null);
  const toastTimer = useRef(null);
  const toast = msg => { setToastMsg(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMsg(''), 3200); };

  useEffect(() => { document.documentElement.style.fontSize = { m: '16px', l: '18px', xl: '20px' }[fontSize] || '16px'; }, [fontSize]);

  const loadAll = async () => {
    try {
      const [ms, ps, rs, cs, ns, es, ls, qs, as, bk, pr, pk, nr, ny, pl, pv, cr] = await Promise.all([
        db.list('members', 'select=*&order=sort,created_at,id'),
        db.list('posts', 'select=*&order=happened_on.desc,created_at.desc,id'),
        db.list('reactions', 'select=post_id,member_id,emoji,created_at&order=created_at,post_id,member_id,emoji'),
        db.list('comments', 'select=*&order=created_at,id'),
        db.list('notes', 'select=*&order=created_at,id'),
        db.list('events', 'select=*&order=event_date,id'),
        db.list('letters', 'select=*&order=created_at.desc,id'),
        db.list('questions', 'select=*&order=week_start.desc,id'),
        db.list('answers', 'select=*&order=created_at,id'),
        db.list('question_bank', 'select=*&order=created_at,id').catch(() => []),
        db.list('prayers', 'select=*&order=created_at.desc,id').catch(() => []),
        db.list('prayer_marks', 'select=*&order=created_at,prayer_id,member_id,day').catch(() => []),
        db.list('note_reacts', 'select=*&order=created_at,note_id,member_id').catch(() => []),
        db.list('note_replies', 'select=*&order=created_at,id').catch(() => []),
        db.list('polls', 'select=*&order=created_at.desc,id').catch(() => []),
        db.list('poll_votes', 'select=*&order=created_at,poll_id,member_id,opt').catch(() => []),
        db.list('comment_reacts', 'select=*&order=created_at,comment_id,member_id').catch(() => [])
      ]);
      if (!ms.length && !(await db.rpc('is_family'))) { leave('가족 암호가 바뀌었어요. 새 암호를 넣어 주세요.'); return; }
      setD({ members: ms, posts: ps.map(p => ({ ...p, tagged: p.tagged || [], photos: photosOf(p) })), reactions: rs, comments: cs, notes: ns, events: es, letters: ls, questions: qs, answers: as, bank: bk, prayers: pr, pmarks: pk, nreacts: nr, nreplies: ny, polls: pl, pvotes: pv, creacts: cr });
      setLoaded(true); setLoadErr('');
      return { ms, qs };
    } catch (e) { setLoadErr(navigator.onLine === false ? '인터넷이 끊겨 있어요' : e.message); toast(navigator.onLine === false ? '인터넷 연결을 확인해 주세요' : '가족 공간을 읽지 못했어요: ' + e.message); }
  };
  const write = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg); await loadAll(); return true; }
    catch (e) { toast('저장하지 못했어요: ' + e.message); return false; }
  };

  /* 이번 주 질문이 없으면 만든다 (식구가 돌아가며 받는다) */
  /* 이번 주 질문 줄이 없으면 서버 함수가 만든다 (지난 질문자의 다음 식구가 질문자) */
  const ensureWeekly = async (ms, qs) => {
    if (!ms || !ms.length || qs.some(q => q.week_start === weekStart())) return;
    try { await db.rpc('ensure_week_q'); await loadAll(); } catch (e) {}
  };
  /* 매일 한 번 드라이브로 백업 (창구 v2 이상일 때만) */
  const runBackup = async manual => {
    try {
      if ((await gwVersion()) < 2) { if (manual) toast('사진 창구 스크립트를 새 버전으로 배포해야 해요'); return false; }
      const tables = ['members', 'posts', 'reactions', 'comments', 'notes', 'events', 'letters', 'questions', 'answers', 'question_bank', 'prayers', 'prayer_marks', 'memories', 'wishes', 'event_tasks', 'visits', 'views', 'app_settings', 'note_reacts', 'note_replies', 'polls', 'poll_votes', 'comment_reacts'];
      const all = await Promise.all(tables.map(t => db.list(t, t === 'reactions' ? 'select=*&order=post_id,member_id,emoji' : t === 'prayer_marks' ? 'select=*&order=prayer_id,member_id,day' : t === 'poll_votes' ? 'select=*&order=poll_id,member_id,opt' : t === 'comment_reacts' ? 'select=*&order=comment_id,member_id' : t === 'visits' ? 'select=*&order=member_id,day' : t === 'views' ? 'select=*&order=item_id,member_id' : t === 'app_settings' ? 'select=*&order=k' : t === 'note_reacts' ? 'select=*&order=note_id,member_id' : undefined).catch(() => [])));
      const data = { app: 'THE FAMILY ZONE', saved_at: new Date().toISOString(), by: me };
      tables.forEach((t, i) => data[t] = all[i]);
      await gw('backup', { day: ymd(), data: JSON.stringify(data) });
      store.set('fz_bk', ymd());
      if (manual) toast('드라이브에 백업했어요');
      return true;
    } catch (e) { if (manual) toast('백업하지 못했어요: ' + e.message); return false; }
  };

  useEffect(() => {
    if (!hasKey) return;
    loadAll().then(r => {
      if (!r) return;
      ensureWeekly(r.ms, r.qs);
      if (store.get('fz_bk') !== ymd()) setTimeout(() => runBackup(false), 4000);
    });
  }, [hasKey]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && familyKey) { clearBadge(); ensurePush(store.get('fz_me')); logVisit(store.get('fz_me')); }
      if (document.visibilityState === 'hidden') { store.set('fz_seen', new Date().toISOString()); if (window.speechSynthesis) window.speechSynthesis.cancel(); }
      if (document.visibilityState === 'visible' && familyKey) { setPrevSeen(store.get('fz_seen') || prevSeen); loadAll(); }
    };
    document.addEventListener('visibilitychange', onVis);
    const onOnline = () => { if (familyKey) loadAll(); };   // 인터넷이 다시 연결되면 새로 불러오기
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', () => store.set('fz_seen', new Date().toISOString()));
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); };
  }, []);

  const setMe = id => { if (id !== store.get('fz_me')) { store.del('fz_tok'); memberTok = ''; } store.set('fz_me', id); setMeState(id); setAuth(''); };
  /* 이 폰의 열쇠가 고른 식구와 맞는지 서버에 묻는다 (안 맞거나 없으면 PIN 화면) */
  useEffect(() => {
    if (!loaded || !me || auth) return;
    if (!memberTok) { setAuth('need'); return; }
    db.rpc('whoami').then(w => { if (w === me) setAuth('ok'); else { store.del('fz_tok'); memberTok = ''; setAuth('need'); } }).catch(() => setAuth('ok'));
  }, [loaded, me, auth]);
  const leave = msg => { store.del('fz_key'); store.del('fz_me'); store.del('fz_tok'); memberTok = ''; familyKey = ''; setMeState(''); setLoaded(false); setHasKey(false); if (msg) toast(msg); };

  /* ── 계산해 두는 것들 ── */
  const today = ymd();
  const memberMap = useMemo(() => { const m = {}; D.members.forEach(x => m[x.id] = x); return m; }, [D.members]);
  const getM = id => memberMap[id] || { id, name: '(떠난 식구)', emoji: '👤', color: '#999' };
  /* 반응 표 하나에 좋아요와 보관(🔖)을 함께 적는다 */
  const likesMap = useMemo(() => { const m = {}; D.reactions.filter(r => r.emoji !== SAVE).forEach(r => (m[r.post_id] = m[r.post_id] || []).includes(r.member_id) || m[r.post_id].push(r.member_id)); return m; }, [D.reactions]);
  const reactMap = useMemo(() => { const m = {}; D.reactions.filter(r => r.emoji !== SAVE).forEach(r => { const a = m[r.post_id] = m[r.post_id] || []; const i = a.findIndex(x => x.member_id === r.member_id); if (i < 0) a.push(r); else if ((r.created_at || '') >= (a[i].created_at || '')) a[i] = r; }); return m; }, [D.reactions]);
  const savedSet = useMemo(() => new Set(D.reactions.filter(r => r.emoji === SAVE && r.member_id === me).map(r => r.post_id)), [D.reactions, me]);
  const cmtMap = useMemo(() => { const m = {}; D.comments.forEach(c => (m[c.post_id] = m[c.post_id] || []).push(c)); return m; }, [D.comments]);
  const posts = useMemo(() => D.posts.map(p => ({ ...p, isNew: p.author_id !== me && p.created_at > prevSeen })), [D.posts, me, prevSeen]);
  const allEvents = useMemo(() => [...D.events, ...D.members.map(birthdayEvent).filter(Boolean)], [D.events, D.members]);
  const dailyToday = id => posts.filter(p => p.kind === 'daily' && p.author_id === id && p.happened_on === today).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const bdayDays = id => { const m = memberMap[id]; const ev = m && birthdayEvent(m); const n = ev && nextOccur(ev, today); return n ? dayDiff(today, n) : null; };
  const storyRing = id => {
    const bd = bdayDays(id); if (bd !== null && bd <= 7) return 'bday';
    const ds = dailyToday(id); if (!ds.length) return null;
    return ds.every(p => seen.includes(p.id)) ? 'seen' : 'new';
  };
  const unread = D.letters.filter(l => l.receiver_id === me && !l.read_at && !isLocked(l)).length;
  const weekQ = D.questions.find(q => q.week_start === weekStart()) || null;
  const activity = useMemo(() => {
    const out = []; const two = new Date(Date.now() - 14 * 864e5).toISOString(); const since = prevSeen < two ? prevSeen : two;
    posts.filter(p => p.author_id !== me && p.created_at > since && !isLocked(p)).forEach(p => out.push({ key: 'p' + p.id, who: p.author_id, t: p.created_at, text: `${josa(getM(p.author_id).name, '이', '가')} ${p.kind === 'daily' ? '오늘의 한 장을' : '새 소식을'} 올렸어요`, thumb: photosOf(p)[0] && photosOf(p)[0].thumb, go: () => p.kind === 'daily' ? setStory(dailyToday(p.author_id)) : setCmtPost(p) }));
    D.comments.filter(c => c.author_id !== me && c.created_at > since).forEach(c => {
      const p = posts.find(x => x.id === c.post_id); if (!p) return;
      const par = c.parent_id && D.comments.find(x => x.id === c.parent_id);
      const toMe = par && (par.author_id === me || D.comments.some(x => x.parent_id === par.id && x.author_id === me));   // 내 댓글에 달린 답글, 내가 답글 단 줄
      if (toMe) out.push({ key: 'c' + c.id, who: c.author_id, t: c.created_at, text: `${josa(getM(c.author_id).name, '이', '가')} 내 댓글에 답글을 달았어요${c.content ? `: ${c.content.slice(0, 30)}` : ''}`, go: () => { setCmtReply(null); setCmtPost(p); } });
      else if (p.author_id === me || (cmtMap[p.id] || []).some(x => x.author_id === me)) out.push({ key: 'c' + c.id, who: c.author_id, t: c.created_at, text: `${josa(getM(c.author_id).name, '이', '가')} ${par ? '답글' : c.audio_url ? '목소리 댓글' : '댓글'}을 남겼어요${c.content ? `: ${c.content.slice(0, 30)}` : ''}`, go: () => { setCmtReply(null); setCmtPost(p); } });
    });
    D.reactions.filter(r => r.emoji !== SAVE && r.member_id !== me && r.created_at > since).forEach(r => { const p = posts.find(x => x.id === r.post_id); if (p && p.author_id === me) out.push({ key: 'r' + r.post_id + r.member_id, who: r.member_id, t: r.created_at, text: `${josa(getM(r.member_id).name, '이', '가')} 내 소식에 ${r.emoji} ${reactWord(r.emoji)}`, thumb: photosOf(p)[0] && photosOf(p)[0].thumb, go: () => setCmtPost(p) }); });
    D.letters.filter(l => l.receiver_id === me && !l.read_at && !isLocked(l)).forEach(l => out.push({ key: 'l' + l.id, who: l.sender_id, t: l.created_at, unread: true, text: `${josa(getM(l.sender_id).name, '이', '가')} 편지를 보냈어요 💌`, go: () => setLetterView(l) }));
    D.prayers.filter(p => p.author_id !== me && p.created_at > since).forEach(p => out.push({ key: 'pr' + p.id, who: p.author_id, t: p.created_at, text: `${josa(getM(p.author_id).name, '이', '가')} ${p.kind === 'prayer' ? '목소리 기도를 남겼어요 🎙' : '기도 제목을 나눴어요 🙏'}${p.content ? ` “${p.content.slice(0, 30)}”` : ''}`, go: () => { setNotiOpen(false); setTab('pray'); setPrayFocus(p.id); } }));
    D.prayers.filter(p => p.answered_at && p.author_id !== me && p.answered_at > since).forEach(p => out.push({ key: 'pa' + p.id, who: p.author_id, t: p.answered_at, text: `✨ ${getM(p.author_id).name}의 기도가 응답됐어요${p.answer_note ? ` “${p.answer_note.slice(0, 30)}”` : ''}`, go: () => { setNotiOpen(false); setTab('pray'); setPrayFocus(p.id); } }));
    D.pmarks.filter(k => k.member_id !== me && k.created_at > since).forEach(k => { const p = D.prayers.find(x => x.id === k.prayer_id); if (p && p.author_id === me) out.push({ key: 'pk' + k.prayer_id + k.member_id + k.day, who: k.member_id, t: k.created_at, text: `${josa(getM(k.member_id).name, '이', '가')} 내 기도 제목으로 함께 기도했어요 🙏`, go: () => { setNotiOpen(false); setTab('pray'); setPrayFocus(p.id); } }); });
    D.questions.filter(q => q.text && q.asker_id && q.asker_id !== me && q.picked_at && q.picked_at > since).forEach(q => out.push({ key: 'q' + q.id, who: q.asker_id, t: q.picked_at, text: `${josa(getM(q.asker_id).name, '이', '가')} 이번 주 질문을 냈어요 ❓ “${q.text.slice(0, 30)}”`, go: () => setQuestion(q) }));
    D.answers.filter(a => a.member_id !== me && a.created_at > since).forEach(a => out.push({ key: 'a' + a.id, who: a.member_id, t: a.created_at, text: `${josa(getM(a.member_id).name, '이', '가')} 이번 주 질문에 답했어요`, go: () => setQuestion(D.questions.find(q => q.id === a.question_id) || weekQ) }));
    D.nreplies.filter(y => y.author_id !== me && y.created_at > since).forEach(y => { const n = D.notes.find(x => x.id === y.note_id); if (n && (n.author_id === me || D.nreplies.some(z => z.note_id === n.id && z.author_id === me))) out.push({ key: 'ny' + y.id, who: y.author_id, t: y.created_at, text: `${josa(getM(y.author_id).name, '이', '가')} 냉장고 메모에 답했어요 📌 “${y.content.slice(0, 30)}”`, go: () => { setNotiOpen(false); setNoteView(n); } }); });
    D.nreacts.filter(r => r.member_id !== me && r.created_at > since).forEach(r => { const n = D.notes.find(x => x.id === r.note_id); if (n && n.author_id === me) out.push({ key: 'nr' + r.note_id + r.member_id, who: r.member_id, t: r.created_at, text: `${josa(getM(r.member_id).name, '이', '가')} 내 메모에 ${r.emoji} ${reactWord(r.emoji)}`, go: () => { setNotiOpen(false); setNoteView(n); } }); });
    D.polls.filter(p => p.author_id !== me && p.created_at > since).forEach(p => out.push({ key: 'v' + p.id, who: p.author_id, t: p.created_at, text: `${josa(getM(p.author_id).name, '이', '가')} 투표를 올렸어요 🗳 “${p.question.slice(0, 30)}”`, go: () => { setNotiOpen(false); setPollView(p.id); } }));
    D.polls.filter(p => p.closed_at && p.author_id !== me && p.closed_at > since).forEach(p => out.push({ key: 'vc' + p.id, who: p.author_id, t: p.closed_at, text: `🏁 투표가 끝났어요 “${p.question.slice(0, 30)}”`, go: () => { setNotiOpen(false); setPollView(p.id); } }));
    D.pvotes.filter(v => v.member_id !== me && v.created_at > since).forEach(v => { const p = D.polls.find(x => x.id === v.poll_id); if (p && p.author_id === me) out.push({ key: 'vv' + v.poll_id + v.member_id + v.opt, who: v.member_id, t: v.created_at, text: `${josa(getM(v.member_id).name, '이', '가')} 내 투표에 골랐어요 🗳 “${p.question.slice(0, 24)}”`, go: () => { setNotiOpen(false); setPollView(p.id); } }); });
    D.creacts.filter(r => r.member_id !== me && r.created_at > since).forEach(r => { const c = D.comments.find(x => x.id === r.comment_id); const p = c && posts.find(x => x.id === c.post_id); if (p && c.author_id === me) out.push({ key: 'cr' + r.comment_id + r.member_id, who: r.member_id, t: r.created_at, text: `${josa(getM(r.member_id).name, '이', '가')} 내 댓글에 ${r.emoji} ${reactWord(r.emoji)}${c.content ? ` “${c.content.slice(0, 24)}”` : ''}`, go: () => { setCmtReply(null); setCmtPost(p); } }); });
    const hid = new Set(notiHide.keys);
    return out.filter(x => !hid.has(x.key) && !(notiHide.before && x.t <= notiHide.before)).map(x => ({ ...x, isNew: x.unread || x.t > prevSeen })).sort((a, b) => b.t.localeCompare(a.t));
  }, [posts, D, me, prevSeen, notiHide]);
  const newCount = activity.filter(x => x.isNew).length;

  const C = {
    me, members: D.members, posts, comments: D.comments, notes: D.notes, letters: D.letters, questions: D.questions, answers: D.answers,
    allEvents, getM, unread, weekQ, activity, speaking, fontSize, bank: D.bank,
    likesOf: id => likesMap[id] || [], reactsOf: id => reactMap[id] || [], myReact: id => ((reactMap[id] || []).find(r => r.member_id === me) || {}).emoji || null, commentsOf: id => cmtMap[id] || [],
    dailyToday, bdayDays, storyRing, toast, write, setTab: t => goTab(t), runBackup, newCount,
    markSeen: id => setSeen(s => { if (s.includes(id)) return s; const n = [...s, id].slice(-300); store.set('fz_story', JSON.stringify(n)); return n; }),
    setFontSize: k => { store.set('fz_fs', k); setFontSizeState(k); },
    toggleSpeak: (key, text) => { if (speaking === key) { window.speechSynthesis && window.speechSynthesis.cancel(); setSpeaking(null); return; } if (speak(text, () => setSpeaking(s => s === key ? null : s))) setSpeaking(key); },
    react: async (p, emoji) => {   // 같은 걸 다시 고르면 지우고, 다른 걸 고르면 바꾼다
      const cur = ((reactMap[p.id] || []).find(r => r.member_id === me) || {}).emoji;
      const off = cur === emoji;
      setD(d => ({ ...d, reactions: [...d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me && r.emoji !== SAVE)), ...(off ? [] : [{ post_id: p.id, member_id: me, emoji, created_at: new Date().toISOString() }])] }));
      try {
        if (cur) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=neq.${encodeURIComponent(SAVE)}`);
        if (!off) await db.add('reactions', { post_id: p.id, member_id: me, emoji });
      } catch (e) { toast('마음을 저장하지 못했어요'); loadAll(); }
    },
    toggleLike: async p => {
      const had = (likesMap[p.id] || []).includes(me);
      setD(d => ({ ...d, reactions: had ? d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me)) : [...d.reactions, { post_id: p.id, member_id: me, emoji: '❤️', created_at: new Date().toISOString() }] }));
      try { if (had) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=neq.${encodeURIComponent(SAVE)}`); else await db.add('reactions', { post_id: p.id, member_id: me, emoji: '❤️' }); }
      catch (e) { toast('좋아요를 저장하지 못했어요'); loadAll(); }
    },
    isSaved: id => savedSet.has(id),
    toggleSave: async p => {
      const had = savedSet.has(p.id);
      setD(d => ({ ...d, reactions: had ? d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me && r.emoji === SAVE)) : [...d.reactions, { post_id: p.id, member_id: me, emoji: SAVE, created_at: new Date().toISOString() }] }));
      toast(had ? '보관함에서 뺐어요' : '보관했어요 · 내 프로필 → 보관에서 다시 볼 수 있어요');
      try { if (had) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=eq.${encodeURIComponent(SAVE)}`); else await db.add('reactions', { post_id: p.id, member_id: me, emoji: SAVE }); }
      catch (e) { toast('보관하지 못했어요'); loadAll(); }
    },
    /* 보내기: 폰의 공유 창(카톡 등)으로 글과 사진 주소를 보낸다 */
    sharePost: async p => {
      const a = getM(p.author_id); const ph = photosOf(p)[0];
      const text = `${a.name}의 소식${p.title ? ` · ${p.title}` : ''}\n${p.content || ''}`.trim();
      try {
        if (navigator.share) { await navigator.share({ title: 'Familygram', text, url: ph ? ph.url : undefined }); return; }
        await navigator.clipboard.writeText(ph ? `${text}\n${ph.url}` : text); toast('글을 복사했어요. 카톡에 붙여 넣으세요');
      } catch (e) { if (e && e.name !== 'AbortError') toast('보내지 못했어요'); }
    },
    addComment: row => write(() => db.add('comments', row)),
    deleteComment: c => { if (window.confirm(D.comments.some(x => x.parent_id === c.id) ? '이 댓글을 지울까요? 달린 답글도 함께 지워져요.' : c.parent_id ? '이 답글을 지울까요?' : '이 댓글을 지울까요?')) { write(() => db.del('comments', `id=eq.${c.id}`), '댓글을 지웠어요'); const id = driveId(c.audio_url); if (id) gw('delete', { id }).catch(() => {}); } },
    deletePost: async p => {
      if (!window.confirm('이 소식을 지울까요? 댓글도 함께 지워져요. (사진은 구글 드라이브에 그대로 남아요)')) return;
      const files = (cmtMap[p.id] || []).map(c => driveId(c.audio_url)).filter(Boolean);   // 사진(줄인 것·원본)은 드라이브에 남긴다 (사용자 요청) · 목소리 댓글만 정리
      const plays = photosOf(p).map(ph => ph.play_path).filter(Boolean);   // 동영상 틀기용 한 벌은 가족 서버에서 지운다 (드라이브엔 남음)
      if (await write(() => db.del('posts', `id=eq.${p.id}`), '소식을 지웠어요')) { files.forEach(id => gw('delete', { id }).catch(() => {})); if (plays.length) vfn('del', { paths: plays }).catch(() => {}); }
    },
    addNote: content => write(() => db.add('notes', { author_id: me, content, color: '#FFF6B8', angle: +(Math.random() * 4 - 2).toFixed(1) })),
    deleteNote: n => write(() => db.del('notes', `id=eq.${n.id}`)),
    deleteEvent: ev => { if (window.confirm(`"${ev.title}" 일정을 지울까요?`)) write(() => db.del('events', `id=eq.${ev.id}`), '일정을 지웠어요'); },
    markRead: l => db.patch('letters', l.id, { read_at: new Date().toISOString() }).then(loadAll).catch(() => {}),
    deleteLetter: async l => { if (!window.confirm('이 편지를 지울까요?')) return; setLetterView(null); if (await write(() => db.del('letters', `id=eq.${l.id}`), '편지를 지웠어요')) { const id = driveId(l.audio_url); if (id) gw('delete', { id }).catch(() => {}); } },
    deleteMember: async m => {
      if (D.members.length <= 1) { toast('마지막 한 명은 뺄 수 없어요'); return; }
      if (!window.confirm(`${josa(m.name, '을', '를')} 명단에서 뺄까요?\n쓴 소식과 편지는 남아요.`)) return;
      if (await write(() => db.del('members', `id=eq.${m.id}`), `${josa(m.name, '을', '를')} 명단에서 뺐어요`)) { setMemberEdit(null); setProfile(null); }
    },
    changeKey: async (ko, kn) => {
      const k = kn.trim(); if (k.length < 6) { toast('새 암호는 6자 이상이에요'); return false; }
      try { await db.rpc('set_family_key', { new_key: k, old_key: ko.trim() }); familyKey = k; store.set('fz_key', k); toast('가족 암호를 바꿨어요. 다른 폰은 새 암호를 넣어야 해요.'); return true; }
      catch (e) { toast(e.message); return false; }
    },
    leave: () => leave(), changeMe: () => setMe(''),
    openComposer: cfg => setComposer(cfg || {}), openComments: (p, mode, reply) => { setCmtMode(mode || ''); setCmtReply(reply || null); setCmtPost(p); },
    repliesOf: id => D.comments.filter(c => c.parent_id === id),
    commentReactsOf: id => D.creacts.filter(r => r.comment_id === id),
    reactComment: async (c, emoji) => {   // 댓글마다 한 사람 한 마음 (냉장고 메모와 같은 방식)
      const cur = (D.creacts.find(r => r.comment_id === c.id && r.member_id === me) || {}).emoji; const off = cur === emoji;
      setD(d => ({ ...d, creacts: [...d.creacts.filter(r => !(r.comment_id === c.id && r.member_id === me)), ...(off ? [] : [{ comment_id: c.id, member_id: me, emoji, created_at: new Date().toISOString() }])] }));
      try { if (cur) await db.del('comment_reacts', `comment_id=eq.${c.id}&member_id=eq.${me}`); if (!off) await db.add('comment_reacts', { comment_id: c.id, member_id: me, emoji }); }
      catch (e) { toast('마음을 저장하지 못했어요'); loadAll(); }
    },
    openProfile: id => setProfile(id), openStory: items => items && items.length && setStory(items), openLetterCompose: cfg => setLetterCfg(cfg || {}),
    openLetter: l => setLetterView(l), openQuestion: q => setQuestion(q), openBook: y => setBook(y), openSettings: () => setSettings(true), reload: loadAll,
    hideNoti: key => saveHide({ ...notiHide, keys: [...notiHide.keys, key] }),
    clearNoti: () => saveHide({ keys: [], before: new Date().toISOString() }),
    openNote: n => setNoteView(n),
    noteReactsOf: id => D.nreacts.filter(r => r.note_id === id),
    noteRepliesOf: id => D.nreplies.filter(r => r.note_id === id),
    reactNote: async (n, emoji) => {   // 메모마다 한 사람 한 마음: 같은 걸 다시 누르면 지우고, 다른 걸 누르면 바꾼다
      const cur = (D.nreacts.find(r => r.note_id === n.id && r.member_id === me) || {}).emoji; const off = cur === emoji;
      setD(d => ({ ...d, nreacts: [...d.nreacts.filter(r => !(r.note_id === n.id && r.member_id === me)), ...(off ? [] : [{ note_id: n.id, member_id: me, emoji, created_at: new Date().toISOString() }])] }));
      try { if (cur) await db.del('note_reacts', `note_id=eq.${n.id}&member_id=eq.${me}`); if (!off) await db.add('note_reacts', { note_id: n.id, member_id: me, emoji }); }
      catch (e) { toast('마음을 저장하지 못했어요'); loadAll(); }
    },
    replyNote: (n, content) => write(() => db.add('note_replies', { note_id: n.id, author_id: me, content }), '답글을 남겼어요'),
    editNoteReply: (r, content) => write(() => db.patch('note_replies', r.id, { content, edited_at: new Date().toISOString() }), '답글을 수정했어요'),
    editComment: (c, content) => write(() => db.patch('comments', c.id, { content, edited_at: new Date().toISOString() }), '댓글을 수정했어요'),
    deleteNoteReply: r => { if (window.confirm('이 답글을 지울까요?')) write(() => db.del('note_replies', `id=eq.${r.id}`), '답글을 지웠어요'); }, openAdmin: () => setAdmin(true), isAdmin: !!(memberMap[me] && memberMap[me].is_admin),
    openLetters: () => setLettersOpen(true), openNoti: () => setNotiOpen(true), prayers: D.prayers, pmarks: D.pmarks, prayFocus,
    openPray: id => { setTab('pray'); setPrayFocus(id); },
    /* 🙏 기도했어요: 오늘 한 번 (다시 누르면 취소) */
    togglePray: async p => {
      const day = ymd(); const had = D.pmarks.some(m => m.prayer_id === p.id && m.member_id === me && m.day === day);
      setD(d => ({ ...d, pmarks: had ? d.pmarks.filter(m => !(m.prayer_id === p.id && m.member_id === me && m.day === day)) : [...d.pmarks, { prayer_id: p.id, member_id: me, day, created_at: new Date().toISOString() }] }));
      if (!had) toast('함께 기도했어요 🙏');
      try { if (had) await db.del('prayer_marks', `prayer_id=eq.${p.id}&member_id=eq.${me}&day=eq.${day}`); else await db.add('prayer_marks', { prayer_id: p.id, member_id: me, day }); }
      catch (e) { toast('저장하지 못했어요'); loadAll(); }
    }, openTag: t => setTagView(t), openMemberEdit: m => setMemberEdit(m), openAgo: items => setAgo(items),
    polls: D.polls, votesOf: id => D.pvotes.filter(v => v.poll_id === id), openPoll: id => setPollView(id), newPoll: () => { setComposer(null); setPollNew(true); },
    /* 🗳 고르기: 하나만 고르는 투표는 바꿔 고르고(같은 걸 다시 누르면 취소), 여러 개는 하나씩 켜고 끈다. 기타는 글과 함께 */
    vote: async (p, opt, text) => {
      const cur = D.pvotes.filter(v => v.poll_id === p.id && v.member_id === me);
      let next;
      if (opt === 'other') next = [...(p.multi ? cur.filter(v => v.opt !== 'other') : []), ...(text ? [{ opt, other_text: text }] : [])];
      else if (cur.some(v => v.opt === opt)) next = cur.filter(v => v.opt !== opt);
      else next = [...(p.multi ? cur : []), { opt }];
      const key = v => v.opt + '|' + (v.other_text || '');
      const ck = new Set(cur.map(key)), nk = new Set(next.map(key));
      const gone = cur.filter(v => !nk.has(key(v))), add = next.filter(v => !ck.has(key(v))).map(v => ({ poll_id: p.id, member_id: me, opt: v.opt, other_text: v.other_text || null }));
      const now = new Date().toISOString();
      setD(d => ({ ...d, pvotes: [...d.pvotes.filter(v => !(v.poll_id === p.id && v.member_id === me && !nk.has(key(v)))), ...add.map(r => ({ ...r, created_at: now }))] }));
      try {
        for (const v of gone) await db.del('poll_votes', `poll_id=eq.${p.id}&member_id=eq.${me}&opt=eq.${encodeURIComponent(v.opt)}`);
        if (add.length) await db.add('poll_votes', add);
        if (add.length && !cur.length) toast('투표했어요 🗳');
        return true;
      } catch (e) { toast('투표를 저장하지 못했어요: ' + e.message); loadAll(); return false; }
    }
  };

  /* 알림: 앱을 열면 숫자 지우기 / 이 폰 주인이 바뀌면 알림 주소의 식구도 바꾸기 / 알림 눌러 열기 */
  useEffect(() => {
    if (!loaded || !me) return;
    clearBadge();
    ensurePush(me); logVisit(me);
  }, [loaded, me]);
  useEffect(() => {
    if (!PUSH_OK) return;
    const f = e => { if (e.data && e.data.type === 'fz-resub') { store.del('fz_push_ep'); ensurePush(store.get('fz_me')); return; } if (e.data && e.data.type === 'fz-open') loadAll().then(() => setLinkReq(new URL(e.data.url).search)); };
    navigator.serviceWorker.addEventListener('message', f);
    return () => navigator.serviceWorker.removeEventListener('message', f);
  }, []);
  useEffect(() => {
    if (!loaded || !linkReq || !D.members.some(m => m.id === me)) return;
    const q = new URLSearchParams(linkReq); setLinkReq('');
    history.replaceState(history.state, '', location.pathname);
    const post = q.get('post') && posts.find(p => p.id === q.get('post'));
    if (post) { if (q.get('c')) { setCmtMode(''); setCmtPost(post); } else setPostView(post.id); }
    const l = q.get('letter') && D.letters.find(x => x.id === q.get('letter')); if (l) setLetterView(l);
    const qq = q.get('q') && D.questions.find(x => x.id === q.get('q')); if (qq) setQuestion(qq);
    const sid = q.get('story'); if (sid) { const it = dailyToday(sid); if (it.length) setStory(it); }
    const pid = q.get('pray'); if (pid) { setTab('pray'); setPrayFocus(pid); }
    const nid = q.get('note'); if (nid) { const n = D.notes.find(x => x.id === nid); if (n) setNoteView(n); }
    const vid = q.get('poll'); if (vid) setPollView(vid);
  }, [loaded, linkReq, me, D]);

  /* 폰 뒤로가기: 홈이 아닌 탭(달력·기도·내 프로필)에서는 홈으로, 홈에서는 앱이 닫힌다.
     홈이 아닌 탭을 창 하나처럼 쌓아 두면, 뒤로가기가 열린 창 → 탭 → (홈이면 기록이 없어) 앱 종료 순으로 간다 */
  useLayer(tab !== 'home', () => { setTab('home'); window.scrollTo(0, 0); });

  if (!hasKey) return <Gate onEnter={() => setHasKey(true)}/>;
  if (!loaded) return (
    <div className="gate"><div className="brand">Familygram<LIcon name="heart" size={26} fill="#ED4956" stroke="#ED4956"/></div>
      {loadErr
        ? <div style={{ textAlign: 'center' }}><p style={{ margin: '14px 0 4px', fontWeight: 700 }}>가족 소식을 불러오지 못했어요</p><p className="small muted" style={{ margin: '0 0 14px' }}>{loadErr}. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.</p><button className="btn primary" onClick={() => { setLoadErr(''); loadAll(); }}>다시 불러오기</button></div>
        : <p className="muted"><span className="spin dark"/> 가족 소식을 펼치는 중…</p>}
    </div>);
  if (!D.members.some(m => m.id === me)) return <PickMe members={D.members} onPick={id => setMe(id)} onLeave={() => leave()}/>;
  if (auth === 'need') return <PinGate member={D.members.find(m => m.id === me)} onDone={tok => { store.set('fz_tok', tok); memberTok = tok; setAuth('ok'); logVisit(me); }} onOther={() => setMe('')}/>;
  if (!auth) return <div className="gate"><div className="brand">Familygram<LIcon name="heart" size={26} fill="#ED4956" stroke="#ED4956"/></div><p className="muted"><span className="spin dark"/></p></div>;

  /* 알림 탭을 떠날 때 "여기까지 봤어요" 로 적는다 */
  const goTab = t => { setTab(t); if (t !== 'pray') setPrayFocus(null); };
  /* 알림 창을 닫을 때 "여기까지 봤어요" 로 적는다 */
  const closeNoti = () => { setNotiOpen(false); const now = new Date().toISOString(); store.set('fz_seen', now); setPrevSeen(now); };
  const me0 = getM(me);
  return (
    <Ctx.Provider value={C}>
      <div className="app">
        {tab === 'home' && <HomeTab/>}
        {tab === 'cal' && <CalendarTab/>}
        {tab === 'pray' && <PrayTab/>}
        {tab === 'me' && <MeTab/>}
        {/* 아래 메뉴: 바닥에 붙은 하얀 막대, 가는 선 아이콘. 가운데 새 소식은 까만 둥근 네모 ＋ (떠 있는 막대는 따로 노는 느낌이라 사용자가 되돌림) */}
        <nav className="tabbar" aria-label="아래 메뉴">
          {[['home', 'house', '홈'], ['cal', 'calendar-days', '달력']].map(([k, ic, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => { if (k === 'home' && tab === 'home') window.scrollTo({ top: 0, behavior: 'smooth' }); goTab(k); }}>
              <span className="tb-ic"><LIcon name={ic} size={23} sw={tab === k ? 2.1 : 1.6}/></span><span className="tb-l">{l}</span>
            </button>))}
          <button className="tb-add" onClick={() => setComposer({})} aria-label="새 소식 올리기">
            <span className="tb-plus"><LIcon name="plus" size={20} sw={2.4}/></span><span className="tb-l">새 소식</span>
          </button>
          <button className={tab === 'pray' ? 'on' : ''} aria-current={tab === 'pray' ? 'page' : undefined} onClick={() => goTab('pray')}>
            <span className="tb-ic"><LIcon name="hand-heart" size={23} sw={tab === 'pray' ? 2.1 : 1.6}/></span><span className="tb-l">기도</span>
          </button>
          <button className={tab === 'me' ? 'on' : ''} aria-current={tab === 'me' ? 'page' : undefined} onClick={() => goTab('me')}>
            <span className="tb-ic">{me0.avatar ? <span className="me-av"><Avatar m={me0} size={24}/></span> : <LIcon name="circle-user-round" size={23} sw={tab === 'me' ? 2.1 : 1.6}/>}</span><span className="tb-l">내 프로필</span>
          </button>
        </nav>
      </div>
      <ProfilePage mid={profile} onClose={() => setProfile(null)}/>
      <AgoPage items={ago} onClose={() => setAgo(null)}/>
      <Composer cfg={composer} onClose={() => setComposer(null)}/>
      <CommentsSheet post={cmtPost} mode={cmtMode} reply={cmtReply} onClose={() => { setCmtPost(null); setCmtReply(null); }}/>
      <LetterCompose cfg={letterCfg} onClose={() => setLetterCfg(null)}/>
      <LetterView l={letterView} onClose={() => setLetterView(null)}/>
      <QuestionSheet q={question} onClose={() => setQuestion(null)}/>
      <MemberEdit m={memberEdit} onClose={() => setMemberEdit(null)}/>
      <SettingsSheet open={settings} onClose={() => setSettings(false)}/>
      <AdminSheet open={admin} onClose={() => setAdmin(false)}/>
      <LettersPage open={lettersOpen} onClose={() => setLettersOpen(false)}/>
      <TagPage tag={tagView} onClose={() => setTagView(null)}/>
      <NotiPage open={notiOpen} onClose={closeNoti}/>
      <NoteSheet note={noteView} onClose={() => setNoteView(null)}/>
      <Page open={!!postView} onClose={() => setPostView(null)} title="소식">{postView && (posts.find(p => p.id === postView) ? <PostCard p={posts.find(p => p.id === postView)}/> : <p className="empty">지워진 소식이에요.</p>)}</Page>
      <Page open={!!pollView} onClose={() => setPollView(null)} title="가족 투표"><div style={{ height: 8 }}/>{pollView && (D.polls.find(p => p.id === pollView) ? <PollCard p={D.polls.find(p => p.id === pollView)}/> : <p className="empty">지워진 투표예요.</p>)}</Page>
      <PollCompose open={pollNew} onClose={() => setPollNew(false)}/>
      <StoryViewer items={story} onClose={() => setStory(null)}/>
      <BookView year={book} onClose={() => setBook(null)}/>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
