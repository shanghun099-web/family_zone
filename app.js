/* 이 파일은 src/app.jsx 에서 만들어져요 (npm run build). 여기를 직접 고치지 마세요 */
const {
  useState,
  useEffect,
  useRef,
  useMemo,
  useContext,
  createContext
} = React;

/* ── 아이콘 (lucide 0.460 고정) ── */
const LIcon = ({
  name,
  size = 24,
  fill,
  stroke,
  sw
}) => {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.innerHTML = '';
    const pascal = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const icon = lucide.icons && lucide.icons[pascal] || lucide[pascal];
    if (!icon) return;
    const el = lucide.createElement(icon);
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    if (fill) el.setAttribute('fill', fill);
    if (stroke) el.setAttribute('stroke', stroke);
    if (sw) el.setAttribute('stroke-width', sw);
    box.appendChild(el);
  }, [name, size, fill, stroke, sw]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      lineHeight: 0
    }
  });
};

/* ── 가족 공간 (Supabase) ──
   모든 표는 가족 암호로 잠겨 있다. 앱은 요청마다 x-family-key 헤더로 암호를 보내고,
   서버가 맞는 암호일 때만 읽고 쓰게 한다. 아래 키는 공개용이라 코드에 있어도 괜찮다. */
const SB_URL = 'https://ijpbmlphaanmqnsixckt.supabase.co';
const SB_KEY = 'sb_publishable_lZIA-d3DTswNZOKdhEn4iw_W8k7BDQl';
/* 사진·목소리·백업 창구 (내 구글 드라이브, Apps Script) */
const GW_URL = 'https://script.google.com/macros/s/AKfycbxogoYj6R2QqWwkcO0JibLlszlJTZHeM0Oldq2GhllyoPevi3IJT8CA-PgSiESHk3WASQ/exec';
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }
};
let familyKey = store.get('fz_key') || '';
let memberTok = store.get('fz_tok') || ''; // 이 폰이 누구인지 증명하는 열쇠 (개인 PIN 으로 받음)

async function sb(path, opt = {}) {
  const headers = {
    apikey: SB_KEY,
    'Content-Type': 'application/json'
  };
  if (familyKey) headers['x-family-key'] = familyKey;
  if (memberTok) headers['x-member-token'] = memberTok;
  if (opt.prefer) headers.Prefer = opt.prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opt.method || 'GET',
    headers,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!res.ok) throw new Error(data && data.message || `서버 오류 (${res.status})`);
  return data;
}
/* 서버는 한 번에 1000줄까지만 준다 → 1000줄씩 받아서 끝날 때까지 이어 붙인다 (순서는 order 로 고정) */
const PAGE = 1000;
async function listAll(t, q) {
  const out = [];
  for (let off = 0;; off += PAGE) {
    const rows = await sb(`${t}?${q}&limit=${PAGE}&offset=${off}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
const db = {
  list: (t, q = 'select=*&order=id') => listAll(t, q),
  add: (t, row) => sb(t, {
    method: 'POST',
    body: row,
    prefer: 'return=representation'
  }),
  addOnce: (t, row, conflict) => sb(`${t}?on_conflict=${conflict}`, {
    method: 'POST',
    body: row,
    prefer: 'resolution=ignore-duplicates,return=representation'
  }),
  upsert: (t, row, conflict) => sb(`${t}?on_conflict=${conflict}`, {
    method: 'POST',
    body: row,
    prefer: 'resolution=merge-duplicates,return=representation'
  }),
  patch: (t, id, patch) => sb(`${t}?id=eq.${id}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation'
  }),
  del: (t, filter) => sb(`${t}?${filter}`, {
    method: 'DELETE'
  }),
  rpc: (fn, args = {}) => sb(`rpc/${fn}`, {
    method: 'POST',
    body: args
  })
};
/* {ok:false,error} 로 답하는 서버 함수 (PIN 틀린 횟수가 남게 예외 대신 결과로 답함) */
const rpcOk = async (fn, args) => {
  const r = await db.rpc(fn, args);
  if (!r || r.ok === false) throw new Error(r && r.error || '서버가 거절했어요');
  return r;
};

/* 창구: 헤더 없는 text/plain POST (Apps Script 가 받는 방식) */
async function gw(action, payload = {}) {
  const res = await fetch(GW_URL, {
    method: 'POST',
    body: JSON.stringify({
      action,
      key: familyKey,
      ...payload
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '사진 창구 오류');
  return j;
}
let gwVer = null;
async function gwVersion() {
  if (gwVer !== null) return gwVer;
  try {
    const j = await (await fetch(GW_URL)).json();
    gwVer = j.v || 1;
  } catch (e) {
    gwVer = 0;
  }
  return gwVer;
}

/* 사진: 올리기 전에 폰에서 줄인다 (긴 변 1600px, 장당 300KB 안팎) */
async function shrinkImage(file, max = 1600, q = 0.82) {
  let src;
  try {
    src = await createImageBitmap(file, {
      imageOrientation: 'from-image'
    });
  } catch (e) {
    src = await new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('사진을 읽지 못했어요'));
      img.src = URL.createObjectURL(file);
    });
  }
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * k),
    h = Math.round(src.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  return {
    blob,
    w,
    h
  };
}
const blobToB64 = blob => new Promise((ok, no) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(',')[1]);
  fr.onerror = no;
  fr.readAsDataURL(blob);
});
async function uploadPhoto(file, max, keepOrig) {
  const {
    blob,
    w,
    h
  } = await shrinkImage(file, max);
  const r = await gw('upload', {
    kind: 'photo',
    name: (file.name || '사진').replace(/\.\w+$/, ''),
    mime: 'image/jpeg',
    data: await blobToB64(blob)
  });
  const orig = keepOrig ? await uploadOriginal(file) : null;
  return {
    id: r.id,
    url: r.url,
    thumb: r.thumb,
    w,
    h,
    ...(orig ? {
      orig
    } : {})
  };
}
/* 원본: 줄이지 않은 파일 그대로 드라이브 "사진" 폴더에 "원본_…"으로 한 장 더 (인쇄용·찍은 날짜와 장소 보관). 실패해도 소식은 올라간다 */
async function uploadOriginal(file) {
  if (!file || !file.size || file.size > 45e6) return null;
  try {
    const mime = /^image\//.test(file.type || '') ? file.type : 'image/jpeg';
    const r = await gw('upload', {
      kind: 'photo',
      name: '원본_' + (file.name || '사진').replace(/\.\w+$/, ''),
      mime,
      data: await blobToB64(file)
    });
    return r.id || null;
  } catch (e) {
    return null;
  }
}
/* ── 동영상 (사진 창구 v3) ──
   창구가 드라이브 "이어 올리기" 자리를 열어 주면, 폰이 8MB씩 나눠 바로 보낸다.
   폰이 바로 못 보내면(브라우저가 막으면) 창구가 조각을 받아 대신 보낸다. 원본 그대로 "동영상" 폴더에 쌓인다 */
const VIDEO_MAX = 1.5e9;
const VCHUNK = 8 * 1024 * 1024; // 256KB 의 배수여야 한다
const VIDEO_PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#2b2b2b"/><circle cx="450" cy="600" r="90" fill="rgba(255,255,255,.18)"/><path d="M420 545v110l95-55z" fill="#fff"/></svg>');
const isVideo = ph => ph && ph.type === 'video';
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
/* 첫 장면 한 장을 떠서 목록에 사진처럼 보여 준다 (못 뜨면 검은 ▶ 그림) */
function videoPoster(file) {
  return new Promise((ok, no) => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(file);
    let done = false;
    const end = (r, e) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      URL.revokeObjectURL(u);
      r ? ok(r) : no(e || new Error('첫 장면을 뜨지 못했어요'));
    };
    const t = setTimeout(() => end(null), 9000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.6, (v.duration || 1) / 3);
    };
    v.onseeked = () => {
      try {
        const k = Math.min(1, 1600 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * k);
        c.height = Math.round(v.videoHeight * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => end(b && {
          blob: b,
          w: c.width,
          h: c.height,
          dur: Math.round(v.duration || 0)
        }), 'image/jpeg', 0.82);
      } catch (e) {
        end(null, e);
      }
    };
    v.onerror = () => end(null);
    v.src = u;
  });
}
async function uploadVideo(file, onPct) {
  const mime = /^video\//.test(file.type || '') ? file.type : 'video/mp4';
  const pv = await videoPoster(file).catch(() => null);
  let poster = null;
  if (pv) try {
    poster = await gw('upload', {
      kind: 'photo',
      name: '동영상 첫 장면',
      mime: 'image/jpeg',
      data: await blobToB64(pv.blob)
    });
  } catch (e) {}
  const name = (file.name || '동영상').replace(/\.\w+$/, '');
  let {
    url
  } = await gw('vstart', {
    name,
    mime,
    size: file.size,
    origin: location.origin
  });
  let direct = true,
    id = null;
  for (let start = 0; start < file.size;) {
    const part = file.slice(start, Math.min(file.size, start + VCHUNK));
    const last = start + part.size - 1;
    let r = null;
    for (let tryN = 0; !r && tryN < 3; tryN++) {
      try {
        if (direct) {
          const res = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Range': `bytes ${start}-${last}/${file.size}`
            },
            body: part
          });
          if (res.status === 308) r = {
            done: false
          };else if (res.ok) r = {
            done: true,
            id: (await res.json()).id
          };else throw new Error('서버 ' + res.status);
        } else r = await gw('vchunk', {
          url,
          start,
          total: file.size,
          data: await blobToB64(part)
        });
      } catch (e) {
        if (direct && start === 0) {
          direct = false;
          url = (await gw('vstart', {
            name,
            mime,
            size: file.size,
            origin: location.origin
          })).url;
          tryN = -1;
          continue;
        } // 폰이 바로 못 보내면 새 자리를 열어 창구로
        if (tryN === 2) throw new Error('동영상을 다 보내지 못했어요. 와이파이에서 다시 해 주세요');
        await new Promise(w => setTimeout(w, 1500));
      }
    }
    start = last + 1;
    onPct && onPct(Math.round(start / file.size * 100));
    if (r.done) id = r.id;
  }
  if (!id) throw new Error('동영상 파일을 만들지 못했어요');
  await gw('vdone', {
    id
  });
  return {
    type: 'video',
    vid: id,
    id: poster ? poster.id : null,
    url: poster ? poster.url : VIDEO_PH,
    thumb: poster ? poster.thumb : VIDEO_PH,
    w: pv ? pv.w : 900,
    h: pv ? pv.h : 1200,
    dur: pv ? pv.dur : 0,
    mime,
    size: file.size
  };
}
/* 목소리: 드라이브에 비공개로 두고 "drive:파일ID#초" 로 적어 둔다 */
async function uploadVoice(blob, sec) {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const r = await gw('upload', {
    kind: 'voice',
    name: '목소리',
    mime,
    data: await blobToB64(blob)
  });
  return `drive:${r.id}#${Math.round(sec || 0)}`;
}
const driveId = u => String(u || '').startsWith('drive:') ? u.slice(6).split('#')[0] : '';
const voiceSec = u => {
  const m = String(u || '').match(/#(\d+)/);
  return m ? +m[1] : 0;
};
const voiceCache = {};
async function voiceSrc(u) {
  const id = driveId(u);
  if (voiceCache[id]) return voiceCache[id];
  const r = await gw('get', {
    id
  });
  const bin = atob(r.data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return voiceCache[id] = URL.createObjectURL(new Blob([arr], {
    type: r.mime
  }));
}
const fmtSec = s => {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/* ── 날짜: 전부 이 기기(한국) 날짜 기준. toISOString 은 UTC 라 쓰지 않는다 ── */
const pad = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addYears = (s, n) => {
  const d = parseYmd(s);
  d.setFullYear(d.getFullYear() + n);
  return ymd(d);
};
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5); // b - a (일)
const weekStart = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - (x.getDay() + 6) % 7);
  return ymd(x);
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDate = (s, withYear) => {
  if (!s) return '';
  const d = parseYmd(s);
  const show = withYear || d.getFullYear() !== new Date().getFullYear();
  return `${show ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`;
};
const fmtDot = s => s ? s.replace(/-/g, '.') : '';
function relDay(day, createdAt) {
  const diff = dayDiff(day, ymd());
  if (diff === 0) {
    if (createdAt) {
      const m = Math.floor((Date.now() - new Date(createdAt)) / 60000);
      if (m < 1) return '방금';
      if (m < 60) return `${m}분 전`;
      if (m < 24 * 60) return `${Math.floor(m / 60)}시간 전`;
    }
    return '오늘';
  }
  if (diff === 1) return '어제';
  if (diff > 1 && diff < 7) return `${diff}일 전`;
  return fmtDate(day);
}
const relTime = iso => relDay(ymd(new Date(iso)), iso);
const ageOn = (birth, on) => {
  const b = parseYmd(birth),
    o = parseYmd(on);
  let a = o.getFullYear() - b.getFullYear();
  if (o.getMonth() < b.getMonth() || o.getMonth() === b.getMonth() && o.getDate() < b.getDate()) a--;
  return a;
};
/* 받침에 맞는 조사: josa('지우','이','가') → '지우가' */
const josa = (w, a, b) => {
  w = String(w || '');
  const c = w.charCodeAt(w.length - 1);
  return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b);
};
const ddayText = n => n === 0 ? '오늘' : n > 0 ? `D-${n}` : `D+${-n}`;

/* ── 음력: 브라우저에 든 한국 달력(dangi)으로 바꾼다 ── */
const LUNAR_FMT = (() => {
  try {
    return new Intl.DateTimeFormat('ko-KR-u-ca-dangi', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  } catch (e) {
    return null;
  }
})();
function lunarOf(d) {
  if (!LUNAR_FMT) return null;
  const p = {};
  LUNAR_FMT.formatToParts(d).forEach(x => p[x.type] = x.value);
  const mm = String(p.month || '');
  return {
    y: +(p.relatedYear || p.year),
    m: parseInt(mm.replace(/\D/g, ''), 10),
    d: parseInt(p.day, 10),
    leap: /윤/.test(mm)
  };
}
const lunarYearCache = {};
function lunarYear(Y) {
  // 음력 Y년의 (월-일 → 양력 날짜) 표
  if (lunarYearCache[Y]) return lunarYearCache[Y];
  const map = {};
  let d = new Date(Y, 0, 10);
  for (let i = 0; i < 420; i++) {
    const l = lunarOf(d);
    if (!l) break;
    if (l.y > Y) break;
    if (l.y === Y && !l.leap) {
      const k = l.m + '-' + l.d;
      if (!map[k]) map[k] = ymd(d);
    }
    d = addDays(d, 1);
  }
  return lunarYearCache[Y] = map;
}
function solarOfLunar(Y, m, d) {
  const map = lunarYear(Y);
  return map[m + '-' + d] || (d === 30 ? map[m + '-29'] : null) || null;
}
const lunarText = s => {
  const l = lunarOf(parseYmd(s));
  return l ? `음 ${l.leap ? '윤' : ''}${l.m}.${l.d}` : '';
};

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
  for (const y of [Y, Y + 1]) {
    const hit = occurIn(ev, y).filter(s => s >= from).sort()[0];
    if (hit) return hit;
  }
  return null;
}
/* 식구 생일 → 달력용 일정 */
function birthdayEvent(m) {
  if (!m.birth_date) return null;
  const base = {
    id: 'bd-' + m.id,
    title: `${m.name} 생일`,
    kind: 'birthday',
    member_id: m.id,
    yearly: true,
    virtual: true
  };
  if (m.bday_lunar) {
    const l = lunarOf(parseYmd(m.birth_date));
    if (l) return {
      ...base,
      calendar: 'lunar',
      lunar_month: l.m,
      lunar_day: l.d
    };
  }
  return {
    ...base,
    calendar: 'solar',
    event_date: m.birth_date
  };
}
/* 공휴일 (설·추석·부처님오신날은 음력으로 계산, 대체공휴일은 뺌) */
const holCache = {};
function holidays(Y) {
  if (holCache[Y]) return holCache[Y];
  const h = {};
  const put = (s, n) => {
    if (s) h[s] = h[s] ? h[s] + '·' + n : n;
  };
  [['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'], ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '성탄절']].forEach(([md, n]) => put(`${Y}-${md}`, n));
  const sl = solarOfLunar(Y, 1, 1);
  if (sl) {
    put(ymd(addDays(parseYmd(sl), -1)), '설 연휴');
    put(sl, '설날');
    put(ymd(addDays(parseYmd(sl), 1)), '설 연휴');
  }
  const ch = solarOfLunar(Y, 8, 15);
  if (ch) {
    put(ymd(addDays(parseYmd(ch), -1)), '추석 연휴');
    put(ch, '추석');
    put(ymd(addDays(parseYmd(ch), 1)), '추석 연휴');
  }
  put(solarOfLunar(Y, 4, 8), '부처님오신날');
  return holCache[Y] = h;
}

/* 이번 주의 질문: 질문 상자(기본 50개 + 식구가 넣은 것)는 DB question_bank 표에 있다 */

/* ── 휴대폰 뒤로가기 = 맨 위 창 닫기 ── */
/* 창을 열면 기록 한 칸을 쌓고, 화면에서 닫으면 그 칸을 되돌린다.
   history.back() 은 늦게 끝나므로, 되돌리는 중에 새 창이 열리면 쌓기를 잠깐 미뤘다가 한다 */
const layerStack = [];
let pendingBack = 0;
let queuedPush = 0;
const histPush = () => {
  if (pendingBack > 0) queuedPush++;else history.pushState({
    fz: 1
  }, '');
};
const histBack = () => {
  pendingBack++;
  history.back();
};
window.addEventListener('popstate', () => {
  if (pendingBack > 0) {
    pendingBack--;
    if (!pendingBack) for (; queuedPush > 0; queuedPush--) history.pushState({
      fz: 1
    }, '');
    return;
  }
  const top = layerStack.pop();
  if (top) top.close();
});
function useLayer(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const me = {
      close: () => {
        me.popped = true;
        closeRef.current();
      }
    };
    layerStack.push(me);
    histPush();
    return () => {
      const i = layerStack.indexOf(me);
      if (i >= 0) layerStack.splice(i, 1);
      if (me.popped) return;
      if (queuedPush > 0) queuedPush--;else histBack();
    };
  }, [open]);
}

/* ── 말하기 → 글 (브라우저 음성 인식) ── */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function useDictation(append) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  const appendRef = useRef(append);
  appendRef.current = append;
  const toggle = () => {
    if (!SR) {
      alert('이 폰에서는 말로 쓰기가 안 돼요. 크롬이나 사파리에서 열어 주세요.');
      return;
    }
    if (ref.current) {
      ref.current.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) appendRef.current(e.results[i][0].transcript.trim());
    };
    rec.onend = () => {
      ref.current = null;
      setOn(false);
    };
    rec.onerror = ev => {
      if (ev.error === 'not-allowed') alert('마이크 사용을 허락해 주세요.');
    };
    ref.current = rec;
    try {
      rec.start();
      setOn(true);
    } catch (e) {
      ref.current = null;
    }
  };
  useEffect(() => () => {
    if (ref.current) ref.current.stop();
  }, []);
  return {
    on,
    toggle
  };
}
const joinText = (s, t) => (s && s.trim() ? s.replace(/\s+$/, '') + ' ' : '') + t;

/* ── 목소리 녹음 (녹음하면서 받아쓰기도 같이 시도) ── */
function useRecorder() {
  const [on, setOn] = useState(false);
  const [sec, setSec] = useState(0);
  const [live, setLive] = useState('');
  const r = useRef({});
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, mime ? {
      mimeType: mime
    } : undefined);
    const c = {
      stream,
      mr,
      chunks: [],
      t0: Date.now(),
      text: '',
      live: '',
      restarts: 0
    };
    mr.ondataavailable = e => {
      if (e.data && e.data.size) c.chunks.push(e.data);
    };
    r.current = c;
    mr.start(500);
    c.timer = setInterval(() => setSec(Math.round((Date.now() - c.t0) / 1000)), 500);
    if (SR) {
      try {
        const rec = new SR();
        rec.lang = 'ko-KR';
        rec.continuous = true;
        rec.interimResults = true;
        let done = '';
        rec.onresult = e => {
          let fin = '',
            tmp = '';
          for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) fin += t + ' ';else tmp += t;
          }
          c.text = (done + fin).trim();
          c.live = (done + fin + tmp).trim();
          setLive(c.live);
        };
        rec.onend = () => {
          done = c.text ? c.text + ' ' : done;
          if (c.rec === rec && mr.state === 'recording' && c.restarts++ < 15) {
            try {
              rec.start();
            } catch (e) {}
          }
        };
        rec.onerror = () => {};
        rec.start();
        c.rec = rec;
      } catch (e) {}
    }
    setSec(0);
    setLive('');
    setOn(true);
  };
  const finish = keep => new Promise(ok => {
    const c = r.current;
    if (!c.mr) return ok(null);
    clearInterval(c.timer);
    const rec = c.rec;
    c.rec = null;
    if (rec) {
      try {
        rec.stop();
      } catch (e) {}
    }
    c.mr.onstop = () => {
      c.stream.getTracks().forEach(t => t.stop());
      setOn(false);
      r.current = {};
      ok(keep ? {
        blob: new Blob(c.chunks, {
          type: c.mr.mimeType || 'audio/webm'
        }),
        sec: Math.max(1, Math.round((Date.now() - c.t0) / 1000)),
        text: (c.text || c.live || '').trim()
      } : null);
    };
    c.mr.stop();
  });
  useEffect(() => () => {
    const c = r.current;
    if (c.mr && c.mr.state !== 'inactive') {
      clearInterval(c.timer);
      try {
        c.mr.stop();
      } catch (e) {}
      c.stream.getTracks().forEach(t => t.stop());
    }
  }, []);
  return {
    on,
    sec,
    live,
    start,
    stop: () => finish(true),
    cancel: () => finish(false)
  };
}

/* ── 소리 내어 읽어 주기 ── */
function speak(text, onEnd) {
  const s = window.speechSynthesis;
  if (!s) {
    alert('이 폰은 읽어 주기를 지원하지 않아요.');
    return false;
  }
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.92;
  const ko = s.getVoices().find(v => /ko/i.test(v.lang));
  if (ko) u.voice = ko;
  u.onend = u.onerror = () => onEnd && onEnd();
  s.speak(u);
  return true;
}

/* ── 앱으로 설치 ──
   크롬 155 는 같은 주소(github.io)에 다른 앱이 깔려 있으면 메뉴의 설치를 막아 버린다.
   페이지가 받은 설치 신호(beforeinstallprompt)로 직접 설치 창을 띄우면 그래도 깔린다.
   아이폰은 이 신호가 없어서 사파리 "홈 화면에 추가" 안내만 보여 준다. */
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump(x => x + 1);
    addEventListener('fz-inst', f);
    return () => removeEventListener('fz-inst', f);
  }, []);
  const standalone = isStandalone() || !!window.__installed;
  return {
    standalone,
    ios: IS_IOS && !standalone,
    can: !standalone && !!window.__inst,
    install: async () => {
      const e = window.__inst;
      if (!e) return false;
      e.prompt();
      const c = await e.userChoice;
      window.__inst = null;
      dispatchEvent(new Event('fz-inst'));
      return c.outcome === 'accepted';
    }
  };
}
function InstallCard({
  inSettings
}) {
  const C = useC();
  const I = useInstall();
  const [hide, setHide] = useState(() => !inSettings && store.get('fz_inst_hide') > ymd());
  if (I.standalone || hide || !I.can && !I.ios && !inSettings) return null;
  const body = I.can ? '홈 화면 아이콘으로 바로 열려요. 주소창 없이 앱처럼 쓸 수 있어요.' : I.ios ? /*#__PURE__*/React.createElement(React.Fragment, null, "\uC0AC\uD30C\uB9AC \uC544\uB798\uCABD ", /*#__PURE__*/React.createElement("b", null, "\uACF5\uC720 \uBC84\uD2BC(\u25A1\u2191)"), " \u2192 ", /*#__PURE__*/React.createElement("b", null, "\uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00"), "\uB97C \uB20C\uB7EC \uC8FC\uC138\uC694.") : /*#__PURE__*/React.createElement(React.Fragment, null, "\uD06C\uB86C \uC624\uB978\uCABD \uC704 ", /*#__PURE__*/React.createElement("b", null, "\u22EE \u2192 \uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00"), "\uB97C \uB20C\uB7EC \uC8FC\uC138\uC694.");
  return /*#__PURE__*/React.createElement("div", {
    className: inSettings ? '' : 'banner',
    style: inSettings ? {
      background: '#f6f6f6',
      borderRadius: 14,
      padding: 12
    } : {
      alignItems: 'flex-start'
    }
  }, !inSettings && /*#__PURE__*/React.createElement("img", {
    src: "icon-192.png?v=2",
    alt: "",
    style: {
      width: 44,
      height: 44,
      borderRadius: 12,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, !inSettings && /*#__PURE__*/React.createElement("b", null, "Familygram\uC744 \uC571\uC73C\uB85C \uC124\uCE58"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: '.9rem',
      color: 'var(--sub)',
      margin: '2px 0 8px'
    }
  }, body), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, I.can && /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    onClick: async () => {
      if (await I.install()) C.toast('설치했어요. 홈 화면의 Familygram 아이콘으로 열어 보세요');
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "download",
    size: 18
  }), "\uC571\uC73C\uB85C \uC124\uCE58"), !inSettings && /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => {
      store.set('fz_inst_hide', ymd(addDays(new Date(), 14)));
      setHide(true);
    }
  }, "\uB098\uC911\uC5D0"))));
}

/* ── 폰 알림 (Web Push) ──
   "알림 받기"를 누르면 이 폰의 알림 주소를 push_subs 표에 적는다. 식구가 무언가 올리면
   Supabase 의 notify 함수가 그 주소로 알림을 보내고, sw.js 가 폰 알림으로 띄운다.
   밤 10시~아침 8시 것은 서버가 모아 두었다가 아침에 보낸다. */
const VAPID_PUB = 'BCXSOfWZ11rtXk2VdgjbGEs_-sR8G4lKgN9w7Rqkd0VPSsF2WYaPEHfy7MYPVIRDTVkvd3cm23Pa_FDVG0r3RLY';
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const swReady = PUSH_OK ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);
const b64u = s => {
  const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
/* 이 폰을 구분하는 값 (알림 주소가 새로 생기면 같은 폰의 옛 주소를 지우는 데 쓴다) */
const deviceId = (() => {
  let d = store.get('fz_dev');
  if (!d) {
    d = Math.random().toString(36).slice(2, 12);
    store.set('fz_dev', d);
  }
  return d;
})();
const savePushSub = async (member, sub) => {
  const j = sub.toJSON();
  await db.upsert('push_subs', {
    member_id: member,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    device: deviceId,
    ua: navigator.userAgent.slice(0, 160)
  }, 'endpoint');
  await db.del('push_subs', `device=eq.${deviceId}&endpoint=neq.${encodeURIComponent(j.endpoint)}`).catch(() => {});
};
const pushSub = async () => {
  const reg = await swReady;
  return reg ? reg.pushManager.getSubscription() : null;
};
/* 알림 주소 저절로 고치기: 한 번 허용한 폰이면 앱을 열 때마다 확인해서, 주소가 없거나 서버가 만료로 지운 주소면
   묻지 않고 새 주소를 받아 적는다. (안드로이드 크롬은 앱 설치·업데이트 때 알림 주소를 가끔 바꾼다)
   "이 폰 알림 끄기"를 누른 폰(fz_push_off)은 건드리지 않는다 */
let ensuring = null;
const ensurePush = member => ensuring || (ensuring = (async () => {
  try {
    if (!PUSH_OK || !member || Notification.permission !== 'granted' || store.get('fz_push_off')) return false;
    const reg = await swReady;
    if (!reg) return false;
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const rows = await db.list('push_subs', `select=id&endpoint=eq.${encodeURIComponent(sub.endpoint)}&order=id`).catch(() => null);
      if (rows && !rows.length && store.get('fz_push_ep') === sub.endpoint) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      } // 서버가 만료로 지운 주소
    }
    if (!sub) sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64u(VAPID_PUB)
    });
    await savePushSub(member, sub);
    store.set('fz_push_ep', sub.endpoint);
    dispatchEvent(new Event('fz-push'));
    return true;
  } catch (e) {
    return false;
  } finally {
    ensuring = null;
  }
})());
const PUSH_PREFS = [['post', '새 소식 · 새 댓글 · 오늘의 한 장'], ['react', '내 소식에 남긴 마음 (❤️😂👍 …)'], ['letter', '편지 · 나에게 온 질문'], ['day', '생일 · 행사 하루 전 (아침 8시)'], ['pray', '함께 기도해요 (기도 제목 · 기도했어요 · 응답)'], ['quiet', '밤 10시~아침 8시는 조용히 (아침에 모아서)']];
function usePush() {
  const C = useC();
  const [st, setSt] = useState({
    ready: false,
    perm: PUSH_OK ? Notification.permission : 'unsupported',
    row: null,
    busy: false
  });
  const load = async () => {
    if (!PUSH_OK) {
      setSt(x => ({
        ...x,
        ready: true
      }));
      return;
    }
    const sub = await pushSub();
    let row = null;
    if (sub) {
      try {
        row = (await db.list('push_subs', `select=*&endpoint=eq.${encodeURIComponent(sub.endpoint)}&order=id`))[0] || null;
      } catch (e) {}
    }
    setSt(x => ({
      ...x,
      ready: true,
      perm: Notification.permission,
      row
    }));
  };
  useEffect(() => {
    load();
    const f = () => load();
    addEventListener('fz-push', f);
    return () => removeEventListener('fz-push', f);
  }, []);
  const on = async () => {
    setSt(x => ({
      ...x,
      busy: true
    }));
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        C.toast(perm === 'denied' ? '알림이 막혀 있어요. 폰 설정 → 애플리케이션 → Familygram(또는 크롬) → 알림을 켜 주세요' : '알림을 허락해야 받을 수 있어요');
        return;
      }
      if (!(await swReady)) throw new Error('이 폰은 알림을 지원하지 않아요');
      store.del('fz_push_off');
      if (!(await ensurePush(C.me))) throw new Error('알림 주소를 받지 못했어요. 잠시 뒤 다시 눌러 주세요');
      C.toast('알림을 켰어요 🔔 식구가 소식을 올리면 알려 드릴게요');
    } catch (e) {
      C.toast('알림을 켜지 못했어요: ' + e.message);
    } finally {
      setSt(x => ({
        ...x,
        busy: false
      }));
      dispatchEvent(new Event('fz-push'));
    }
  };
  const off = async () => {
    const sub = await pushSub();
    store.set('fz_push_off', '1'); // 일부러 끈 폰은 저절로 다시 켜지 않는다
    if (sub) {
      try {
        await db.del('push_subs', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`);
      } catch (e) {}
      await sub.unsubscribe().catch(() => {});
    }
    C.toast('이 폰의 알림을 껐어요');
    dispatchEvent(new Event('fz-push'));
  };
  const setPref = async (k, v) => {
    const row = st.row;
    if (!row) return;
    const prefs = {
      ...row.prefs,
      [k]: v
    };
    setSt(x => ({
      ...x,
      row: {
        ...row,
        prefs
      }
    }));
    try {
      await db.patch('push_subs', row.id, {
        prefs
      });
    } catch (e) {
      C.toast('저장하지 못했어요');
    }
  };
  /* 서버를 거쳐 이 폰으로 진짜 알림 한 통 (알림이 잘 오는지 확인용) */
  const sample = async () => {
    const sub = await pushSub();
    if (!sub) {
      C.toast('알림이 꺼져 있어요. 알림 받기를 다시 눌러 주세요');
      dispatchEvent(new Event('fz-push'));
      return;
    }
    C.toast('시험 알림을 보냈어요. 몇 초 뒤 폰 맨 위를 보세요');
    try {
      const r = await fetch(`${SB_URL}/functions/v1/notify?mode=self`, {
        method: 'POST',
        body: JSON.stringify({
          endpoint: sub.endpoint
        })
      });
      if (!r.ok) {
        C.toast('알림 주소를 새로 받는 중이에요. 잠시 뒤 다시 눌러 주세요');
        await sub.unsubscribe().catch(() => {});
        store.del('fz_push_ep');
        ensurePush(C.me);
      }
    } catch (e) {
      C.toast('시험 알림을 보내지 못했어요: ' + e.message);
    }
  };
  return {
    ...st,
    supported: PUSH_OK,
    needsInstall: IS_IOS && !isStandalone(),
    on,
    off,
    setPref,
    sample
  };
}
/* 홈 위쪽 "알림 받기" 카드 (앱 설치 카드가 먼저 보일 땐 숨김) */
function PushCard() {
  const P = usePush();
  const I = useInstall();
  const [hide, setHide] = useState(() => store.get('fz_push_hide') > ymd());
  if (!P.ready || !P.supported || P.needsInstall || P.row || P.perm !== 'default' || hide || I.can) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "banner",
    style: {
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bic",
    style: {
      background: '#FFEDEE',
      color: '#ED4956'
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "bell-ring"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, "\uC0C8 \uC18C\uC2DD \uC54C\uB9BC \uBC1B\uAE30"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: '.9rem',
      color: 'var(--sub)',
      margin: '2px 0 8px'
    }
  }, "\uC2DD\uAD6C\uAC00 \uC18C\uC2DD\xB7\uB313\uAE00\xB7\uD3B8\uC9C0\uB97C \uB0A8\uAE30\uBA74 \uD3F0\uC5D0 \uC54C\uB824 \uB4DC\uB824\uC694. \uC571 \uC544\uC774\uCF58\uC5D0 \uC22B\uC790\uB3C4 \uB5A0\uC694."), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    disabled: P.busy,
    onClick: P.on
  }, P.busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "bell",
    size: 18
  }), "\uC54C\uB9BC \uBC1B\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => {
      store.set('fz_push_hide', ymd(addDays(new Date(), 14)));
      setHide(true);
    }
  }, "\uB098\uC911\uC5D0"))));
}
/* 설정 안의 알림 칸 */
function PushSettings() {
  const P = usePush();
  const box = {
    background: '#f6f6f6',
    borderRadius: 14,
    padding: 12,
    fontSize: '.95rem'
  };
  if (!P.ready) return /*#__PURE__*/React.createElement("div", {
    style: box
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), "\uD655\uC778\uD558\uB294 \uC911\u2026"));
  if (!P.supported) return /*#__PURE__*/React.createElement("div", {
    style: box
  }, "\uC774 \uD3F0(\uBE0C\uB77C\uC6B0\uC800)\uC740 \uC54C\uB9BC\uC744 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC544\uC694. \uD06C\uB86C\uC774\uB098 \uC0AC\uD30C\uB9AC\uC5D0\uC11C \uC5F4\uC5B4 \uC8FC\uC138\uC694.");
  if (P.needsInstall) return /*#__PURE__*/React.createElement("div", {
    style: box
  }, "\uC544\uC774\uD3F0\uC740 \uBA3C\uC800 \uC0AC\uD30C\uB9AC ", /*#__PURE__*/React.createElement("b", null, "\uACF5\uC720 \u2192 \uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00"), "\uB97C \uD558\uACE0, \uD648 \uD654\uBA74\uC758 Familygram \uC544\uC774\uCF58\uC73C\uB85C \uC5F0 \uB2E4\uC74C\uC5D0 \uC54C\uB9BC\uC744 \uCF24 \uC218 \uC788\uC5B4\uC694.");
  if (P.perm === 'denied') return /*#__PURE__*/React.createElement("div", {
    style: box
  }, "\uC54C\uB9BC\uC774 \uB9C9\uD600 \uC788\uC5B4\uC694. \uD3F0 ", /*#__PURE__*/React.createElement("b", null, "\uC124\uC815 \u2192 \uC560\uD50C\uB9AC\uCF00\uC774\uC158 \u2192 Familygram"), "(\uB610\uB294 \uD06C\uB86C) ", /*#__PURE__*/React.createElement("b", null, "\u2192 \uC54C\uB9BC"), "\uC744 \uCF20 \uB4A4 \uB2E4\uC2DC \uC640 \uC8FC\uC138\uC694.");
  if (!P.row) return /*#__PURE__*/React.createElement("div", {
    style: box
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, "\uC2DD\uAD6C\uAC00 \uC18C\uC2DD\xB7\uB313\uAE00\xB7\uD3B8\uC9C0\uB97C \uB0A8\uAE30\uBA74 \uC774 \uD3F0\uC5D0 \uC54C\uB824 \uB4DC\uB824\uC694."), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    disabled: P.busy,
    onClick: P.on
  }, P.busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "bell",
    size: 18
  }), "\uC54C\uB9BC \uBC1B\uAE30"));
  return /*#__PURE__*/React.createElement("div", {
    style: box
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "bell-ring",
    size: 18
  }), /*#__PURE__*/React.createElement("b", {
    className: "grow"
  }, "\uC774 \uD3F0\uC740 \uC54C\uB9BC\uC744 \uBC1B\uACE0 \uC788\uC5B4\uC694")), PUSH_PREFS.map(([k, l]) => /*#__PURE__*/React.createElement(Toggle, {
    key: k,
    on: P.row.prefs[k] !== false,
    onChange: v => P.setPref(k, v),
    label: l
  })), /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginTop: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: P.sample
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "bell",
    size: 16
  }), "\uB0B4 \uD3F0\uC73C\uB85C \uC2DC\uD5D8 \uC54C\uB9BC \uBC1B\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft danger",
    onClick: P.off
  }, "\uC774 \uD3F0 \uC54C\uB9BC \uB044\uAE30")), !IS_IOS && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '8px 0 0'
    }
  }, "\uAC24\uB7ED\uC2DC\uC5D0\uC11C \uC544\uC774\uCF58\uC5D0 \uC810 \uB300\uC2E0 \uC22B\uC790\uB85C \uBCF4\uB824\uBA74: \uD3F0 \uC124\uC815 \u2192 \uC54C\uB9BC \u2192 \uACE0\uAE09 \uC124\uC815 \u2192 \uC571 \uC544\uC774\uCF58 \uBC30\uC9C0 \u2192 \uC22B\uC790"));
}
/* 앱을 열면 아이콘 숫자·쌓인 알림을 지운다 */
function clearBadge() {
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  swReady.then(reg => reg && reg.getNotifications().then(ns => ns.forEach(n => n.close()))).catch(() => {});
  pushSub().then(sub => sub && db.rpc('push_seen', {
    p_endpoint: sub.endpoint
  })).catch(() => {});
}
const Ctx = createContext(null);
const useC = () => useContext(Ctx);
const SAVE = '🔖';
/* 소식에 남기는 마음: 한 사람당 하나. 하트는 한 번 누르기, 나머지는 하트를 누르면 뜨는 줄에서 고른다 */
const REACTS = [['❤️', '좋아요'], ['🥰', '사랑스러워요'], ['😂', '웃겨요'], ['👍', '최고예요'], ['😮', '놀라워요'], ['😢', '슬퍼요'], ['🙏', '기도해요'], ['🎉', '축하해요']];
const reactWord = e => (REACTS.find(x => x[0] === e) || [e, '마음을 남겼어요'])[1];
const isLocked = x => !!(x.open_on && x.open_on > ymd());
const photosOf = p => Array.isArray(p.photos) ? p.photos : [];

/* ═══════════ 작은 부품들 ═══════════ */
function Avatar({
  m,
  size = 32,
  ring,
  onClick
}) {
  const inner = /*#__PURE__*/React.createElement("div", {
    className: "av-in",
    style: {
      width: size,
      height: size,
      fontSize: size * 0.55,
      background: m.avatar ? '#eee' : (m.color || '#999') + '22'
    }
  }, m.avatar ? /*#__PURE__*/React.createElement("img", {
    src: m.avatar,
    alt: ""
  }) : m.emoji || '🙂');
  const Tag = onClick ? 'button' : 'div';
  if (!ring) return /*#__PURE__*/React.createElement(Tag, {
    className: "av",
    onClick: onClick,
    "aria-label": m.name
  }, inner);
  return /*#__PURE__*/React.createElement(Tag, {
    className: 'av ring ' + ring,
    onClick: onClick,
    "aria-label": m.name,
    style: {
      padding: size > 60 ? 3 : 2.5
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "av-gap"
  }, inner));
}
function VoicePlayer({
  src
}) {
  const [st, setSt] = useState('idle');
  const [pos, setPos] = useState(0);
  const au = useRef(null);
  const total = voiceSec(src);
  const toggle = async e => {
    if (e) e.stopPropagation();
    if (st === 'playing') {
      au.current.pause();
      return;
    }
    if (au.current) {
      au.current.play();
      return;
    }
    setSt('loading');
    try {
      const a = new Audio(await voiceSrc(src));
      au.current = a;
      a.ontimeupdate = () => setPos(a.currentTime);
      a.onplay = () => setSt('playing');
      a.onpause = () => setSt('paused');
      a.onended = () => {
        setSt('idle');
        setPos(0);
      };
      await a.play();
    } catch (err) {
      setSt('idle');
      au.current = null;
      alert('목소리를 불러오지 못했어요: ' + err.message);
    }
  };
  useEffect(() => () => {
    if (au.current) au.current.pause();
  }, []);
  const pct = total ? Math.min(100, pos / total * 100) : 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "vp"
  }, /*#__PURE__*/React.createElement("button", {
    className: "vp-b",
    onClick: toggle,
    "aria-label": st === 'playing' ? '멈추기' : '목소리 듣기'
  }, st === 'loading' ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: st === 'playing' ? 'pause' : 'play',
    size: 16,
    fill: "#fff",
    stroke: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    className: "wave"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: pct + '%'
    }
  })), /*#__PURE__*/React.createElement("small", null, fmtSec(st === 'idle' ? total : pos)));
}

/* 녹음 단추 → 다 하면 onDone({blob, sec, text}) */
function RecordButton({
  onDone,
  label = '목소리로 남기기',
  block
}) {
  const R = useRecorder();
  const [busy, setBusy] = useState(false);
  if (busy) return /*#__PURE__*/React.createElement("div", {
    className: "recbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), " \uBAA9\uC18C\uB9AC \uC62C\uB9AC\uB294 \uC911\u2026"));
  if (!R.on) return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'btn soft' + (block ? ' block' : ''),
    onClick: () => R.start().catch(e => alert('마이크를 쓸 수 없어요: ' + e.message))
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "mic",
    size: 20
  }), label);
  return /*#__PURE__*/React.createElement("div", {
    className: "recbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "recdot"
  }), /*#__PURE__*/React.createElement("b", null, fmtSec(R.sec)), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "\uB179\uC74C \uC911")), /*#__PURE__*/React.createElement("div", {
    className: "live"
  }, R.live || '편하게 말씀하세요…'), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn soft grow",
    onClick: R.cancel
  }, "\uCDE8\uC18C"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn accent grow",
    onClick: async () => {
      const r = await R.stop();
      if (!r) return;
      setBusy(true);
      try {
        await onDone(r);
      } finally {
        setBusy(false);
      }
    }
  }, "\uB2E4 \uD588\uC5B4\uC694")));
}
function MicButton({
  dict
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'btn sm ' + (dict.on ? 'accent' : 'soft'),
    onClick: dict.toggle
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "mic",
    size: 18
  }), dict.on ? '듣고 있어요… (누르면 끝)' : '말로 쓰기');
}
function Toggle({
  on,
  onChange,
  label,
  sub
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "switch",
    onClick: () => onChange(!on),
    style: {
      width: '100%',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      display: 'block',
      fontSize: '1rem'
    }
  }, label), sub && /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, sub)), /*#__PURE__*/React.createElement("span", {
    className: 'tgl' + (on ? ' on' : '')
  }));
}
function Sheet({
  open,
  onClose,
  title,
  right,
  children,
  footer,
  full
}) {
  useLayer(open, onClose);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "sheet-bg",
    onClick: e => {
      if (e.target === e.currentTarget) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: 'sheet' + (full ? ' full' : ''),
    role: "dialog",
    "aria-label": title
  }, /*#__PURE__*/React.createElement("div", {
    className: "sheet-hd"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onClose,
    "aria-label": "\uB2EB\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x"
  })), /*#__PURE__*/React.createElement("b", null, title), right || /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "sheet-bd"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "sheet-ft"
  }, footer)));
}
function Page({
  open,
  onClose,
  title,
  right,
  children
}) {
  useLayer(open, onClose);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topbar",
    style: {
      paddingLeft: 4
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onClose,
    "aria-label": "\uB4A4\uB85C"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-left",
    size: 28
  })), /*#__PURE__*/React.createElement("b", {
    className: "pt"
  }, title), right || /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44
    }
  })), children);
}

/* 타임캡슐 날짜 고르기 */
function CapsulePicker({
  on,
  setOn,
  date,
  setDate,
  member
}) {
  const today = ymd();
  const presets = [['1년 뒤', addYears(today, 1)], ['5년 뒤', addYears(today, 5)], ['10년 뒤', addYears(today, 10)]];
  if (member && member.birth_date) {
    const nb = nextOccur(birthdayEvent(member), ymd(addDays(new Date(), 1)));
    if (nb) presets.push([`${member.name} 다음 생일`, nb]);
    const a = ageOn(member.birth_date, today);
    if (a < 20) presets.push([`${member.name} 스무 살 생일`, addYears(member.birth_date, 20)]);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC5B8\uC81C \uBCF4\uC5EC \uC904\uAE4C\uC694?"), /*#__PURE__*/React.createElement("div", {
    className: "seg purple"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: !on ? 'on' : '',
    onClick: () => setOn(false)
  }, "\uC9C0\uAE08 \uBC14\uB85C"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: on ? 'on' : '',
    onClick: () => {
      setOn(true);
      if (!date) setDate(addYears(today, 1));
    }
  }, "\uD83D\uDD12 \uD0C0\uC784\uCEA1\uC290")), on && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 8
    }
  }, presets.map(([l, d]) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: l,
    className: 'chip' + (date === d ? ' pon' : ''),
    onClick: () => setDate(d)
  }, l))), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input",
    min: ymd(addDays(new Date(), 1)),
    value: date,
    onChange: e => setDate(e.target.value)
  }), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, date ? `${fmtDate(date, true)}까지는 봉투만 보이고, 그날 열려요.` : '')));
}

/* ═══════════ 소식 카드 ═══════════ */
function LockedCard({
  p,
  onPeek
}) {
  const C = useC();
  const a = C.getM(p.author_id);
  return /*#__PURE__*/React.createElement("div", {
    className: "post"
  }, /*#__PURE__*/React.createElement("div", {
    className: "post-hd"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: a,
    size: 34
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, a.name), " ", /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "\xB7 ", relDay(p.happened_on, p.created_at)))), /*#__PURE__*/React.createElement("div", {
    className: "locked"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lk"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "lock",
    size: 26
  })), /*#__PURE__*/React.createElement("b", null, a.name, "\uC758 \uD0C0\uC784\uCEA1\uC290"), /*#__PURE__*/React.createElement("p", null, fmtDate(p.open_on, true), "\uC5D0 \uC5F4\uB824\uC694 \xB7 ", ddayText(dayDiff(ymd(), p.open_on))), onPeek && /*#__PURE__*/React.createElement("button", {
    className: "btn sm line",
    style: {
      marginTop: 10,
      background: '#fff'
    },
    onClick: onPeek
  }, "\uB0B4\uAC00 \uC7A0\uADFC \uAC83 \xB7 \uBBF8\uB9AC \uBCF4\uAE30")));
}

/* 글 속 #해시태그는 파란 글씨, 누르면 같은 태그 소식만 모아 본다 */
const TAG_RE = /(#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)/g;
const tagsOf = text => [...new Set(String(text || '').match(TAG_RE) || [])];
function Tagged({
  text
}) {
  const C = useC();
  return String(text || '').split(TAG_RE).map((s, i) => i % 2 ? /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "htag",
    onClick: e => {
      e.stopPropagation();
      C.openTag(s);
    }
  }, s) : s);
}

/* 내 댓글·답글 수정: 글자만 고친다 (목소리 댓글은 받아 적은 글만) */
function EditLine({
  text,
  voice,
  onSave,
  onCancel
}) {
  const [t, setT] = useState(text || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!voice && !t.trim()) return;
    setBusy(true);
    if (!(await onSave(t.trim()))) setBusy(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "editline"
  }, /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 2,
    autoFocus: true,
    value: t,
    placeholder: voice ? '말한 내용 (선택)' : '',
    onChange: e => setT(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: onCancel
  }, "\uADF8\uB9CC\uB450\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    disabled: busy || !voice && !t.trim(),
    onClick: save
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : '저장')));
}
function CommentRow({
  c,
  onDelete
}) {
  const C = useC();
  const a = C.getM(c.author_id);
  const [editing, setEditing] = useState(false);
  const mine = c.author_id === C.me;
  return /*#__PURE__*/React.createElement("div", {
    className: "cmt"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: a,
    size: 28,
    onClick: () => C.openProfile(a.id)
  }), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", null, c.is_answer && /*#__PURE__*/React.createElement("span", {
    className: "tag-ans"
  }, "\uB2F5"), /*#__PURE__*/React.createElement("b", null, a.name), " ", c.content && !c.audio_url && !editing && /*#__PURE__*/React.createElement("span", null, c.content)), c.audio_url && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: c.audio_url
  }), c.content && !editing && /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      color: '#5b4a86'
    }
  }, "\u201C", c.content, "\u201D")), editing && /*#__PURE__*/React.createElement(EditLine, {
    text: c.content,
    voice: !!c.audio_url,
    onCancel: () => setEditing(false),
    onSave: async t => {
      const ok = await C.editComment(c, t);
      if (ok) setEditing(false);
      return ok;
    }
  }), !editing && /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", null, relTime(c.created_at)), mine && /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditing(true)
  }, "\uC218\uC815"), onDelete && mine && /*#__PURE__*/React.createElement("button", {
    onClick: () => onDelete(c)
  }, "\uC9C0\uC6B0\uAE30"))));
}
function PostCard({
  p
}) {
  const C = useC();
  const a = C.getM(p.author_id);
  const [idx, setIdx] = useState(0);
  const [pop, setPop] = useState(0);
  const [more, setMore] = useState(false);
  const [peek, setPeek] = useState(false);
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(-1);
  const [bar, setBar] = useState(false);
  const barT = useRef(0);
  const press = useRef(null);
  const lastTap = useRef(0);
  const vref = useRef(null);
  useViewed(vref, isLocked(p) ? null : p.id, 'post', p.author_id);
  useEffect(() => () => {
    clearTimeout(barT.current);
    clearTimeout(press.current);
  }, []);
  if (isLocked(p) && !peek) return /*#__PURE__*/React.createElement(LockedCard, {
    p: p,
    onPeek: p.author_id === C.me ? () => setPeek(true) : null
  });
  const photos = photosOf(p);
  const likes = C.likesOf(p.id);
  const iLike = likes.includes(C.me);
  const iSaved = C.isSaved(p.id);
  const reacts = C.reactsOf(p.id);
  const mine = C.myReact(p.id);
  const kinds = REACTS.map(x => x[0]).filter(e => reacts.some(r => r.emoji === e)).concat([...new Set(reacts.map(r => r.emoji))].filter(e => !REACTS.some(x => x[0] === e)));
  const showBar = ms => {
    clearTimeout(barT.current);
    setBar(true);
    if (ms) barT.current = setTimeout(() => setBar(false), ms);
  };
  const pick = e => {
    clearTimeout(barT.current);
    setBar(false);
    C.react(p, e);
  };
  /* 하트 한 번: 하트를 남기고 다른 마음 줄을 잠깐 보여 준다 · 이미 남겼으면 지운다 · 꾹 누르면 줄만 연다 */
  const heartTap = () => {
    if (press.current === 'long') {
      press.current = null;
      return;
    }
    if (bar) {
      setBar(false);
      return;
    }
    if (mine) C.react(p, mine);else {
      C.react(p, '❤️');
      showBar(4000);
    }
  };
  const heartDown = () => {
    clearTimeout(press.current);
    press.current = setTimeout(() => {
      press.current = 'long';
      showBar(0);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 450);
  };
  const heartUp = () => {
    if (press.current !== 'long') {
      clearTimeout(press.current);
      press.current = null;
    }
  };
  const comments = C.commentsOf(p.id);
  const answers = comments.filter(c => c.is_answer);
  const plain = comments.filter(c => !c.is_answer);
  const tagged = (p.tagged || []).filter(id => id !== p.author_id).map(C.getM);
  const asked = p.ask_to ? C.getM(p.ask_to) : null;
  const r0 = photos[0] && photos[0].w ? Math.max(0.8, Math.min(1.91, photos[0].w / photos[0].h)) : 1;
  const tapImg = () => {
    const t = Date.now();
    if (t - lastTap.current < 320) {
      if (!mine) C.react(p, '❤️');
      setPop(x => x + 1);
    }
    lastTap.current = t;
  };
  /* 글 끝에 몰아 쓴 #태그는 참고 화면처럼 아래 줄로 따로 뺀다 */
  const tm = (p.content || '').match(/(?:\s*#[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]+)+\s*$/);
  const body = tm ? p.content.slice(0, tm.index).trim() : p.content || '';
  const tail = tm ? tagsOf(tm[0]) : [];
  const long = body.length > 90 && !more;
  const speakKey = 'p' + p.id;
  const openedToday = p.open_on && p.open_on === ymd();
  return /*#__PURE__*/React.createElement("article", {
    className: "post",
    ref: vref
  }, /*#__PURE__*/React.createElement("div", {
    className: "post-hd"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: a,
    size: 42,
    ring: C.storyRing(a.id),
    onClick: () => C.openProfile(a.id)
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, a.name), p.isNew && /*#__PURE__*/React.createElement("span", {
    className: "newdot",
    title: "\uC0C8 \uC18C\uC2DD"
  })), /*#__PURE__*/React.createElement("div", {
    className: "when"
  }, relDay(p.happened_on, p.created_at), p.kind === 'daily' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LIcon, {
    name: "camera",
    size: 14
  }), "\uC624\uB298\uC758 \uD55C \uC7A5"), tagged.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LIcon, {
    name: "users",
    size: 14
  }), josa(tagged.map(t => t.name).join(', '), '과', '와'), " \uD568\uAED8"))), (p.author_id === C.me || C.isAdmin) && /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setMenu(true),
    "aria-label": "\uB354 \uBCF4\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "ellipsis"
  }))), openedToday && /*#__PURE__*/React.createElement("span", {
    className: "opened"
  }, "\uD83C\uDF81 \uC624\uB298 \uC5F4\uB9B0 \uD0C0\uC784\uCEA1\uC290 \xB7 ", fmtDate(ymd(new Date(p.created_at)), true), "\uC5D0 \uB0A8\uAE40"), isLocked(p) && /*#__PURE__*/React.createElement("span", {
    className: "opened",
    style: {
      background: '#F3EEFF',
      color: '#6a3fc8'
    }
  }, "\uD83D\uDD12 ", fmtDate(p.open_on, true), "\uC5D0 \uC5F4\uB824\uC694 (\uB098\uB9CC \uBBF8\uB9AC \uBCF4\uB294 \uC911)"), photos.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "car-wrap",
    onClick: tapImg,
    style: {
      aspectRatio: String(r0)
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "car",
    style: {
      height: '100%'
    },
    onScroll: e => {
      const el = e.currentTarget;
      setIdx(Math.round(el.scrollLeft / el.clientWidth));
    }
  }, photos.map((ph, i) => isVideo(ph) ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "vslide",
    onClick: e => e.stopPropagation()
  }, playing === i ? /*#__PURE__*/React.createElement("iframe", {
    src: `https://drive.google.com/file/d/${ph.vid}/preview`,
    allow: "autoplay; fullscreen",
    allowFullScreen: true,
    title: "\uB3D9\uC601\uC0C1"
  }) : /*#__PURE__*/React.createElement("button", {
    className: "vplay",
    onClick: () => setPlaying(i),
    "aria-label": "\uB3D9\uC601\uC0C1 \uBCF4\uAE30"
  }, /*#__PURE__*/React.createElement("img", {
    src: ph.url,
    alt: "",
    loading: "lazy"
  }), /*#__PURE__*/React.createElement("span", {
    className: "pb"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "play",
    size: 34,
    fill: "#fff",
    stroke: "#fff"
  })), ph.dur > 0 && /*#__PURE__*/React.createElement("span", {
    className: "vd"
  }, fmtDur(ph.dur)))) : /*#__PURE__*/React.createElement("img", {
    key: i,
    src: ph.url,
    alt: `사진 ${i + 1}`,
    loading: "lazy"
  }))), photos.length > 1 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "pcount"
  }, idx + 1, "/", photos.length), /*#__PURE__*/React.createElement("div", {
    className: "dots"
  }, photos.map((_, i) => /*#__PURE__*/React.createElement("i", {
    key: i,
    className: i === idx ? 'on' : ''
  })))), p.title && idx === 0 && /*#__PURE__*/React.createElement("span", {
    className: "ovl"
  }, p.title), pop > 0 && /*#__PURE__*/React.createElement("span", {
    key: pop,
    className: "bigheart"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 96,
    fill: "#fff",
    stroke: "#fff"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, bar && /*#__PURE__*/React.createElement("div", {
    className: "rbar",
    role: "menu",
    "aria-label": "\uB9C8\uC74C \uACE0\uB974\uAE30"
  }, REACTS.map(([e, w]) => /*#__PURE__*/React.createElement("button", {
    key: e,
    className: mine === e ? 'on' : '',
    onClick: () => pick(e),
    "aria-label": w
  }, e))), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: heartTap,
    onPointerDown: heartDown,
    onPointerUp: heartUp,
    onPointerLeave: heartUp,
    onContextMenu: e => e.preventDefault(),
    "aria-label": mine ? `내 마음 ${mine} · 누르면 지워요` : '마음 남기기'
  }, !mine ? /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 28
  }) : mine === '❤️' ? /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 28,
    fill: "#ED4956",
    stroke: "#ED4956"
  }) : /*#__PURE__*/React.createElement("span", {
    className: "myr"
  }, mine)), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.openComments(p),
    "aria-label": "\uB313\uAE00"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "message-circle",
    size: 27
  })), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.sharePost(p),
    "aria-label": "\uBCF4\uB0B4\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "send",
    size: 26
  })), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.openComments(p, 'voice'),
    "aria-label": "\uBAA9\uC18C\uB9AC \uB313\uAE00"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "mic",
    size: 24,
    stroke: "#8e8e8e"
  })), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.toggleSpeak(speakKey, `${a.name}의 소식. ${p.title ? p.title + '. ' : ''}${p.content || '사진이 올라왔어요.'}${asked ? ` ${asked.name}께 질문. ${p.ask_text}` : ''}`),
    "aria-label": "\uC77D\uC5B4 \uC8FC\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: C.speaking === speakKey ? 'volume-x' : 'volume-2',
    size: 24,
    stroke: "#8e8e8e"
  })), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.toggleSave(p),
    "aria-label": iSaved ? '보관 빼기' : '보관하기'
  }, iSaved ? /*#__PURE__*/React.createElement(LIcon, {
    name: "bookmark",
    size: 27,
    fill: "#1a1a1a"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "bookmark",
    size: 27
  }))), reacts.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "liked",
    onClick: () => showBar(0),
    "aria-label": "\uB9C8\uC74C \uBC14\uAFB8\uAE30"
  }, /*#__PURE__*/React.createElement("span", {
    className: "faces"
  }, reacts.slice(0, 4).map(r => /*#__PURE__*/React.createElement(Avatar, {
    key: r.member_id,
    m: C.getM(r.member_id),
    size: 24
  }))), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "rk"
  }, kinds.slice(0, 4).join('')), " ", /*#__PURE__*/React.createElement("b", null, reacts.length, "\uAC1C"), " ", /*#__PURE__*/React.createElement("span", {
    className: "muted small"
  }, "\xB7 ", reacts.map(r => C.getM(r.member_id).name + r.emoji).join(', ')))), !photos.length && p.title && /*#__PURE__*/React.createElement("div", {
    className: "capt",
    style: {
      fontFamily: "'Nanum Pen Script',cursive",
      fontSize: '1.6rem',
      lineHeight: 1.2
    }
  }, p.title), body && /*#__PURE__*/React.createElement("div", {
    className: "capt"
  }, /*#__PURE__*/React.createElement("b", null, a.name), " ", long ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tagged, {
    text: body.slice(0, 90)
  }), "\u2026 ", /*#__PURE__*/React.createElement("button", {
    className: "more",
    onClick: () => setMore(true)
  }, "\uB354 \uBCF4\uAE30")) : /*#__PURE__*/React.createElement(Tagged, {
    text: body
  })), tail.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "htags"
  }, tail.map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: "htag",
    onClick: () => C.openTag(t)
  }, t))), asked && /*#__PURE__*/React.createElement("div", {
    className: "askbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tiny",
    style: {
      color: '#b2502c',
      fontWeight: 700
    }
  }, asked.emoji, " ", asked.name, "\uAED8 \uBB3B\uB294 \uC9C8\uBB38"), /*#__PURE__*/React.createElement("div", {
    className: "q"
  }, "\u201C", p.ask_text, "\u201D"), answers.map(c => /*#__PURE__*/React.createElement("div", {
    className: "ans",
    key: c.id
  }, /*#__PURE__*/React.createElement(CommentRow, {
    c: c
  }))), !answers.length && (p.ask_to === C.me ? /*#__PURE__*/React.createElement("button", {
    className: "btn sm accent",
    onClick: () => C.openComments(p)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "mic",
    size: 16
  }), "\uB2F5\uD558\uAE30") : /*#__PURE__*/React.createElement("div", {
    className: "small muted"
  }, asked.name, "\uC758 \uB2F5\uC744 \uAE30\uB2E4\uB824\uC694"))), /*#__PURE__*/React.createElement("div", {
    className: "cmts"
  }, plain.length > 2 && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    onClick: () => C.openComments(p)
  }, "\uB313\uAE00 ", plain.length, "\uAC1C \uBAA8\uB450 \uBCF4\uAE30"), plain.slice(-2).map(c => /*#__PURE__*/React.createElement(CommentRow, {
    key: c.id,
    c: c
  }))), /*#__PURE__*/React.createElement(Sheet, {
    open: menu,
    onClose: () => setMenu(false),
    title: "\uC18C\uC2DD"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, p.author_id === C.me && /*#__PURE__*/React.createElement("button", {
    className: "btn soft block",
    onClick: () => {
      setMenu(false);
      C.openComposer({
        edit: p
      });
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "pencil",
    size: 18
  }), "\uAE00 \uACE0\uCE58\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn soft block danger",
    onClick: () => {
      setMenu(false);
      C.deletePost(p);
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trash-2",
    size: 18
  }), "\uC18C\uC2DD \uC9C0\uC6B0\uAE30"))));
}

/* ═══════════ 댓글 시트 ═══════════ */
function CommentsSheet({
  post,
  mode,
  onClose
}) {
  const C = useC();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  const open = !!post;
  const p = post ? C.posts.find(x => x.id === post.id) || post : null;
  const list = p ? C.commentsOf(p.id) : [];
  const answering = p && p.ask_to === C.me;
  const send = async row => {
    setBusy(true);
    const ok = await C.addComment({
      post_id: p.id,
      author_id: C.me,
      is_answer: !!answering,
      ...row
    });
    setBusy(false);
    return ok;
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    title: answering ? '질문에 답하기' : '댓글',
    full: true,
    footer: p && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(RecordButton, {
      block: true,
      label: answering ? '목소리로 답하기' : '목소리 댓글 남기기',
      onDone: async r => {
        const url = await uploadVoice(r.blob, r.sec);
        await send({
          audio_url: url,
          content: r.text || ''
        });
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "row gap"
    }, /*#__PURE__*/React.createElement("input", {
      className: "input grow",
      placeholder: answering ? '글로 답하기…' : '댓글 달기…',
      value: text,
      onChange: e => setText(e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      className: 'iconbtn',
      style: {
        background: dict.on ? 'var(--accent)' : '#f0f0f0',
        color: dict.on ? '#fff' : 'inherit'
      },
      onClick: dict.toggle,
      "aria-label": "\uB9D0\uB85C \uC4F0\uAE30"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "mic"
    })), /*#__PURE__*/React.createElement("button", {
      className: "btn blue sm",
      disabled: !text.trim() || busy,
      onClick: async () => {
        if (await send({
          content: text.trim()
        })) setText('');
      }
    }, "\uC62C\uB9AC\uAE30")))
  }, p && /*#__PURE__*/React.createElement(React.Fragment, null, answering && /*#__PURE__*/React.createElement("div", {
    className: "askbox",
    style: {
      margin: '0 0 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tiny",
    style: {
      color: '#b2502c',
      fontWeight: 700
    }
  }, C.getM(p.author_id).name, "\uC758 \uC9C8\uBB38"), /*#__PURE__*/React.createElement("div", {
    className: "q"
  }, "\u201C", p.ask_text, "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "small muted"
  }, "\uAE00\uC774\uB098 \uBAA9\uC18C\uB9AC\uB85C \uB2F5\uD574 \uC8FC\uC138\uC694.")), p.content && /*#__PURE__*/React.createElement("div", {
    className: "cmt",
    style: {
      borderBottom: '1px solid var(--line)',
      paddingBottom: 12,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(p.author_id),
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("b", null, C.getM(p.author_id).name), " ", p.content)), !list.length && /*#__PURE__*/React.createElement("p", {
    className: "empty"
  }, "\uCCAB \uB313\uAE00\uC744 \uB0A8\uACA8 \uBCF4\uC138\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uD0C0\uC790\uAC00 \uC5B4\uB824\uC6B0\uBA74 \uC544\uB798 \uB9C8\uC774\uD06C\uB97C \uB204\uB974\uC138\uC694.")), list.map(c => /*#__PURE__*/React.createElement(CommentRow, {
    key: c.id,
    c: c,
    onDelete: C.deleteComment
  })), mode === 'voice' && !list.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      textAlign: 'center'
    }
  }, "\u2193 \"\uBAA9\uC18C\uB9AC \uB313\uAE00 \uB0A8\uAE30\uAE30\"\uB97C \uB204\uB974\uACE0 \uB9D0\uD558\uBA74 \uB3FC\uC694")));
}

/* ═══════════ 올리기 (소식 / 오늘의 한 장 / 고치기) ═══════════ */
function Composer({
  cfg,
  onClose
}) {
  const C = useC();
  const open = !!cfg;
  const edit = cfg && cfg.edit;
  const daily = cfg && cfg.mode === 'daily';
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [day, setDay] = useState(ymd());
  const [tagged, setTagged] = useState([]);
  const [cap, setCap] = useState(false);
  const [openOn, setOpenOn] = useState('');
  const [askTo, setAskTo] = useState('');
  const [askText, setAskText] = useState('');
  const [busy, setBusy] = useState('');
  const pick = useRef(null);
  const [ovl, setOvl] = useState('');
  const dict = useDictation(t => setText(s => joinText(s, t)));
  const dictQ = useDictation(t => setAskText(s => joinText(s, t)));
  useEffect(() => {
    if (!cfg) return;
    const e = cfg.edit;
    setFiles([]);
    setText(e ? e.content || '' : '');
    setDay(e ? e.happened_on : ymd());
    setTagged(e ? e.tagged || [] : []);
    setCap(!!(e && e.open_on));
    setOpenOn(e && e.open_on || '');
    setAskTo(e && e.ask_to || '');
    setAskText(e && e.ask_text || '');
    setOvl(e && e.title || '');
    setBusy('');
  }, [cfg]);
  const addFiles = async list => {
    let arr = Array.from(list || []).filter(f => /^image\//.test(f.type) || !daily && /^video\//.test(f.type));
    if (arr.some(f => /^video\//.test(f.type))) {
      if ((await gwVersion()) < 3) {
        C.toast('사진 창구를 새 버전(v3)으로 배포해야 동영상을 올릴 수 있어요');
        arr = arr.filter(f => !/^video\//.test(f.type));
      } else if (arr.some(f => f.size > VIDEO_MAX)) {
        C.toast('1.5GB보다 큰 동영상은 올릴 수 없어요');
        arr = arr.filter(f => f.size <= VIDEO_MAX);
      }
    }
    setFiles(fs => [...fs, ...arr.map(f => ({
      f,
      url: URL.createObjectURL(f),
      video: /^video\//.test(f.type)
    }))].slice(0, daily ? 1 : 10));
  };
  const others = C.members.filter(m => m.id !== C.me);
  const capMember = tagged.length === 1 ? C.getM(tagged[0]) : null;
  const can = !busy && (edit ? true : daily ? files.length > 0 : files.length > 0 || text.trim());
  const submit = async () => {
    if (cap && !openOn) {
      C.toast('타임캡슐 여는 날을 골라 주세요');
      return;
    }
    if (askTo && !askText.trim()) {
      C.toast('질문 내용을 적어 주세요');
      return;
    }
    try {
      if (edit) {
        setBusy('고치는 중…');
        const ok = await C.write(() => db.patch('posts', edit.id, {
          content: text.trim(),
          title: ovl.trim(),
          happened_on: day,
          tagged,
          open_on: cap ? openOn : null,
          ask_to: askTo || null,
          ask_text: askTo ? askText.trim() : '',
          updated_at: new Date().toISOString()
        }), '고쳤어요');
        if (ok) onClose();else setBusy('');
        return;
      }
      const photos = [];
      const vids = files.filter(x => x.video);
      if (vids.length && navigator.connection && navigator.connection.type === 'cellular' && !window.confirm(`동영상은 데이터를 많이 써요 (${Math.round(vids.reduce((n, x) => n + x.f.size, 0) / 1e6)}MB). 와이파이가 아닌데 계속 올릴까요?`)) {
        setBusy('');
        return;
      }
      for (let i = 0; i < files.length; i++) {
        const x = files[i],
          at = `${i + 1}/${files.length}`;
        if (x.video) {
          setBusy(`동영상 올리는 중 ${at} · 0%`);
          photos.push(await uploadVideo(x.f, p => setBusy(`동영상 올리는 중 ${at} · ${p}%`)));
        } else {
          setBusy(`사진 올리는 중 ${at} · 원본도 저장`);
          photos.push(await uploadPhoto(x.f, undefined, true));
        }
      } // 사진·동영상은 앱에서 지우지 않는다 (올리다 실패해도 드라이브에 남김)
      setBusy('소식 올리는 중…');
      const row = daily ? {
        author_id: C.me,
        kind: 'daily',
        content: text.trim(),
        photos,
        happened_on: ymd()
      } : {
        author_id: C.me,
        kind: 'post',
        content: text.trim(),
        title: ovl.trim(),
        photos,
        happened_on: day,
        tagged,
        open_on: cap ? openOn : null,
        ask_to: askTo || null,
        ask_text: askTo ? askText.trim() : ''
      };
      const ok = await C.write(() => db.add('posts', row), daily ? '오늘의 한 장을 올렸어요' : cap ? `타임캡슐을 잠갔어요 · ${fmtDate(openOn, true)}에 열려요` : '소식을 올렸어요');
      if (ok) onClose();else setBusy('');
    } catch (e) {
      setBusy('');
      C.toast('올리지 못했어요: ' + e.message);
    }
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: () => {
      if (!busy) onClose();
    },
    full: true,
    title: edit ? '소식 고치기' : daily ? '오늘의 한 장' : '새 소식',
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      disabled: !can,
      onClick: submit
    }, busy ? /*#__PURE__*/React.createElement("span", {
      className: "spin dark"
    }) : edit ? '저장' : '올리기')
  }, busy && /*#__PURE__*/React.createElement("div", {
    className: "recbox",
    style: {
      marginBottom: 14,
      background: '#EAF3FF'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), busy)), daily && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 0
    }
  }, "\uD558\uB8E8\uC5D0 \uD55C \uC7A5\uC529 \uC313\uC5EC\uC11C, 1\uB144 \uB4A4\uC5D4 \uC6B0\uB9AC \uAC00\uC871 365\uC77C \uB2EC\uB825\uC774 \uB3FC\uC694. \uC0AC\uB77C\uC9C0\uC9C0 \uC54A\uC544\uC694."), !edit && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("div", {
    className: "thumbs"
  }, files.map((x, i) => /*#__PURE__*/React.createElement("div", {
    className: "t",
    key: i
  }, x.video ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("video", {
    src: x.url + '#t=0.5',
    muted: true,
    playsInline: true,
    preload: "metadata"
  }), /*#__PURE__*/React.createElement("span", {
    className: "vt"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "play",
    size: 14,
    fill: "#fff"
  }), Math.round(x.f.size / 1e6), "MB")) : /*#__PURE__*/React.createElement("img", {
    src: x.url,
    alt: ""
  }), /*#__PURE__*/React.createElement("button", {
    className: "x",
    onClick: () => setFiles(fs => fs.filter((_, j) => j !== i)),
    "aria-label": "\uBE7C\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x",
    size: 14
  })))), files.length < (daily ? 1 : 10) && /*#__PURE__*/React.createElement("button", {
    className: "add",
    onClick: () => pick.current.click()
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "image-plus",
    size: 28
  }), daily ? '사진 고르기' : '사진·동영상')), /*#__PURE__*/React.createElement("input", {
    ref: pick,
    type: "file",
    accept: daily ? 'image/*' : 'image/*,video/*',
    multiple: !daily,
    hidden: true,
    onChange: e => {
      addFiles(e.target.files);
      e.target.value = '';
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, daily ? '한 줄 (선택)' : '무슨 일이 있었나요?'), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: daily ? 2 : 4,
    placeholder: daily ? '오늘 하루 한 줄' : '편하게 적거나, 아래 "말로 쓰기"를 눌러 말해 보세요',
    value: text,
    onChange: e => setText(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  })), !daily && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '8px 2px 0'
    }
  }, "\uAE00\uC5D0 ", /*#__PURE__*/React.createElement("span", {
    className: "htag"
  }, "#\uBC14\uB2E4"), " ", /*#__PURE__*/React.createElement("span", {
    className: "htag"
  }, "#\uD560\uBA38\uB2C8\uB301"), "\uCC98\uB7FC \uC801\uC73C\uBA74, \uB098\uC911\uC5D0 \uB20C\uB7EC\uC11C \uAC19\uC740 \uC18C\uC2DD\uB07C\uB9AC \uBAA8\uC544 \uBCFC \uC218 \uC788\uC5B4\uC694.")), !daily && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC0AC\uC9C4 \uC704 \uC190\uAE00\uC528 \uD55C \uC904 ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("input", {
    className: "input",
    maxLength: 30,
    placeholder: "\uC608: \uC6B0\uB9AC, \uC624\uB298\uB3C4 \uD568\uAED8 \u2661",
    value: ovl,
    onChange: e => setOvl(e.target.value),
    style: {
      fontFamily: "'Nanum Pen Script',cursive",
      fontSize: '1.4rem'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC5B8\uC81C \uC788\uC5C8\uB358 \uC77C\uC778\uAC00\uC694?"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input",
    max: ymd(),
    value: day,
    onChange: e => setDay(e.target.value)
  }), day !== ymd() && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, "\uC61B\uB0A0 \uC0AC\uC9C4\uB3C4 \uADF8\uB0A0 \uB0A0\uC9DC\uB85C \uC62C\uB9AC\uBA74 \"N\uB144 \uC804 \uC624\uB298\"\uC5D0 \uB2E4\uC2DC \uB5A0\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC0AC\uC9C4\uC5D0 \uB204\uAC00 \uB098\uC654\uB098\uC694?"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, C.members.map(m => {
    const on = tagged.includes(m.id);
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      key: m.id,
      className: 'chip' + (on ? ' on' : ''),
      onClick: () => setTagged(t => on ? t.filter(x => x !== m.id) : [...t, m.id])
    }, m.emoji, " ", m.name);
  }))), /*#__PURE__*/React.createElement(CapsulePicker, {
    on: cap,
    setOn: setCap,
    date: openOn,
    setDate: setOpenOn,
    member: capMember
  }), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC9C8\uBB38\uB3C4 \uBD99\uC77C\uAE4C\uC694? ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: askTo ? 8 : 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'chip' + (!askTo ? ' on' : ''),
    onClick: () => setAskTo('')
  }, "\uC548 \uBD99\uC784"), others.map(m => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: m.id,
    className: 'chip' + (askTo === m.id ? ' on' : ''),
    onClick: () => setAskTo(m.id)
  }, m.emoji, " ", m.name, "\uAED8"))), askTo && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("input", {
    className: "input",
    placeholder: '예: 엄마도 어릴 때 이거 해 봤어요?',
    value: askText,
    onChange: e => setAskText(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dictQ
  }))))));
}

/* ═══════════ 오늘의 한 장 보기 (스토리) ═══════════ */
function StoryViewer({
  items,
  onClose
}) {
  const C = useC();
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const open = !!(items && items.length);
  useLayer(open, onClose);
  useEffect(() => {
    setI(0);
    setT(0);
  }, [items]);
  const cur = open ? items[Math.min(i, items.length - 1)] : null;
  useEffect(() => {
    if (cur) C.markSeen(cur.id);
  }, [cur && cur.id]);
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setT(x => x + 1), 60);
    return () => clearInterval(iv);
  }, [open, i]);
  useEffect(() => {
    if (t >= 100) {
      if (i < items.length - 1) {
        setI(i + 1);
        setT(0);
      } else onClose();
    }
  }, [t]);
  if (!open) return null;
  const a = C.getM(cur.author_id);
  const ph = photosOf(cur)[0];
  const likes = C.likesOf(cur.id);
  const iLike = likes.includes(C.me);
  return /*#__PURE__*/React.createElement("div", {
    className: "story"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bars"
  }, items.map((_, k) => /*#__PURE__*/React.createElement("i", {
    key: k
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      width: k < i ? '100%' : k === i ? t + '%' : '0%'
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "sh"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: a,
    size: 34
  }), /*#__PURE__*/React.createElement("b", null, a.name), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .7,
      fontSize: '.85rem'
    }
  }, relDay(cur.happened_on, cur.created_at)), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onClose,
    "aria-label": "\uB2EB\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x",
    size: 28,
    stroke: "#fff"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "simg"
  }, ph ? /*#__PURE__*/React.createElement("img", {
    src: ph.url,
    alt: "\uC624\uB298\uC758 \uD55C \uC7A5"
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '1.3rem',
      padding: 30
    }
  }, cur.content), /*#__PURE__*/React.createElement("button", {
    className: "tapL",
    "aria-label": "\uC774\uC804",
    onClick: () => {
      if (i > 0) {
        setI(i - 1);
        setT(0);
      } else setT(0);
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "tapR",
    "aria-label": "\uB2E4\uC74C",
    onClick: () => {
      if (i < items.length - 1) {
        setI(i + 1);
        setT(0);
      } else onClose();
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "sc"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, ph && cur.content, likes.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      opacity: .8
    }
  }, likes.map(id => C.getM(id).name).join(', '), " \u2764\uFE0F")), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.toggleLike(cur),
    "aria-label": "\uC88B\uC544\uC694"
  }, iLike ? /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 30,
    fill: "#ED4956",
    stroke: "#ED4956"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 30,
    stroke: "#fff"
  }))));
}

/* 소식 목록에 끼는 냉장고 메모: 시간 순으로 이웃한 메모끼리 한 장에 */
const noteColors = ['#FFF6B8', '#FFE1E1', '#DDF3E4', '#E2ECFF'];
function FridgeCard({
  notes
}) {
  const C = useC();
  return /*#__PURE__*/React.createElement("article", {
    className: "fridge"
  }, /*#__PURE__*/React.createElement("button", {
    className: "feed-band fr",
    onClick: C.openLetters
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCCC \uB0C9\uC7A5\uACE0 \uBA54\uBAA8"), /*#__PURE__*/React.createElement("span", {
    className: "go"
  }, "\uB0C9\uC7A5\uACE0 \uC5F4\uAE30 ", /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "notes"
  }, notes.map((n, i) => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: "note",
    onClick: () => C.openNote(n),
    style: {
      background: noteColors[i % 4],
      transform: `rotate(${n.angle || 0}deg)`
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nt-who"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(n.author_id),
    size: 20
  }), /*#__PURE__*/React.createElement("span", null, C.getM(n.author_id).name)), /*#__PURE__*/React.createElement("div", {
    className: "nt-txt"
  }, n.content), /*#__PURE__*/React.createElement("div", {
    className: "tiny muted"
  }, relTime(n.created_at)), /*#__PURE__*/React.createElement(NoteMeta, {
    n: n
  })))));
}

/* 📌 냉장고 메모 하나: 마음(이모지 하나)·답글 */
function NoteSheet({
  note,
  onClose
}) {
  const C = useC();
  const [t, setT] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const dict = useDictation(x => setT(s => joinText(s, x)));
  useEffect(() => {
    if (note) {
      setT('');
      setEditId(null);
    }
  }, [note && note.id]);
  const n = note && (C.notes.find(x => x.id === note.id) || note);
  const reacts = n ? C.noteReactsOf(n.id) : [];
  const mine = n ? (reacts.find(r => r.member_id === C.me) || {}).emoji : null;
  const replies = n ? C.noteRepliesOf(n.id) : [];
  const send = async () => {
    if (!t.trim()) return;
    setBusy(true);
    if (await C.replyNote(n, t.trim())) setT('');
    setBusy(false);
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: !!n,
    onClose: onClose,
    title: "\uD83D\uDCCC \uB0C9\uC7A5\uACE0 \uBA54\uBAA8"
  }, n && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "note big",
    style: {
      background: n.color && n.color !== '#F7F4EB' ? n.color : '#FFF6B8'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "nt-who"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(n.author_id),
    size: 24
  }), /*#__PURE__*/React.createElement("span", null, C.getM(n.author_id).name, " \xB7 ", relTime(n.created_at))), /*#__PURE__*/React.createElement("div", {
    className: "nt-txt"
  }, n.content)), /*#__PURE__*/React.createElement("div", {
    className: "rbar inline",
    role: "group",
    "aria-label": "\uB9C8\uC74C \uB0A8\uAE30\uAE30"
  }, REACTS.map(([e, w]) => /*#__PURE__*/React.createElement("button", {
    key: e,
    className: mine === e ? 'on' : '',
    onClick: () => C.reactNote(n, e),
    "aria-label": w
  }, e))), reacts.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      margin: '2px 4px 12px'
    }
  }, reacts.map(r => C.getM(r.member_id).name + r.emoji).join(', ')), /*#__PURE__*/React.createElement("div", {
    className: "sec-t",
    style: {
      padding: '6px 0'
    }
  }, "\uB2F5\uAE00 ", replies.length > 0 ? replies.length : ''), !replies.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 2px 10px'
    }
  }, "\"\uB0B4\uAC00 \uC0AC \uC62C\uAC8C\uC694!\"\uCC98\uB7FC \uD55C\uB9C8\uB514 \uB0A8\uACA8 \uBCF4\uC138\uC694."), replies.map(r => /*#__PURE__*/React.createElement("div", {
    className: "cmt",
    key: r.id
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(r.author_id),
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, C.getM(r.author_id).name), " ", editId !== r.id && /*#__PURE__*/React.createElement("span", null, r.content)), editId === r.id ? /*#__PURE__*/React.createElement(EditLine, {
    text: r.content,
    onCancel: () => setEditId(null),
    onSave: async x => {
      const ok = await C.editNoteReply(r, x);
      if (ok) setEditId(null);
      return ok;
    }
  }) : /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", null, relTime(r.created_at)), r.author_id === C.me && /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditId(r.id)
  }, "\uC218\uC815"), (r.author_id === C.me || C.isAdmin) && /*#__PURE__*/React.createElement("button", {
    onClick: () => C.deleteNoteReply(r)
  }, "\uC9C0\uC6B0\uAE30"))))), /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "input grow",
    placeholder: "\uB2F5\uAE00 \uD55C\uB9C8\uB514",
    value: t,
    onChange: e => setT(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') send();
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn primary sm",
    disabled: busy || !t.trim(),
    onClick: send
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : '보내기')), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  }))));
}
/* 메모 아래 작은 줄: 남긴 마음·답글 수 (누르면 메모 창) */
function NoteMeta({
  n
}) {
  const C = useC();
  const rs = C.noteReactsOf(n.id);
  const k = C.noteRepliesOf(n.id).length;
  const kinds = [...new Set(rs.map(r => r.emoji))].slice(0, 3).join('');
  return /*#__PURE__*/React.createElement("div", {
    className: "nt-meta"
  }, rs.length ? /*#__PURE__*/React.createElement("span", null, kinds, " ", rs.length) : /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "\u2661"), /*#__PURE__*/React.createElement("span", {
    className: k ? '' : 'muted'
  }, "\uD83D\uDCAC ", k || ''));
}

/* ═══════════ 홈 ═══════════ */
function HomeTab() {
  const C = useC();
  const today = ymd();
  /* 소식 목록: 소식(오늘의 한 장 포함)·기도·냉장고 메모를 날짜 순으로 섞는다. 이웃한 메모는 한 장으로 묶는다 */
  const feed = useMemo(() => {
    const items = [...C.posts.map(p => ({
      k: 'p' + p.id,
      t: 'post',
      p,
      s: p.happened_on + '|' + p.created_at
    })), ...C.prayers.map(p => ({
      k: 'r' + p.id,
      t: 'pray',
      p,
      s: ymd(new Date(p.created_at)) + '|' + p.created_at
    })), ...C.notes.map(n => ({
      k: 'n' + n.id,
      t: 'note',
      p: n,
      s: ymd(new Date(n.created_at)) + '|' + n.created_at
    }))].sort((a, b) => b.s.localeCompare(a.s));
    const out = [];
    items.forEach(x => {
      const last = out[out.length - 1];
      if (x.t === 'note' && last && last.t === 'notes') last.list.push(x.p);else out.push(x.t === 'note' ? {
        k: x.k,
        t: 'notes',
        list: [x.p]
      } : x);
    });
    return out;
  }, [C.posts, C.prayers, C.notes]);
  const [shown, setShown] = useState(15);
  const endRef = useRef(null);
  useEffect(() => {
    const el = endRef.current;
    if (!el || !window.IntersectionObserver) return;
    const io = new IntersectionObserver(es => {
      if (es[0].isIntersecting) setShown(n => n + 15);
    }, {
      rootMargin: '800px'
    });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, feed.length]);
  const order = [C.me, ...C.members.map(m => m.id).filter(id => id !== C.me)];
  const stories = order.map(id => C.getM(id)).sort((x, y) => {
    if (x.id === C.me) return -1;
    if (y.id === C.me) return 1;
    const rank = m => ({
      '': 3,
      plain: 3,
      seen: 2,
      bday: 0
    })[C.storyRing(m.id) || ''] ?? 1;
    return rank(x) - rank(y);
  });
  const md = today.slice(5);
  const ago = C.posts.filter(p => p.happened_on.slice(5) === md && p.happened_on < today.slice(0, 4) && !isLocked(p));
  const agoYears = [...new Set(ago.map(p => +today.slice(0, 4) - +p.happened_on.slice(0, 4)))].sort((a, b) => a - b);
  const agoPhotos = ago.flatMap(p => photosOf(p)).slice(0, 3);
  const askedMe = C.posts.filter(p => p.ask_to === C.me && !isLocked(p) && !C.commentsOf(p.id).some(c => c.is_answer && c.author_id === C.me));
  const wq = C.weekQ;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar brand-hd"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 20,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), /*#__PURE__*/React.createElement("span", {
    className: "brand-sub"
  }, "\uD568\uAED8\uD558\uB294 \uBAA8\uB4E0 \uC21C\uAC04\uC774 \uC18C\uC911\uD574\uC694 \u2665")), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: C.openNoti,
    "aria-label": "\uC54C\uB9BC"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: C.newCount > 0 ? 'bell-ring' : 'bell',
    size: 26
  }), C.newCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "cnt",
    style: {
      top: -1,
      right: -6
    }
  }, C.newCount)), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: C.openLetters,
    "aria-label": "\uD3B8\uC9C0\uD568"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "send",
    size: 26
  }), C.unread > 0 && /*#__PURE__*/React.createElement("span", {
    className: "cnt"
  }, C.unread)))), /*#__PURE__*/React.createElement("div", {
    className: "stories"
  }, stories.map(m => {
    const ring = C.storyRing(m.id) || 'plain';
    const bd = C.bdayDays(m.id);
    const mine = m.id === C.me;
    const has = C.dailyToday(m.id).length > 0;
    return /*#__PURE__*/React.createElement("div", {
      className: "st",
      key: m.id
    }, mine && !has ? /*#__PURE__*/React.createElement("button", {
      className: "me0",
      onClick: () => C.openComposer({
        mode: 'daily'
      }),
      "aria-label": "\uB0B4 \uC2A4\uD1A0\uB9AC \uC62C\uB9AC\uAE30"
    }, m.avatar ? /*#__PURE__*/React.createElement(Avatar, {
      m: m,
      size: 68
    }) : /*#__PURE__*/React.createElement(LIcon, {
      name: "users",
      size: 30
    })) : /*#__PURE__*/React.createElement(Avatar, {
      m: m,
      size: 62,
      ring: ring,
      onClick: () => {
        if (has) C.openStory(C.dailyToday(m.id));else C.openProfile(m.id);
      }
    }), mine && !has && /*#__PURE__*/React.createElement("span", {
      className: "addp"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "plus",
      size: 13,
      sw: 3
    })), bd !== null && bd <= 7 && !(mine && !has) && /*#__PURE__*/React.createElement("span", {
      className: "mini"
    }, "\uD83C\uDF82", ddayText(bd)), /*#__PURE__*/React.createElement("div", {
      className: "lb"
    }, mine ? '내 스토리' : m.name));
  })), wq && /*#__PURE__*/React.createElement(QHero, {
    q: wq,
    onOpen: () => C.openQuestion(wq)
  }), /*#__PURE__*/React.createElement(InstallCard, null), /*#__PURE__*/React.createElement(PushCard, null), askedMe.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "banner",
    onClick: () => C.openComments(askedMe[0])
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(askedMe[0].author_id),
    size: 42
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, josa(C.getM(askedMe[0].author_id).name, '이', '가'), " \uC9C8\uBB38\uD588\uC5B4\uC694"), /*#__PURE__*/React.createElement("span", null, "\u201C", askedMe[0].ask_text, "\u201D", askedMe.length > 1 ? ` 외 ${askedMe.length - 1}개` : '')), /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right"
  })), ago.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "banner ago",
    onClick: () => C.openAgo(ago)
  }, agoPhotos.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "th"
  }, agoPhotos.map((ph, i) => /*#__PURE__*/React.createElement("img", {
    key: i,
    src: ph.thumb || ph.url,
    alt: ""
  }))) : /*#__PURE__*/React.createElement("div", {
    className: "bic",
    style: {
      background: '#FFF5E2',
      color: '#B5861C'
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "history"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, agoYears.map(y => `${y}년`).join('·'), " \uC804 \uC624\uB298"), /*#__PURE__*/React.createElement("span", null, "\uADF8\uB0A0\uC758 \uC18C\uC2DD ", ago.length, "\uAC1C \xB7 \uB20C\uB7EC\uC11C \uBCF4\uAE30")), /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 4
    }
  }), !feed.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 \uC18C\uC2DD\uC774 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), "\uC544\uB798 \uAC00\uC6B4\uB370 ", /*#__PURE__*/React.createElement("b", null, "\uFF0B \uCD94\uAC00"), "\uB97C \uB20C\uB7EC \uCCAB \uC18C\uC2DD\uC744 \uC62C\uB824 \uBCF4\uC138\uC694.", /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: () => C.openComposer({})
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "square-plus",
    size: 20
  }), "\uCCAB \uC18C\uC2DD \uC62C\uB9AC\uAE30"))), feed.slice(0, shown).map(x => x.t === 'post' ? /*#__PURE__*/React.createElement(PostCard, {
    key: x.k,
    p: x.p
  }) : x.t === 'pray' ? /*#__PURE__*/React.createElement(PrayCard, {
    key: x.k,
    p: x.p,
    feed: true
  }) : /*#__PURE__*/React.createElement(FridgeCard, {
    key: x.k,
    notes: x.list
  })), shown < feed.length ? /*#__PURE__*/React.createElement("div", {
    ref: endRef,
    className: "empty small"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    onClick: () => setShown(n => n + 15)
  }, "\uC18C\uC2DD \uB354 \uBCF4\uAE30 (", feed.length - shown, "\uAC1C \uB0A8\uC74C)")) : feed.length > 0 && /*#__PURE__*/React.createElement("p", {
    className: "empty small",
    style: {
      padding: '24px 20px'
    }
  }, "\uC5EC\uAE30\uAE4C\uC9C0\uAC00 \uC6B0\uB9AC \uAC00\uC871 \uC18C\uC2DD \uC804\uBD80\uC608\uC694 \uD83C\uDF3F"));
}

/* ═══════════ 달력 ═══════════ */
function CalendarTab() {
  const C = useC();
  const today = ymd();
  const [mode, setMode] = useState('ev');
  const [cur, setCur] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [sel, setSel] = useState(today);
  const [who, setWho] = useState('all');
  const [adding, setAdding] = useState(false);
  const Y = cur.getFullYear(),
    M = cur.getMonth();
  const allEvents = C.allEvents;
  const byDay = useMemo(() => {
    const map = {};
    allEvents.forEach(ev => occurIn(ev, Y).forEach(s => {
      if (+s.slice(5, 7) === M + 1) (map[s] = map[s] || []).push(ev);
    }));
    return map;
  }, [allEvents, Y, M]);
  const hol = holidays(Y);
  const dailies = useMemo(() => {
    const map = {};
    C.posts.filter(p => p.kind === 'daily' && (who === 'all' || p.author_id === who)).forEach(p => (map[p.happened_on] = map[p.happened_on] || []).push(p));
    return map;
  }, [C.posts, who]);
  const first = new Date(Y, M, 1).getDay();
  const days = new Date(Y, M + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${Y}-${pad(M + 1)}-${pad(d)}`);
  const upcoming = allEvents.map(ev => ({
    ev,
    d: nextOccur(ev, today)
  })).filter(x => x.d && dayDiff(today, x.d) <= 120).sort((a, b) => a.d.localeCompare(b.d));
  const holUp = [];
  for (const y of [+today.slice(0, 4), +today.slice(0, 4) + 1]) Object.entries(holidays(y)).forEach(([d, n]) => {
    if (d >= today && dayDiff(today, d) <= 60 && !/연휴/.test(n)) holUp.push({
      d,
      n
    });
  });
  const selEvents = byDay[sel] || [];
  const kindIcon = k => ({
    birthday: '🎂',
    anniversary: '💍',
    memorial: '🕯️'
  })[k] || '📌';
  const colorOf = ev => ev.member_id ? C.getM(ev.member_id).color : '#555';
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "h1"
  }, "\uB2EC\uB825"), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setAdding(true),
    "aria-label": "\uC77C\uC815 \uB123\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "plus",
    size: 28
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pad",
    style: {
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: mode === 'ev' ? 'on' : '',
    onClick: () => setMode('ev')
  }, "\uD83D\uDCC5 \uC77C\uC815"), /*#__PURE__*/React.createElement("button", {
    className: mode === 'ph' ? 'on' : '',
    onClick: () => setMode('ph')
  }, "\uD83D\uDDBC \uC624\uB298\uC758 \uD55C \uC7A5"))), /*#__PURE__*/React.createElement("div", {
    className: "cal-hd"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setCur(new Date(Y, M - 1, 1)),
    "aria-label": "\uC774\uC804 \uB2EC"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-left"
  })), /*#__PURE__*/React.createElement("b", null, Y, "\uB144 ", M + 1, "\uC6D4"), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setCur(new Date(Y, M + 1, 1)),
    "aria-label": "\uB2E4\uC74C \uB2EC"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right"
  }))), mode === 'ph' && /*#__PURE__*/React.createElement("div", {
    className: "chips pad",
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: 'chip' + (who === 'all' ? ' on' : ''),
    onClick: () => setWho('all')
  }, "\uBAA8\uB450"), C.members.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    className: 'chip' + (who === m.id ? ' on' : ''),
    onClick: () => setWho(m.id)
  }, m.emoji, " ", m.name))), /*#__PURE__*/React.createElement("div", {
    className: "cal-wd"
  }, WD.map(w => /*#__PURE__*/React.createElement("span", {
    key: w
  }, w))), /*#__PURE__*/React.createElement("div", {
    className: "cal",
    style: {
      gap: mode === 'ph' ? 2 : 0
    }
  }, cells.map((s, i) => {
    if (!s) return /*#__PURE__*/React.createElement("div", {
      key: 'e' + i
    });
    const dow = parseYmd(s).getDay();
    const cls = ['cell', s === today && 'today', hol[s] && 'hol', dow === 0 && 'sun', dow === 6 && 'sat'].filter(Boolean);
    if (mode === 'ph') {
      const ds = dailies[s] || [];
      const ph = ds.length ? photosOf(ds[0])[0] : null;
      return /*#__PURE__*/React.createElement("button", {
        key: s,
        className: [...cls, 'ph'].join(' '),
        onClick: () => ds.length && C.openStory(ds),
        "aria-label": s
      }, ph ? /*#__PURE__*/React.createElement("img", {
        src: ph.thumb || ph.url,
        alt: ""
      }) : /*#__PURE__*/React.createElement("span", {
        style: {
          width: '100%',
          height: '100%',
          background: '#f6f6f6',
          borderRadius: 8,
          display: 'block'
        }
      }), /*#__PURE__*/React.createElement("span", {
        className: "dn"
      }, +s.slice(8)));
    }
    const evs = byDay[s] || [];
    return /*#__PURE__*/React.createElement("button", {
      key: s,
      className: [...cls, sel === s && 'sel'].filter(Boolean).join(' '),
      onClick: () => setSel(s)
    }, /*#__PURE__*/React.createElement("span", {
      className: "dn"
    }, +s.slice(8)), hol[s] && /*#__PURE__*/React.createElement("span", {
      className: "hn"
    }, hol[s]), evs.slice(0, 2).map(ev => /*#__PURE__*/React.createElement("span", {
      key: ev.id,
      className: "ev",
      style: {
        background: colorOf(ev)
      }
    }, ev.title)), evs.length > 2 && /*#__PURE__*/React.createElement("span", {
      className: "tiny muted"
    }, "+", evs.length - 2));
  })), mode === 'ev' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sec-t"
  }, /*#__PURE__*/React.createElement("span", null, fmtDate(sel), " (", WD[parseYmd(sel).getDay()], ") ", /*#__PURE__*/React.createElement("span", {
    className: "small muted",
    style: {
      fontWeight: 400
    }
  }, lunarText(sel)))), hol[sel] && /*#__PURE__*/React.createElement("div", {
    className: "up-item"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '1.4rem'
    }
  }, "\uD83C\uDF8C"), /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#e0453a'
    }
  }, hol[sel])), !selEvents.length && !hol[sel] && /*#__PURE__*/React.createElement("p", {
    className: "small muted pad"
  }, "\uC774\uB0A0\uC740 \uC77C\uC815\uC774 \uC5C6\uC5B4\uC694."), selEvents.map(ev => /*#__PURE__*/React.createElement(EventRow, {
    key: ev.id,
    ev: ev,
    d: sel
  })), /*#__PURE__*/React.createElement("div", {
    className: "sec-t"
  }, "\uB2E4\uAC00\uC624\uB294 \uB0A0"), !upcoming.length && !holUp.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted pad"
  }, "\uB2E4\uAC00\uC624\uB294 \uC77C\uC815\uC774 \uC5C6\uC5B4\uC694. \uC624\uB978\uCABD \uC704 \uFF0B\uB85C \uC0DD\uC77C\xB7\uAE30\uB150\uC77C\uC744 \uB123\uC5B4 \uBCF4\uC138\uC694."), upcoming.map(({
    ev,
    d
  }) => /*#__PURE__*/React.createElement(EventRow, {
    key: ev.id + d,
    ev: ev,
    d: d,
    showDday: true
  })), holUp.slice(0, 4).map(h => /*#__PURE__*/React.createElement("div", {
    key: h.d,
    className: "up-item"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '1.4rem'
    }
  }, "\uD83C\uDF8C"), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, h.n), /*#__PURE__*/React.createElement("span", {
    className: "small muted",
    style: {
      display: 'block'
    }
  }, fmtDate(h.d), " (", WD[parseYmd(h.d).getDay()], ")")), /*#__PURE__*/React.createElement("span", {
    className: "dday",
    style: {
      color: '#e0453a'
    }
  }, ddayText(dayDiff(today, h.d)))))), mode === 'ph' && /*#__PURE__*/React.createElement("p", {
    className: "small muted pad",
    style: {
      marginTop: 12
    }
  }, "\uB0A0\uC9DC\uB97C \uB204\uB974\uBA74 \uADF8\uB0A0\uC758 \uD55C \uC7A5\uC744 \uD06C\uAC8C \uBD10\uC694. \uD648 \uB9E8 \uC704 \uB0B4 \uB3D9\uADF8\uB77C\uBBF8\uC758 \uFF0B\uB85C \uC624\uB298\uC758 \uD55C \uC7A5\uC744 \uC62C\uB824\uC694."), /*#__PURE__*/React.createElement(EventSheet, {
    open: adding,
    onClose: () => setAdding(false),
    day: sel
  }));
  function EventRow({
    ev,
    d,
    showDday
  }) {
    const n = dayDiff(today, d);
    const m = ev.member_id ? C.getM(ev.member_id) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "up-item"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '1.4rem'
      }
    }, kindIcon(ev.kind)), /*#__PURE__*/React.createElement("div", {
      className: "grow"
    }, /*#__PURE__*/React.createElement("b", null, ev.title), /*#__PURE__*/React.createElement("span", {
      className: "small muted",
      style: {
        display: 'block'
      }
    }, fmtDate(d), " (", WD[parseYmd(d).getDay()], ")", ev.calendar === 'lunar' ? ` · 음력 ${ev.lunar_month}월 ${ev.lunar_day}일` : '', ev.yearly ? ' · 매년' : '', m ? ` · ${m.name}` : '')), showDday && /*#__PURE__*/React.createElement("span", {
      className: 'dday' + (n <= 7 ? ' near' : '')
    }, ddayText(n)), !ev.virtual && /*#__PURE__*/React.createElement("button", {
      className: "iconbtn",
      onClick: () => C.deleteEvent(ev),
      "aria-label": "\uC77C\uC815 \uC9C0\uC6B0\uAE30"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "trash-2",
      size: 18
    })));
  }
}
function EventSheet({
  open,
  onClose,
  day
}) {
  const C = useC();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('event');
  const [cal, setCal] = useState('solar');
  const [date, setDate] = useState(day || ymd());
  const [lm, setLm] = useState(1);
  const [ld, setLd] = useState(1);
  const [yearly, setYearly] = useState(false);
  const [mid, setMid] = useState('');
  useEffect(() => {
    if (open) {
      setTitle('');
      setKind('event');
      setCal('solar');
      setDate(day || ymd());
      setYearly(false);
      setMid('');
      const l = lunarOf(parseYmd(day || ymd()));
      if (l) {
        setLm(l.m);
        setLd(l.d);
      }
    }
  }, [open]);
  const kinds = [['event', '📌 일정'], ['birthday', '🎂 생일'], ['anniversary', '💍 기념일'], ['memorial', '🕯️ 기일']];
  const save = async () => {
    if (!title.trim()) {
      C.toast('이름을 적어 주세요');
      return;
    }
    const row = {
      title: title.trim(),
      kind,
      member_id: mid || null,
      calendar: cal,
      yearly: cal === 'lunar' ? true : yearly,
      event_date: cal === 'solar' ? date : null,
      lunar_month: cal === 'lunar' ? +lm : null,
      lunar_day: cal === 'lunar' ? +ld : null
    };
    if (await C.write(() => db.add('events', row), '달력에 넣었어요')) onClose();
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    title: "\uC77C\uC815 \uB123\uAE30",
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      onClick: save
    }, "\uC800\uC7A5")
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uBB34\uC2A8 \uB0A0\uC778\uAC00\uC694?"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    placeholder: "\uC608: \uD560\uC544\uBC84\uC9C0 \uAE30\uC77C, \uACB0\uD63C\uAE30\uB150\uC77C",
    value: title,
    onChange: e => setTitle(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC885\uB958"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, kinds.map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    type: "button",
    className: 'chip' + (kind === k ? ' on' : ''),
    onClick: () => {
      setKind(k);
      if (k !== 'event') setYearly(true);
    }
  }, l)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC591\uB825 / \uC74C\uB825"), /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cal === 'solar' ? 'on' : '',
    onClick: () => setCal('solar')
  }, "\uC591\uB825"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cal === 'lunar' ? 'on' : '',
    onClick: () => setCal('lunar')
  }, "\uC74C\uB825 (\uB9E4\uB144 \uC790\uB3D9 \uACC4\uC0B0)"))), cal === 'solar' ? /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uB0A0\uC9DC"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input",
    value: date,
    onChange: e => setDate(e.target.value)
  })) : /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC74C\uB825 \uB0A0\uC9DC"), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("select", {
    className: "input",
    value: lm,
    onChange: e => setLm(e.target.value)
  }, Array.from({
    length: 12
  }, (_, i) => /*#__PURE__*/React.createElement("option", {
    key: i,
    value: i + 1
  }, i + 1, "\uC6D4"))), /*#__PURE__*/React.createElement("select", {
    className: "input",
    value: ld,
    onChange: e => setLd(e.target.value)
  }, Array.from({
    length: 30
  }, (_, i) => /*#__PURE__*/React.createElement("option", {
    key: i,
    value: i + 1
  }, i + 1, "\uC77C")))), (() => {
    const s = solarOfLunar(new Date().getFullYear(), +lm, +ld);
    const n = s && s < ymd() ? solarOfLunar(new Date().getFullYear() + 1, +lm, +ld) : s;
    return n ? /*#__PURE__*/React.createElement("p", {
      className: "small muted",
      style: {
        margin: '6px 2px 0'
      }
    }, "\uB2E4\uC74C\uC740 \uC591\uB825 ", fmtDate(n, true), "\uC774\uC5D0\uC694.") : null;
  })()), cal === 'solar' && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement(Toggle, {
    on: yearly,
    onChange: setYearly,
    label: "\uB9E4\uB144 \uBC18\uBCF5",
    sub: "\uC0DD\uC77C\xB7\uAE30\uB150\uC77C\uC740 \uCF1C \uB450\uC138\uC694"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uB204\uAD6C\uC758 \uB0A0\uC778\uAC00\uC694? ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'chip' + (!mid ? ' on' : ''),
    onClick: () => setMid('')
  }, "\uAC00\uC871 \uBAA8\uB450"), C.members.map(m => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: m.id,
    className: 'chip' + (mid === m.id ? ' on' : ''),
    onClick: () => setMid(m.id)
  }, m.emoji, " ", m.name)))), /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC2DD\uAD6C \uC0DD\uC77C\uC740 \"\uC2DD\uAD6C \u2192 \uD504\uB85C\uD544 \uACE0\uCE58\uAE30\"\uC5D0\uC11C \uC0DD\uB144\uC6D4\uC77C\uC744 \uB123\uC73C\uBA74 \uB2EC\uB825\uC5D0 \uC800\uC808\uB85C \uB4E4\uC5B4\uAC00\uC694."));
}

/* ═══════════ 편지함 ═══════════ */
function LettersTab({
  onBack
}) {
  const C = useC();
  const [fil, setFil] = useState('all');
  const [note, setNote] = useState('');
  const list = C.letters.filter(l => fil === 'all' || (fil === 'in' ? l.receiver_id === C.me : l.sender_id === C.me));
  const wq = C.weekQ;
  const year = new Date().getFullYear();
  const yp = C.posts.filter(p => p.happened_on.startsWith(year + '') && !isLocked(p));
  const yPhotos = yp.reduce((n, p) => n + photosOf(p).length, 0);
  const yVoices = C.comments.filter(c => c.audio_url && c.created_at.startsWith(year + '')).length + C.answers.filter(a => a.audio_url && a.created_at.startsWith(year + '')).length;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar",
    style: {
      paddingLeft: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, onBack && /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onBack,
    "aria-label": "\uB4A4\uB85C"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-left",
    size: 28
  })), /*#__PURE__*/React.createElement("span", {
    className: "h1"
  }, "\uD3B8\uC9C0\uD568")), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.openLetterCompose({}),
    "aria-label": "\uD3B8\uC9C0 \uC4F0\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "square-pen",
    size: 26
  }))), wq && /*#__PURE__*/React.createElement(QHero, {
    q: wq,
    onOpen: () => C.openQuestion(wq)
  }), /*#__PURE__*/React.createElement("div", {
    className: "fil"
  }, [['all', '모두'], ['in', '나에게 온'], ['out', '내가 보낸']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: 'chip' + (fil === k ? ' on' : ''),
    onClick: () => setFil(k)
  }, l))), !list.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 \uD3B8\uC9C0\uAC00 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), "\uC624\uB978\uCABD \uC704 \uC5F0\uD544\uC744 \uB20C\uB7EC \uCCAB \uD3B8\uC9C0\uB97C \uC368 \uBCF4\uC138\uC694."), list.map(l => {
    const s = C.getM(l.sender_id),
      r = C.getM(l.receiver_id);
    const lock = isLocked(l);
    const isNew = l.receiver_id === C.me && !l.read_at && !lock;
    return /*#__PURE__*/React.createElement("button", {
      className: "lt",
      key: l.id,
      onClick: () => C.openLetter(l)
    }, /*#__PURE__*/React.createElement("div", {
      className: "env",
      style: lock ? {
        background: '#EEE8F7',
        color: '#6A55A3'
      } : isNew ? {
        background: '#FDEBE3',
        color: '#D0603A'
      } : {
        background: '#E3F1E9',
        color: '#2E7D5B'
      }
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: lock ? 'lock' : isNew ? 'mail' : 'mail-open'
    })), /*#__PURE__*/React.createElement("div", {
      className: "grow"
    }, /*#__PURE__*/React.createElement("b", null, s.name, " \u2192 ", r.name), /*#__PURE__*/React.createElement("span", null, lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.audio_url ? '🎙 ' : '') + (l.title || l.content))), isNew ? /*#__PURE__*/React.createElement("span", {
      className: "new"
    }, "\uC0C8 \uD3B8\uC9C0") : /*#__PURE__*/React.createElement("span", {
      className: "tiny muted"
    }, relTime(l.created_at)));
  }), /*#__PURE__*/React.createElement("div", {
    className: "sec-t"
  }, "\uD83D\uDCCC \uB0C9\uC7A5\uACE0 \uBA54\uBAA8"), /*#__PURE__*/React.createElement("div", {
    className: "notes"
  }, C.notes.map((n, i) => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    className: "note",
    onClick: () => C.openNote(n),
    style: {
      background: noteColors[i % 4],
      transform: `rotate(${n.angle || 0}deg)`
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "x",
    onClick: e => {
      e.stopPropagation();
      C.deleteNote(n);
    },
    "aria-label": "\uBA54\uBAA8 \uB5BC\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x",
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    className: "tiny muted"
  }, C.getM(n.author_id).name), n.content)), !C.notes.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\"\uC6B0\uC720 \uC0AC \uC624\uAE30\" \uAC19\uC740 \uC9E7\uC740 \uCABD\uC9C0\uB97C \uBD99\uC5EC \uB450\uC138\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "row gap pad"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input grow",
    placeholder: "\uCABD\uC9C0 \uD55C \uC904",
    value: note,
    onChange: e => setNote(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn primary sm",
    disabled: !note.trim(),
    onClick: async () => {
      if (await C.addNote(note.trim())) setNote('');
    }
  }, "\uBD99\uC774\uAE30")), /*#__PURE__*/React.createElement("button", {
    className: "book",
    onClick: () => C.openBook(year)
  }, /*#__PURE__*/React.createElement("div", {
    className: "cv"
  }, year, /*#__PURE__*/React.createElement("br", null), "\uC6B0\uB9AC", /*#__PURE__*/React.createElement("br", null), "\uAC00\uC871"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "\uC62C\uD574 \uC6B0\uB9AC \uAC00\uC871 \uCC45"), /*#__PURE__*/React.createElement("span", null, "\uC18C\uC2DD ", yp.length, "\uAC1C \xB7 \uC0AC\uC9C4 ", yPhotos, "\uC7A5 \xB7 \uBAA9\uC18C\uB9AC ", yVoices, "\uAC1C", /*#__PURE__*/React.createElement("br", null), "\uB20C\uB7EC\uC11C \uD55C \uAD8C\uC73C\uB85C \uBBF8\uB9AC \uBCF4\uAE30 \xB7 PDF \uC800\uC7A5"))));
}
function LetterCompose({
  cfg,
  onClose
}) {
  const C = useC();
  const open = !!cfg;
  const [to, setTo] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(null);
  const [cap, setCap] = useState(false);
  const [openOn, setOpenOn] = useState('');
  const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => {
    if (!cfg) return;
    const first = C.members.find(m => m.id !== C.me);
    setTo(cfg.to || (first ? first.id : C.me));
    setTitle('');
    setText('');
    setVoice(null);
    setCap(false);
    setOpenOn('');
    setBusy(false);
  }, [cfg]);
  const send = async () => {
    if (!text.trim() && !voice) {
      C.toast('편지 내용을 적거나 목소리를 남겨 주세요');
      return;
    }
    if (cap && !openOn) {
      C.toast('여는 날을 골라 주세요');
      return;
    }
    setBusy(true);
    try {
      const audio = voice ? await uploadVoice(voice.blob, voice.sec) : null;
      const body = text.trim() || voice && voice.text || '';
      const ok = await C.write(() => db.add('letters', {
        sender_id: C.me,
        receiver_id: to,
        title: title.trim() || body.slice(0, 24) || '목소리 편지',
        content: body,
        audio_url: audio,
        open_on: cap ? openOn : null
      }), cap ? `타임캡슐 편지를 잠갔어요 · ${fmtDate(openOn, true)}에 열려요` : '편지를 보냈어요');
      if (ok) onClose();else setBusy(false);
    } catch (e) {
      setBusy(false);
      C.toast('보내지 못했어요: ' + e.message);
    }
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: () => {
      if (!busy) onClose();
    },
    full: true,
    title: "\uD3B8\uC9C0 \uC4F0\uAE30",
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      disabled: busy,
      onClick: send
    }, busy ? /*#__PURE__*/React.createElement("span", {
      className: "spin dark"
    }) : '보내기')
  }, /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uB204\uAD6C\uC5D0\uAC8C?"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, C.members.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    type: "button",
    className: 'chip' + (to === m.id ? ' on' : ''),
    onClick: () => setTo(m.id)
  }, m.emoji, " ", m.name, m.id === C.me ? ' (나)' : '')))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC81C\uBAA9 ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: title,
    onChange: e => setTitle(e.target.value),
    placeholder: "\uC608: \uC2A4\uBB34 \uC0B4\uC758 \uC9C0\uC6B0\uC5D0\uAC8C"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uD3B8\uC9C0"), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 7,
    value: text,
    onChange: e => setText(e.target.value),
    placeholder: "\uAFB9\uAFB9 \uB20C\uB7EC \uC801\uC5B4 \uBCF4\uC138\uC694"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  }))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uBAA9\uC18C\uB9AC\uB3C4 \uB2F4\uC744\uAE4C\uC694?"), voice ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vp-b"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "check",
    size: 16,
    stroke: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    className: "wave"
  }), /*#__PURE__*/React.createElement("small", null, fmtSec(voice.sec))), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setVoice(null)
  }, "\uB2E4\uC2DC")) : /*#__PURE__*/React.createElement(RecordButton, {
    label: "\uBAA9\uC18C\uB9AC \uD3B8\uC9C0 \uB179\uC74C",
    onDone: async r => setVoice(r)
  })), /*#__PURE__*/React.createElement(CapsulePicker, {
    on: cap,
    setOn: setCap,
    date: openOn,
    setDate: setOpenOn,
    member: C.getM(to)
  }));
}
function LetterView({
  l,
  onClose
}) {
  const C = useC();
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    setPeek(false);
    if (l && l.receiver_id === C.me && !l.read_at && !isLocked(l)) C.markRead(l);
  }, [l && l.id]);
  const open = !!l;
  const s = l ? C.getM(l.sender_id) : null,
    r = l ? C.getM(l.receiver_id) : null;
  const lock = l && isLocked(l) && !peek;
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    title: "\uD3B8\uC9C0",
    full: true
  }, l && (lock ? /*#__PURE__*/React.createElement("div", {
    className: "locked",
    style: {
      margin: 0,
      padding: '40px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "lk"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "lock",
    size: 26
  })), /*#__PURE__*/React.createElement("b", null, josa(s.name, '이', '가'), " ", r.name, "\uC5D0\uAC8C \uB0A8\uAE34 \uD0C0\uC784\uCEA1\uC290"), /*#__PURE__*/React.createElement("p", null, fmtDate(l.open_on, true), "\uC5D0 \uC5F4\uB824\uC694 \xB7 ", ddayText(dayDiff(ymd(), l.open_on))), /*#__PURE__*/React.createElement("p", {
    className: "small"
  }, fmtDate(ymd(new Date(l.created_at)), true), "\uC5D0 \uC7A0\uAC14\uC5B4\uC694"), l.sender_id === C.me && /*#__PURE__*/React.createElement("button", {
    className: "btn sm line",
    style: {
      marginTop: 12,
      background: '#fff'
    },
    onClick: () => setPeek(true)
  }, "\uB0B4\uAC00 \uC4F4 \uAC83 \xB7 \uBBF8\uB9AC \uBCF4\uAE30")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: s,
    size: 40
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, s.name), " \u2192 ", r.name, /*#__PURE__*/React.createElement("div", {
    className: "small muted"
  }, fmtDate(ymd(new Date(l.created_at)), true), l.open_on ? ` · 🎁 ${fmtDate(l.open_on, true)}에 열린 타임캡슐` : '')), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.toggleSpeak('l' + l.id, `${josa(s.name, '이', '가')} ${r.name}에게 쓴 편지. ${l.content}`),
    "aria-label": "\uC77D\uC5B4 \uC8FC\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: C.speaking === 'l' + l.id ? 'volume-x' : 'volume-2'
  }))), l.title && /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 10px'
    }
  }, l.title), l.audio_url && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: l.audio_url
  })), l.content && /*#__PURE__*/React.createElement("div", {
    className: "letter-paper"
  }, l.content), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8,
      marginTop: 18
    }
  }, l.receiver_id === C.me && l.sender_id !== C.me && /*#__PURE__*/React.createElement("button", {
    className: "btn primary block",
    onClick: () => {
      onClose();
      setTimeout(() => C.openLetterCompose({
        to: l.sender_id
      }), 50);
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "send",
    size: 18
  }), "\uB2F5\uC7A5 \uC4F0\uAE30"), (l.sender_id === C.me || l.receiver_id === C.me) && /*#__PURE__*/React.createElement("button", {
    className: "btn soft block danger",
    onClick: () => C.deleteLetter(l)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trash-2",
    size: 18
  }), "\uD3B8\uC9C0 \uC9C0\uC6B0\uAE30")))));
}

/* ═══════════ 이번 주 질문 ═══════════ */
/* ═══════════ 이번 주의 질문: 한 사람이 묻고 온 가족이 답한다 ═══════════
   - 식구 순서대로 한 주씩 질문자가 돌아간다 (지난 질문자의 다음 식구)
   - 질문자는 질문 상자에서 고르거나, 글·말로 직접 묻는다. 한마디도 붙일 수 있다
   - 수요일 아침까지 안 정하면 서버가 상자에서 자동으로 고른다
   - 다 같이 공개: 모두 답하거나 토요일 밤 9시가 되면 답이 열린다 (그 전엔 내 답만 보임) */
const nextOf = (order, id) => {
  const i = order.findIndex(m => m.id === id);
  return order[(i + 1) % order.length] || order[0];
};
const revealAt = wk => {
  const d = parseYmd(wk);
  d.setDate(d.getDate() + 5);
  d.setHours(21, 0, 0, 0);
  return d;
}; // 토요일 밤 9시
function qState(C, q) {
  const ans = q ? C.answers.filter(a => a.question_id === q.id) : [];
  const done = [...new Set(ans.map(a => a.member_id))];
  const isCur = !!q && q.week_start === weekStart();
  const allDone = C.members.length > 0 && C.members.every(m => done.includes(m.id));
  return {
    ans,
    done,
    isCur,
    picking: !!q && !q.text,
    allDone,
    revealed: !isCur || allDone || Date.now() >= revealAt(q.week_start)
  };
}

/* 이번 주 질문 카드. inline=질문 창 안 (버튼 없음) */
function QHero({
  q,
  onOpen,
  inline
}) {
  const C = useC();
  const S = qState(C, q);
  const asker = C.getM(q.asker_id);
  const iAsk = q.asker_id === C.me;
  const mine = S.done.includes(C.me);
  const left = dayDiff(ymd(), ymd(revealAt(q.week_start))); // 공개일(토요일)까지 남은 날
  const status = S.picking ? '수요일 아침까지 안 정하면 자동으로 골라요' : S.allDone ? '모두 답했어요! 답이 열렸어요 🎁' : !S.isCur || S.revealed ? `답 ${S.done.length}개 · 답이 열렸어요 🎁` : `답 ${S.done.length}/${C.members.length} · ${left <= 0 ? '오늘' : left === 1 ? '내일' : '토요일'} 밤 9시에 다 같이 공개`;
  const cta = S.picking ? iAsk ? ['질문 정하기 →', ''] : ['순서 보기', 'done'] : S.revealed ? ['답 보러 가기 🎁', ''] : mine ? ['내 답 남김 ✓', 'done'] : ['답하기 →', ''];
  const Tag = inline ? 'div' : 'button';
  return /*#__PURE__*/React.createElement(Tag, {
    className: 'qhero' + (inline ? ' inline' : ''),
    onClick: inline ? undefined : onOpen
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh-top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pill"
  }, S.isCur ? '이번 주 질문' : `${fmtDate(q.week_start)} 주 질문`, " \u2753"), q.auto && !S.picking && /*#__PURE__*/React.createElement("span", {
    className: "pill"
  }, "\uC790\uB3D9\uC73C\uB85C \uACE8\uB790\uC5B4\uC694")), S.picking ? /*#__PURE__*/React.createElement("div", {
    className: "qh-q wait"
  }, iAsk ? '이번 주는 내가 온 가족에게 질문할 차례예요 🎤' : `${josa(asker.name, '이', '가')} 온 가족에게 물어볼 질문을 고르는 중이에요 🤔`) : /*#__PURE__*/React.createElement("div", {
    className: "qh-q"
  }, q.text), !S.picking && q.note && /*#__PURE__*/React.createElement("div", {
    className: "qh-note"
  }, "\uD83D\uDCAC \u201C", q.note, "\u201D"), !S.picking && q.audio_url && inline && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: q.audio_url
  })), !q.asker_id ? /*#__PURE__*/React.createElement("div", {
    className: "qh-by",
    style: {
      paddingLeft: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, "\uC608\uC804 \uBC29\uC2DD \uC9C8\uBB38")) : /*#__PURE__*/React.createElement("div", {
    className: "qh-by"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: asker,
    size: 26
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, asker.name), S.picking ? ' 차례 🎤' : josa(asker.name, '이', '가').slice(asker.name.length) + ' 물어요', q.audio_url && !inline ? ' · 🎙' : '')), /*#__PURE__*/React.createElement("div", {
    className: "qh-ft"
  }, /*#__PURE__*/React.createElement("span", {
    className: "qh-faces"
  }, C.members.map(m => /*#__PURE__*/React.createElement("span", {
    key: m.id,
    style: {
      opacity: S.done.includes(m.id) ? 1 : .35
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 24
  })))), /*#__PURE__*/React.createElement("span", {
    className: "qh-st"
  }, status), !inline && /*#__PURE__*/React.createElement("span", {
    className: 'qh-cta ' + cta[1]
  }, cta[0]), inline && !S.picking && /*#__PURE__*/React.createElement("button", {
    className: "qh-cta done",
    onClick: e => {
      e.stopPropagation();
      C.toggleSpeak('q' + q.id, `${asker.name}의 질문. ${q.text}`);
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "volume-2",
    size: 16
  }), "\uC77D\uC5B4 \uC8FC\uAE30")));
}

/* 순서표: 지난주 · 이번 주 · 다음 주들 */
function QTurns({
  cur,
  onOrder
}) {
  const C = useC();
  const order = C.members;
  const past = C.questions.filter(q => q.week_start < cur.week_start && q.asker_id && q.asker_id !== cur.asker_id).sort((a, b) => a.week_start.localeCompare(b.week_start)).slice(-1);
  const items = past.map(q => ({
    m: C.getM(q.asker_id),
    wk: q.week_start,
    tag: '✓',
    cls: 'done'
  }));
  items.push({
    m: C.getM(cur.asker_id),
    wk: cur.week_start,
    tag: '🎤',
    cls: 'now'
  });
  let id = cur.asker_id;
  for (let i = 1; i <= Math.min(6, Math.max(1, order.length - 1)); i++) {
    const n = nextOf(order, id);
    id = n && n.id;
    if (!n) break;
    items.push({
      m: n,
      wk: ymd(addDays(parseYmd(cur.week_start), 7 * i)),
      cls: ''
    });
  }
  const label = (wk, cls) => cls === 'now' ? '이번 주' : wk === ymd(addDays(parseYmd(cur.week_start), 7)) ? '다음 주' : wk === ymd(addDays(parseYmd(cur.week_start), -7)) ? '지난주' : fmtDot(wk).slice(5);
  return /*#__PURE__*/React.createElement("div", {
    className: "turns"
  }, /*#__PURE__*/React.createElement("div", {
    className: "turns-hd"
  }, /*#__PURE__*/React.createElement("b", null, "\uC9C8\uBB38 \uC21C\uC11C"), /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    style: {
      minHeight: 0,
      padding: 0
    },
    onClick: onOrder
  }, "\uC21C\uC11C \uBC14\uAFB8\uAE30")), /*#__PURE__*/React.createElement("div", {
    className: "turns-row"
  }, items.map((x, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: x.wk
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "turns-ar"
  }, "\u203A"), /*#__PURE__*/React.createElement("div", {
    className: 'turn ' + x.cls
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: x.m,
    size: 38
  }), /*#__PURE__*/React.createElement("b", null, x.m.name, x.tag && /*#__PURE__*/React.createElement(React.Fragment, null, " ", x.tag)), /*#__PURE__*/React.createElement("span", null, label(x.wk, x.cls)))))));
}

/* 질문 순서 바꾸기 (= 식구 순서) */
function TurnOrder({
  open,
  onClose
}) {
  const C = useC();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setList(C.members.map(m => m.id));
  }, [open]);
  const move = (i, d) => setList(l => {
    const n = [...l];
    const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const save = async () => {
    setBusy(true);
    const ok = await C.write(() => Promise.all(list.map((id, i) => db.patch('members', id, {
      sort: i + 1
    }))), '질문 순서를 바꿨어요');
    setBusy(false);
    if (ok) onClose();
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    title: "\uC9C8\uBB38 \uC21C\uC11C",
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      disabled: busy,
      onClick: save
    }, "\uC800\uC7A5")
  }, /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 0
    }
  }, "\uC704\uC5D0\uC11C\uBD80\uD130 \uCC28\uB840\uB85C \uD55C \uC8FC\uC529 \uC9C8\uBB38\uD574\uC694. \uC774 \uC21C\uC11C\uB294 \uC2DD\uAD6C \uBAA9\uB85D\xB7\uC2A4\uD1A0\uB9AC \uC21C\uC11C\uC640 \uAC19\uC544\uC694."), list.map((id, i) => {
    const m = C.getM(id);
    return /*#__PURE__*/React.createElement("div", {
      key: id,
      className: "row gap",
      style: {
        padding: '8px 0',
        borderBottom: '1px solid var(--line)'
      }
    }, /*#__PURE__*/React.createElement("b", {
      style: {
        width: 22,
        color: 'var(--sub)'
      }
    }, i + 1), /*#__PURE__*/React.createElement(Avatar, {
      m: m,
      size: 38
    }), /*#__PURE__*/React.createElement("b", {
      className: "grow"
    }, m.name), /*#__PURE__*/React.createElement("button", {
      className: "iconbtn",
      disabled: i === 0,
      onClick: () => move(i, -1),
      "aria-label": "\uC704\uB85C"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "chevron-up"
    })), /*#__PURE__*/React.createElement("button", {
      className: "iconbtn",
      disabled: i === list.length - 1,
      onClick: () => move(i, 1),
      "aria-label": "\uC544\uB798\uB85C"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "chevron-down"
    })));
  }));
}

/* 질문자가 질문 정하기: 상자에서 고르기 / 글·말로 쓰기 + 한마디 */
function QPicker({
  cur,
  onDone
}) {
  const C = useC();
  const [mode, setMode] = useState('box');
  const [text, setText] = useState(cur.text || '');
  const [note, setNote] = useState(cur.note || '');
  const [voice, setVoice] = useState(cur.audio_url || null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  const dictN = useDictation(t => setNote(s => joinText(s, t)));
  const used = new Set(C.questions.filter(q => q.id !== cur.id).map(q => q.text));
  const pool = C.bank.filter(b => !used.has(b.text)).sort((a, b) => (b.added_by ? 1 : 0) - (a.added_by ? 1 : 0));
  const shown = more ? pool : pool.slice(0, 8);
  const submit = async () => {
    if (!text.trim()) {
      C.toast('질문을 고르거나 적어 주세요');
      return;
    }
    setBusy(true);
    const ok = await C.write(() => db.patch('questions', cur.id, {
      text: text.trim(),
      note: note.trim() || null,
      audio_url: mode === 'write' ? voice : null,
      auto: false,
      picked_at: new Date().toISOString()
    }), '온 가족에게 질문을 냈어요 🎤');
    setBusy(false);
    if (ok && onDone) onDone();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "qpick"
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: mode === 'box' ? 'on' : '',
    onClick: () => setMode('box')
  }, "\uD83D\uDCE6 \uC9C8\uBB38 \uC0C1\uC790\uC5D0\uC11C"), /*#__PURE__*/React.createElement("button", {
    className: mode === 'write' ? 'on' : '',
    onClick: () => setMode('write')
  }, "\u270D\uFE0F \uC9C1\uC811 \uC4F0\uAE30\xB7\uB9D0\uD558\uAE30")), mode === 'box' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    style: {
      marginBottom: 8
    },
    onClick: () => {
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (p) setText(p.text);
    }
  }, "\uD83C\uDFB2 \uC544\uBB34\uAC70\uB098 \uD558\uB098 \uACE8\uB77C \uC918"), /*#__PURE__*/React.createElement("div", {
    className: "qlist"
  }, shown.map(b => /*#__PURE__*/React.createElement("button", {
    key: b.id,
    className: 'qitem' + (text === b.text ? ' on' : ''),
    onClick: () => setText(b.text)
  }, /*#__PURE__*/React.createElement("span", null, b.text), b.added_by && /*#__PURE__*/React.createElement("small", null, josa(C.getM(b.added_by).name, "이", "가"), " \uB123\uC740 \uC9C8\uBB38"))), !pool.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC0C1\uC790\uAC00 \uBE44\uC5C8\uC5B4\uC694. \uC9C1\uC811 \uC368 \uC8FC\uC138\uC694.")), pool.length > 8 && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    onClick: () => setMore(m => !m)
  }, more ? '접기' : `질문 ${pool.length - 8}개 더 보기`)), mode === 'write' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 3,
    placeholder: "\uC628 \uAC00\uC871\uC5D0\uAC8C \uBB3B\uACE0 \uC2F6\uC740 \uAC83\uC744 \uC801\uC5B4 \uBCF4\uC138\uC694",
    value: text,
    onChange: e => setText(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginTop: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, voice ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: voice
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setVoice(null)
  }, "\uBAA9\uC18C\uB9AC \uBE7C\uAE30")) : /*#__PURE__*/React.createElement(RecordButton, {
    block: true,
    label: "\uD83C\uDFA4 \uB0B4 \uBAA9\uC18C\uB9AC\uB85C \uC9C8\uBB38 \uB0A8\uAE30\uAE30",
    onDone: async r => {
      const url = await uploadVoice(r.blob, r.sec);
      setVoice(url);
      if (!text.trim() && r.text) setText(r.text);
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, "\uBAA9\uC18C\uB9AC\uB97C \uB0A8\uAE30\uBA74 \uC2DD\uAD6C\uB4E4\uC774 \uB0B4 \uBAA9\uC18C\uB9AC\uB85C \uC9C8\uBB38\uC744 \uB4E4\uC5B4\uC694."))), /*#__PURE__*/React.createElement("div", {
    className: "field",
    style: {
      margin: '14px 0 10px'
    }
  }, /*#__PURE__*/React.createElement("label", null, "\uD83D\uDCAC \uC9C8\uBB38\uC790\uC758 \uD55C\uB9C8\uB514 ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("input", {
    className: "input",
    placeholder: "\uC608: \uC5B4\uC81C \uC61B\uB0A0 \uC0AC\uC9C4 \uBCF4\uB2E4\uAC00 \uAD81\uAE08\uD574\uC84C\uC5B4\uC694",
    value: note,
    onChange: e => setNote(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dictN
  }))), text.trim() && /*#__PURE__*/React.createElement("div", {
    className: "qpreview"
  }, "\u201C", text.trim(), "\u201D"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary block",
    disabled: busy || !text.trim(),
    onClick: submit
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "send",
    size: 18
  }), "\uC774 \uC9C8\uBB38\uC744 \uC628 \uAC00\uC871\uC5D0\uAC8C \uB0B4\uAE30"));
}

/* 우리 가족 질문 상자: 언젠가 물어보고 싶은 질문 넣어 두기 */
function QBox() {
  const C = useC();
  const [t, setT] = useState('');
  const [open, setOpen] = useState(false);
  const dict = useDictation(x => setT(s => joinText(s, x)));
  const used = new Set(C.questions.map(q => q.text));
  const left = C.bank.filter(b => !used.has(b.text));
  const mine = C.bank.filter(b => b.added_by).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const add = async () => {
    const v = t.trim();
    if (!v) return;
    if (C.bank.some(b => b.text === v)) {
      C.toast('이미 상자에 있는 질문이에요');
      return;
    }
    if (await C.write(() => db.add('question_bank', {
      text: v,
      added_by: C.me
    }), '질문 상자에 넣었어요 📦')) setT('');
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "qbox"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sec-t",
    style: {
      width: '100%',
      padding: '18px 0 6px'
    },
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCE6 \uC6B0\uB9AC \uAC00\uC871 \uC9C8\uBB38 \uC0C1\uC790 ", /*#__PURE__*/React.createElement("span", {
    className: "small muted",
    style: {
      fontWeight: 400
    }
  }, "\xB7 \uB0A8\uC740 \uC9C8\uBB38 ", left.length, "\uAC1C")), /*#__PURE__*/React.createElement(LIcon, {
    name: open ? 'chevron-up' : 'chevron-down',
    size: 20
  })), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 8px'
    }
  }, "\uC5B8\uC820\uAC00 \uC628 \uAC00\uC871\uC5D0\uAC8C \uBB3B\uACE0 \uC2F6\uC740 \uC9C8\uBB38\uC744 \uB123\uC5B4 \uB450\uC138\uC694. \uC9C8\uBB38\uC790\uAC00 \uACE0\uB97C \uB54C \uB9E8 \uC704\uC5D0 \uBCF4\uC774\uACE0, \uC544\uBB34\uB3C4 \uC548 \uACE0\uB974\uBA74 \uC774\uAC83\uBD80\uD130 \uC790\uB3D9\uC73C\uB85C \uB098\uC640\uC694."), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("input", {
    className: "input grow",
    placeholder: "\uC608: \uD560\uBA38\uB2C8\uAC00 \uCC98\uC74C \uBC1B\uC740 \uC120\uBB3C\uC740?",
    value: t,
    onChange: e => setT(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') add();
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    style: {
      background: dict.on ? 'var(--accent)' : '#f0f0f0',
      color: dict.on ? '#fff' : 'inherit'
    },
    onClick: dict.toggle,
    "aria-label": "\uB9D0\uB85C \uC4F0\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "mic"
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn sm blue",
    disabled: !t.trim(),
    onClick: add
  }, "\uB123\uAE30")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, !mine.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC544\uC9C1 \uC2DD\uAD6C\uAC00 \uB123\uC740 \uC9C8\uBB38\uC774 \uC5C6\uC5B4\uC694. \uAE30\uBCF8 \uC9C8\uBB38 ", C.bank.length, "\uAC1C\uAC00 \uB4E4\uC5B4 \uC788\uC5B4\uC694."), mine.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.id,
    className: "row gap",
    style: {
      padding: '8px 0',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(b.added_by),
    size: 28
  }), /*#__PURE__*/React.createElement("span", {
    className: "grow",
    style: {
      fontSize: '.95rem'
    }
  }, b.text, used.has(b.text) && /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, " \xB7 \uC774\uBBF8 \uB098\uC654\uC5B4\uC694")), b.added_by === C.me && !used.has(b.text) && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    style: {
      minHeight: 0
    },
    onClick: () => C.write(() => db.del('question_bank', `id=eq.${b.id}`), '상자에서 뺐어요')
  }, "\uBE7C\uAE30")))));
}
function QuestionSheet({
  q,
  onClose
}) {
  const C = useC();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [editing, setEditing] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => {
    setView(q);
    setText('');
    setEditing(false);
  }, [q]);
  const cur = view ? C.questions.find(x => x.id === view.id) || view : null;
  const S = cur ? qState(C, cur) : null;
  const asker = cur ? C.getM(cur.asker_id) : null;
  const iAsk = cur && cur.asker_id === C.me;
  const past = C.questions.filter(x => !cur || x.id !== cur.id).filter(x => x.text);
  const answer = async row => {
    setBusy(true);
    const ok = await C.write(() => db.add('answers', {
      question_id: cur.id,
      member_id: C.me,
      ...row
    }), '답을 남겼어요');
    setBusy(false);
    return ok;
  };
  const showPicker = cur && S.isCur && iAsk && (S.picking || editing);
  const shownAns = cur ? S.revealed ? S.ans : S.ans.filter(a => a.member_id === C.me) : [];
  const passTo = cur && C.members.length > 1 ? nextOf(C.members, cur.asker_id) : null;
  return /*#__PURE__*/React.createElement(Sheet, {
    open: !!q,
    onClose: onClose,
    full: true,
    title: "\uC774\uBC88 \uC8FC\uC758 \uC9C8\uBB38",
    footer: cur && !S.picking && !showPicker && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(RecordButton, {
      block: true,
      label: "\uBAA9\uC18C\uB9AC\uB85C \uB2F5\uD558\uAE30",
      onDone: async r => {
        const url = await uploadVoice(r.blob, r.sec);
        await answer({
          audio_url: url,
          content: r.text || ''
        });
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "row gap"
    }, /*#__PURE__*/React.createElement("input", {
      className: "input grow",
      placeholder: "\uAE00\uB85C \uB2F5\uD558\uAE30\u2026",
      value: text,
      onChange: e => setText(e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      className: "iconbtn",
      style: {
        background: dict.on ? 'var(--accent)' : '#f0f0f0',
        color: dict.on ? '#fff' : 'inherit'
      },
      onClick: dict.toggle,
      "aria-label": "\uB9D0\uB85C \uC4F0\uAE30"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "mic"
    })), /*#__PURE__*/React.createElement("button", {
      className: "btn blue sm",
      disabled: !text.trim() || busy,
      onClick: async () => {
        if (await answer({
          content: text.trim()
        })) setText('');
      }
    }, "\uC62C\uB9AC\uAE30")))
  }, cur && /*#__PURE__*/React.createElement(React.Fragment, null, S.isCur && /*#__PURE__*/React.createElement(QTurns, {
    cur: cur,
    onOrder: () => setOrderOpen(true)
  }), /*#__PURE__*/React.createElement(QHero, {
    q: cur,
    inline: true
  }), showPicker && /*#__PURE__*/React.createElement(QPicker, {
    key: cur.id + (editing ? 'e' : ''),
    cur: cur,
    onDone: () => setEditing(false)
  }), S.isCur && iAsk && S.picking && passTo && passTo.id !== C.me && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    onClick: () => {
      if (window.confirm(`이번 주 질문 차례를 ${passTo.name}에게 넘길까요?\n그다음 차례도 한 칸씩 밀려요.`)) C.write(() => db.patch('questions', cur.id, {
        asker_id: passTo.id
      }), `${passTo.name}에게 차례를 넘겼어요`);
    }
  }, "\u23ED \uC774\uBC88 \uC8FC\uB294 ", passTo.name, "\uC5D0\uAC8C \uB118\uAE30\uAE30"), S.isCur && iAsk && !S.picking && !editing && !S.ans.length && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    onClick: () => setEditing(true)
  }, "\u270F\uFE0F \uC9C8\uBB38 \uB2E4\uC2DC \uACE0\uB974\uAE30"), editing && /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    onClick: () => setEditing(false)
  }, "\uACE0\uCE58\uAE30 \uADF8\uB9CC\uB450\uAE30"), !S.picking && /*#__PURE__*/React.createElement("div", {
    className: "qans"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("b", {
    className: "grow"
  }, "\uB2F5 ", S.done.length, "/", C.members.length), /*#__PURE__*/React.createElement("span", {
    className: "faces"
  }, C.members.map(m => /*#__PURE__*/React.createElement("span", {
    key: m.id,
    style: {
      opacity: S.done.includes(m.id) ? 1 : .3
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 26
  }))))), !S.revealed && /*#__PURE__*/React.createElement("div", {
    className: "qlock"
  }, "\uD83C\uDF81 \uB2E4 \uAC19\uC774 \uACF5\uAC1C \xB7 \uBAA8\uB450 \uB2F5\uD558\uAC70\uB098 ", /*#__PURE__*/React.createElement("b", null, "\uD1A0\uC694\uC77C \uBC24 9\uC2DC"), "\uAC00 \uB418\uBA74 \uD55C\uAEBC\uBC88\uC5D0 \uC5F4\uB824\uC694.", S.done.includes(C.me) ? ' 내 답만 먼저 보여요.' : ' 내 답을 남겨 보세요.'), S.revealed && !S.ans.length && /*#__PURE__*/React.createElement("p", {
    className: "empty",
    style: {
      padding: 20
    }
  }, "\uC544\uC9C1 \uB2F5\uC774 \uC5C6\uC5B4\uC694. \uC544\uB798\uC5D0\uC11C \uB9D0\uB85C \uB2F5\uD574 \uBCF4\uC138\uC694."), shownAns.map(a => /*#__PURE__*/React.createElement("div", {
    className: "cmt",
    key: a.id
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(a.member_id),
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("b", null, C.getM(a.member_id).name), a.audio_url ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: a.audio_url
  }), a.content && /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      color: '#5b4a86'
    }
  }, "\u201C", a.content, "\u201D")) : /*#__PURE__*/React.createElement("div", null, a.content), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", null, relTime(a.created_at)), a.member_id === C.me && /*#__PURE__*/React.createElement("button", {
    onClick: () => C.write(() => db.del('answers', `id=eq.${a.id}`), '답을 지웠어요')
  }, "\uC9C0\uC6B0\uAE30")))))), /*#__PURE__*/React.createElement(QBox, null), past.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sec-t",
    style: {
      padding: '18px 0 6px'
    }
  }, "\uC9C0\uB09C \uC9C8\uBB38\uB4E4"), past.map(x => {
    const n = C.answers.filter(a => a.question_id === x.id).length;
    const am = C.getM(x.asker_id);
    return /*#__PURE__*/React.createElement("button", {
      key: x.id,
      className: "lt",
      style: {
        padding: '10px 0'
      },
      onClick: () => {
        setView(x);
        setEditing(false);
      }
    }, x.asker_id ? /*#__PURE__*/React.createElement(Avatar, {
      m: am,
      size: 36
    }) : /*#__PURE__*/React.createElement("div", {
      className: "bic",
      style: {
        width: 36,
        height: 36,
        background: '#F3EEFF',
        color: '#6a3fc8',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, "\u2753"), /*#__PURE__*/React.createElement("div", {
      className: "grow"
    }, /*#__PURE__*/React.createElement("b", {
      style: {
        fontSize: '.95rem'
      }
    }, x.text), /*#__PURE__*/React.createElement("span", null, fmtDate(x.week_start), " \uC8FC \xB7 ", x.asker_id ? `${am.name}의 질문` : '예전 방식 질문', " \xB7 \uB2F5 ", n, "\uAC1C")));
  }))), /*#__PURE__*/React.createElement(TurnOrder, {
    open: orderOpen,
    onClose: () => setOrderOpen(false)
  }));
}

/* ═══════════ 함께 기도해요 ═══════════
   - 기도 제목(request): 글·말·목소리로 나누고, 누구를 위한 기도인지·그날(시험날 등)을 정한다
   - 목소리 기도(prayer): 식구를 위해 드린 기도를 목소리 그대로 남긴다
   - 🙏 기도했어요: 하루 한 번씩 쌓인다 (prayer_marks) · ✨ 응답됐어요: 감사 한 줄과 함께 응답 노트로
   - 그날 아침 8시엔 서버가 온 가족에게 "오늘 함께 기도해요" 알림 */
const prayFor = (C, p) => p.for_member ? C.getM(p.for_member).name : p.for_text || '';
function PrayCard({
  p,
  focus,
  feed
}) {
  const C = useC();
  const a = C.getM(p.author_id);
  const [menu, setMenu] = useState(false);
  const [ans, setAns] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (focus && ref.current) setTimeout(() => ref.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    }), 200);
  }, [focus]);
  useViewed(ref, p.id, 'pray', p.author_id);
  const marks = C.pmarks.filter(m => m.prayer_id === p.id);
  const who = [...new Set(marks.map(m => m.member_id))];
  const today = ymd();
  const todayWho = [...new Set(marks.filter(m => m.day === today).map(m => m.member_id))];
  const iDid = todayWho.includes(C.me);
  const fw = prayFor(C, p);
  const due = p.due_on ? dayDiff(today, p.due_on) : null;
  const mine = p.author_id === C.me;
  const voice = p.kind === 'prayer';
  return /*#__PURE__*/React.createElement("article", {
    ref: ref,
    className: 'pray' + (focus ? ' focus' : '') + (p.answered_at ? ' done' : '')
  }, feed && /*#__PURE__*/React.createElement("button", {
    className: "feed-band pr",
    onClick: () => C.openPray(p.id)
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDE4F \uD568\uAED8 \uAE30\uB3C4\uD574\uC694"), /*#__PURE__*/React.createElement("span", {
    className: "go"
  }, "\uAE30\uB3C4 \uD0ED ", /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pray-hd"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: a,
    size: 38,
    onClick: () => C.openProfile(a.id)
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, a.name), voice ? '의 목소리 기도 🎙' : '의 기도 제목'), /*#__PURE__*/React.createElement("div", {
    className: "pray-tags"
  }, /*#__PURE__*/React.createElement("span", null, relTime(p.created_at)), /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, "\uD83D\uDE4F ", fw ? `${josa(fw, '을', '를')} 위해` : '온 가족을 위해'), p.due_on && !p.answered_at && /*#__PURE__*/React.createElement("span", {
    className: 'tag' + (due === 0 ? ' today' : '')
  }, "\uD83D\uDCC5 ", due === 0 ? '오늘!' : due > 0 ? `${fmtDate(p.due_on)} · D-${due}` : fmtDate(p.due_on)))), mine && /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setMenu(true),
    "aria-label": "\uB354 \uBCF4\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "ellipsis"
  }))), p.content && /*#__PURE__*/React.createElement("div", {
    className: "pray-text"
  }, p.content), p.audio_url && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 16px 8px'
    }
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: p.audio_url
  })), p.answered_at && /*#__PURE__*/React.createElement("div", {
    className: "pray-ans"
  }, "\u2728 ", /*#__PURE__*/React.createElement("b", null, "\uC751\uB2F5\uB410\uC5B4\uC694"), " \xB7 ", fmtDate(ymd(new Date(p.answered_at)), true), p.answer_note && /*#__PURE__*/React.createElement("div", null, "\u201C", p.answer_note, "\u201D")), /*#__PURE__*/React.createElement("div", {
    className: "pray-ft"
  }, /*#__PURE__*/React.createElement("span", {
    className: "qh-faces"
  }, who.slice(0, 6).map(id => /*#__PURE__*/React.createElement("span", {
    key: id
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(id),
    size: 24
  })))), /*#__PURE__*/React.createElement("span", {
    className: "grow small muted"
  }, marks.length ? `${marks.length}번 함께 기도했어요${todayWho.length ? ` · 오늘 ${todayWho.map(id => C.getM(id).name).join(', ')}` : ''}` : '아직 아무도 기도하지 않았어요'), !p.answered_at && /*#__PURE__*/React.createElement("button", {
    className: 'pray-btn' + (iDid ? ' on' : ''),
    onClick: () => C.togglePray(p)
  }, iDid ? '오늘 기도했어요 ✓' : voice ? '🙏 아멘' : '🙏 기도했어요')), /*#__PURE__*/React.createElement(Sheet, {
    open: menu,
    onClose: () => setMenu(false),
    title: voice ? '목소리 기도' : '기도 제목'
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft block",
    onClick: () => {
      setMenu(false);
      setEditing(true);
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "pencil",
    size: 18
  }), "\uAE00 \uACE0\uCE58\uAE30"), !voice && !p.answered_at && /*#__PURE__*/React.createElement("button", {
    className: "btn soft block",
    onClick: () => {
      setMenu(false);
      setAns(true);
    }
  }, "\u2728 \uC751\uB2F5\uB410\uC5B4\uC694 (\uAC10\uC0AC \uB098\uB204\uAE30)"), p.answered_at && /*#__PURE__*/React.createElement("button", {
    className: "btn soft block",
    onClick: () => {
      setMenu(false);
      C.write(() => db.patch('prayers', p.id, {
        answered_at: null,
        answer_note: null
      }), '다시 기도 중으로 옮겼어요');
    }
  }, "\uB2E4\uC2DC \uAE30\uB3C4 \uC911\uC73C\uB85C \uC62E\uAE30\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn soft block danger",
    onClick: () => {
      setMenu(false);
      if (window.confirm('이 기도를 지울까요?')) {
        C.write(() => db.del('prayers', `id=eq.${p.id}`), '지웠어요');
        const id = driveId(p.audio_url);
        if (id) gw('delete', {
          id
        }).catch(() => {});
      }
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trash-2",
    size: 18
  }), "\uC9C0\uC6B0\uAE30"))), /*#__PURE__*/React.createElement(PrayAnswer, {
    p: ans ? p : null,
    onClose: () => setAns(false)
  }), /*#__PURE__*/React.createElement(PrayCompose, {
    open: editing,
    edit: p,
    onClose: () => setEditing(false)
  }));
}

/* ✨ 응답됐어요: 감사 한 줄 */
function PrayAnswer({
  p,
  onClose
}) {
  const C = useC();
  const [t, setT] = useState('');
  const dict = useDictation(x => setT(s => joinText(s, x)));
  useEffect(() => {
    if (p) setT('');
  }, [p]);
  const save = async () => {
    if (await C.write(() => db.patch('prayers', p.id, {
      answered_at: new Date().toISOString(),
      answer_note: t.trim() || null
    }), '응답 노트에 담았어요 ✨')) onClose();
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: !!p,
    onClose: onClose,
    title: "\u2728 \uC751\uB2F5\uB410\uC5B4\uC694",
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      onClick: save
    }, "\uC800\uC7A5")
  }, p && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 0
    }
  }, "\u201C", p.content || '목소리 기도', "\u201D"), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uAC10\uC0AC \uD55C \uC904 ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD)")), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 3,
    placeholder: "\uC608: \uC218\uC220 \uC798 \uB05D\uB0AC\uC5B4\uC694. \uD568\uAED8 \uAE30\uB3C4\uD574 \uC918\uC11C \uACE0\uB9C8\uC6CC\uC694",
    value: t,
    onChange: e => setT(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  }))), /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC751\uB2F5 \uB178\uD2B8\uC5D0 \uCC28\uACE1\uCC28\uACE1 \uC313\uC774\uACE0, \uC5F0\uB9D0 \uAC00\uC871 \uCC45\uC5D0\uB3C4 \uC2E4\uB824\uC694. \uC628 \uAC00\uC871\uC5D0\uAC8C \uC54C\uB9BC\uC774 \uAC00\uC694.")));
}

/* 기도 나누기 (기도 제목 / 목소리 기도) */
function PrayCompose({
  open,
  onClose,
  edit
}) {
  const C = useC();
  const [kind, setKind] = useState('request');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(null);
  const [keep, setKeep] = useState(null); // 고칠 때: 이미 남긴 목소리 (빼면 null)
  const [forWho, setForWho] = useState('');
  const [other, setOther] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const dict = useDictation(t => setText(s => joinText(s, t)));
  useEffect(() => {
    if (!open) return;
    const e = edit;
    setKind(e ? e.kind : 'request');
    setText(e ? e.content || '' : '');
    setVoice(null);
    setKeep(e ? e.audio_url || null : null);
    setForWho(e ? e.for_member || (e.for_text ? 'other' : '') : '');
    setOther(e ? e.for_text || '' : '');
    setDue(e ? e.due_on || '' : '');
    setBusy(false);
  }, [open]);
  const can = !busy && (kind === 'prayer' ? !!(voice || keep) : !!(text.trim() || voice || keep));
  const submit = async () => {
    setBusy(true);
    try {
      const audio = voice ? await uploadVoice(voice.blob, voice.sec) : keep;
      const row = {
        kind,
        content: text.trim() || (kind === 'prayer' && voice && voice.text ? voice.text : ''),
        audio_url: audio,
        for_member: forWho && forWho !== 'other' ? forWho : null,
        for_text: forWho === 'other' ? other.trim() || null : null,
        due_on: kind === 'request' && due ? due : null
      };
      if (edit) {
        // 고치기: 바뀐 목소리면 옛 녹음은 드라이브에서 지운다
        const ok = await C.write(() => db.patch('prayers', edit.id, row), '기도를 고쳤어요');
        if (ok) {
          if (edit.audio_url && edit.audio_url !== audio) {
            const id = driveId(edit.audio_url);
            if (id) gw('delete', {
              id
            }).catch(() => {});
          }
          onClose();
        } else setBusy(false);
        return;
      }
      if (await C.write(() => db.add('prayers', {
        ...row,
        author_id: C.me
      }), kind === 'prayer' ? '목소리 기도를 남겼어요 🎙' : '기도 제목을 나눴어요 🙏')) onClose();else setBusy(false);
    } catch (e) {
      setBusy(false);
      C.toast('올리지 못했어요: ' + e.message);
    }
  };
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: () => {
      if (!busy) onClose();
    },
    full: true,
    title: edit ? '기도 고치기' : '기도 나누기',
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      disabled: !can,
      onClick: submit
    }, busy ? /*#__PURE__*/React.createElement("span", {
      className: "spin dark"
    }) : edit ? '저장' : '올리기')
  }, !edit && /*#__PURE__*/React.createElement("div", {
    className: "seg",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: kind === 'request' ? 'on' : '',
    onClick: () => setKind('request')
  }, "\uD83D\uDE4F \uAE30\uB3C4 \uC81C\uBAA9 \uB098\uB204\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: kind === 'prayer' ? 'on' : '',
    onClick: () => setKind('prayer')
  }, "\uD83C\uDF99 \uBAA9\uC18C\uB9AC \uAE30\uB3C4 \uB0A8\uAE30\uAE30")), kind === 'request' ? /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC5B4\uB5A4 \uAE30\uB3C4\uAC00 \uD544\uC694\uD558\uC138\uC694?"), /*#__PURE__*/React.createElement("textarea", {
    className: "input",
    rows: 4,
    placeholder: "\uC608: \uC9C0\uC628\uC774 \uC218\uD559 \uC2DC\uD5D8 \uC798 \uBCF4\uAC8C / \uD560\uBA38\uB2C8 \uBB34\uB98E \uC218\uC220 \uC798 \uB418\uAC8C",
    value: text,
    onChange: e => setText(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(MicButton, {
    dict: dict
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, voice ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vp-b"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "check",
    size: 16,
    stroke: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    className: "wave"
  }), /*#__PURE__*/React.createElement("small", null, fmtSec(voice.sec))), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setVoice(null)
  }, "\uBAA9\uC18C\uB9AC \uBE7C\uAE30")) : keep ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: keep
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setKeep(null)
  }, "\uBAA9\uC18C\uB9AC \uBE7C\uAE30")) : /*#__PURE__*/React.createElement(RecordButton, {
    label: "\uBAA9\uC18C\uB9AC\uB85C\uB3C4 \uB0A8\uAE30\uAE30 (\uC120\uD0DD)",
    onDone: async r => {
      setVoice(r);
      if (!text.trim() && r.text) setText(r.text);
    }
  }))) : /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC2DD\uAD6C\uB97C \uC704\uD574 \uB4DC\uB9AC\uB294 \uAE30\uB3C4\uB97C \uBAA9\uC18C\uB9AC\uB85C \uB0A8\uACA8\uC694"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 8px'
    }
  }, "\uD560\uBA38\uB2C8\xB7\uD560\uC544\uBC84\uC9C0\uC758 \uAE30\uB3C4\uB294 \uC624\uB798\uC624\uB798 \uB4E4\uC744 \uC218 \uC788\uB294 \uBCF4\uBB3C\uC774 \uB3FC\uC694. \uB0B4 \uD504\uB85C\uD544\uC758 ", /*#__PURE__*/React.createElement("b", null, "\uBAA9\uC18C\uB9AC"), "\uC5D0\uB3C4 \uBAA8\uC5EC\uC694."), voice ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "vp-b"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "check",
    size: 16,
    stroke: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    className: "wave"
  }), /*#__PURE__*/React.createElement("small", null, fmtSec(voice.sec))), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setVoice(null)
  }, "\uB2E4\uC2DC \uB179\uC74C")) : keep ? /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement(VoicePlayer, {
    src: keep
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setKeep(null)
  }, "\uB2E4\uC2DC \uB179\uC74C")) : /*#__PURE__*/React.createElement(RecordButton, {
    block: true,
    label: "\uD83C\uDF99 \uAE30\uB3C4 \uB179\uC74C\uD558\uAE30",
    onDone: async r => {
      setVoice(r);
    }
  }), /*#__PURE__*/React.createElement("input", {
    className: "input",
    style: {
      marginTop: 10
    },
    placeholder: "\uD55C \uC904 (\uC120\uD0DD) \uC608: \uC190\uC8FC\uB4E4\uC744 \uC704\uD55C \uC544\uCE68 \uAE30\uB3C4",
    value: text,
    onChange: e => setText(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uB204\uAD6C\uB97C \uC704\uD55C \uAE30\uB3C4\uC778\uAC00\uC694?"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'chip' + (!forWho ? ' on' : ''),
    onClick: () => setForWho('')
  }, "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66 \uC628 \uAC00\uC871"), C.members.map(m => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: m.id,
    className: 'chip' + (forWho === m.id ? ' on' : ''),
    onClick: () => setForWho(m.id)
  }, m.emoji, " ", m.name, m.id === C.me ? ' (나)' : '')), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: 'chip' + (forWho === 'other' ? ' on' : ''),
    onClick: () => setForWho('other')
  }, "\uB2E4\uB978 \uC0AC\uB78C")), forWho === 'other' && /*#__PURE__*/React.createElement("input", {
    className: "input",
    style: {
      marginTop: 8
    },
    placeholder: "\uC608: \uC678\uC0BC\uCD0C, \uAD50\uD68C \uC9D1\uC0AC\uB2D8",
    value: other,
    onChange: e => setOther(e.target.value)
  })), kind === 'request' && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uADF8\uB0A0\uC774 \uC788\uB098\uC694? ", /*#__PURE__*/React.createElement("span", {
    className: "muted",
    style: {
      fontWeight: 400
    }
  }, "(\uC120\uD0DD \xB7 \uC2DC\uD5D8\uB0A0, \uC218\uC220\uB0A0, \uBA74\uC811\uB0A0)")), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input",
    min: ymd(),
    value: due,
    onChange: e => setDue(e.target.value)
  }), due && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, due === ymd() && new Date().getHours() >= 8 ? '오늘 아침 알림 시간(8시)은 지났어요. 기도 탭에서는 "오늘!"로 맨 위에 보여요.' : `${fmtDate(due, true)} 아침 8시에 온 가족에게 "오늘 함께 기도해요 🙏" 알림이 가요.`)));
}
function PrayTab() {
  const C = useC();
  const [view, setView] = useState('now');
  const [compose, setCompose] = useState(false);
  const all = C.prayers;
  const now = all.filter(p => !p.answered_at);
  const done = all.filter(p => p.answered_at).sort((a, b) => b.answered_at.localeCompare(a.answered_at));
  const today = ymd();
  const todays = now.filter(p => p.due_on === today);
  const list = view === 'now' ? [...todays, ...now.filter(p => p.due_on !== today)] : done;
  const prayedToday = [...new Set(C.pmarks.filter(m => m.day === today).map(m => m.member_id))];
  useEffect(() => {
    if (C.prayFocus) {
      const p = all.find(x => x.id === C.prayFocus);
      if (p) setView(p.answered_at ? 'done' : 'now');
    }
  }, [C.prayFocus]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "h1"
  }, "\uD568\uAED8 \uAE30\uB3C4\uD574\uC694 \uD83D\uDE4F"), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => setCompose(true),
    "aria-label": "\uAE30\uB3C4 \uB098\uB204\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "square-pen",
    size: 26
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pray-hero"
  }, /*#__PURE__*/React.createElement("b", null, "\uAE30\uB3C4 \uC81C\uBAA9\uC744 \uB098\uB204\uACE0, \uC11C\uB85C\uB97C \uC704\uD574 \uAE30\uB3C4\uD574\uC694"), /*#__PURE__*/React.createElement("span", null, prayedToday.length ? `오늘 ${prayedToday.map(id => C.getM(id).name).join(', ')}${josa(C.getM(prayedToday[prayedToday.length - 1]).name, '이', '가').slice(-1)} 함께 기도했어요` : '오늘 첫 번째로 기도해 보세요'), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    onClick: () => setCompose(true)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "hand-heart",
    size: 18
  }), "\uAE30\uB3C4 \uB098\uB204\uAE30")), /*#__PURE__*/React.createElement("div", {
    className: "pad",
    style: {
      margin: '2px 0 10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "seg"
  }, /*#__PURE__*/React.createElement("button", {
    className: view === 'now' ? 'on' : '',
    onClick: () => setView('now')
  }, "\uD83D\uDE4F \uAE30\uB3C4 \uC911 ", now.length), /*#__PURE__*/React.createElement("button", {
    className: view === 'done' ? 'on' : '',
    onClick: () => setView('done')
  }, "\u2728 \uC751\uB2F5 \uB178\uD2B8 ", done.length))), !list.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, view === 'now' ? /*#__PURE__*/React.createElement(React.Fragment, null, "\uC544\uC9C1 \uAE30\uB3C4 \uC81C\uBAA9\uC774 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uC704\uC758 ", /*#__PURE__*/React.createElement("b", null, "\uAE30\uB3C4 \uB098\uB204\uAE30"), "\uB85C \uCCAB \uAE30\uB3C4 \uC81C\uBAA9\uC744 \uC62C\uB824 \uBCF4\uC138\uC694.")) : /*#__PURE__*/React.createElement(React.Fragment, null, "\uC544\uC9C1 \uC751\uB2F5 \uB178\uD2B8\uAC00 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uAE30\uB3C4\uAC00 \uC774\uB8E8\uC5B4\uC9C0\uBA74 \uADF8 \uAE30\uB3C4 \uC81C\uBAA9\uC758 \u2022\u2022\u2022 \u2192 ", /*#__PURE__*/React.createElement("b", null, "\uC751\uB2F5\uB410\uC5B4\uC694"), "\uB97C \uB20C\uB7EC \uAC10\uC0AC\uB97C \uB098\uB220\uC694."))), list.map(p => /*#__PURE__*/React.createElement(PrayCard, {
    key: p.id,
    p: p,
    focus: C.prayFocus === p.id
  })), /*#__PURE__*/React.createElement(PrayCompose, {
    open: compose,
    onClose: () => setCompose(false)
  }));
}

/* ═══════════ 알림 (맨 위 ❤ 로 여는 창) ═══════════ */
function NotiPage({
  open,
  onClose
}) {
  useLayer(open, onClose);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "page",
    style: {
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement(NotiTab, {
    onBack: onClose
  }));
}
function NotiTab({
  onBack
}) {
  const C = useC();
  const fresh = C.activity.filter(x => x.isNew);
  const old = C.activity.filter(x => !x.isNew);
  const row = x => /*#__PURE__*/React.createElement("div", {
    key: x.key,
    className: "ltw",
    style: x.isNew ? {
      background: '#FFF7F3'
    } : undefined
  }, /*#__PURE__*/React.createElement("button", {
    className: "lt",
    onClick: x.go
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(x.who),
    size: 46
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: '.98rem',
      whiteSpace: 'normal'
    }
  }, x.text), /*#__PURE__*/React.createElement("span", null, relTime(x.t))), x.thumb && /*#__PURE__*/React.createElement("img", {
    src: x.thumb,
    alt: "",
    style: {
      width: 50,
      height: 50,
      borderRadius: 10,
      objectFit: 'cover'
    }
  })), /*#__PURE__*/React.createElement("button", {
    className: "ltx",
    onClick: () => C.hideNoti(x.key),
    "aria-label": "\uC774 \uC54C\uB9BC \uC9C0\uC6B0\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x",
    size: 18
  })));
  const soon = C.members.map(m => ({
    m,
    d: C.bdayDays(m.id)
  })).filter(x => x.d !== null && x.d <= 14).sort((x, y) => x.d - y.d);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar",
    style: {
      paddingLeft: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, onBack && /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onBack,
    "aria-label": "\uB4A4\uB85C"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-left",
    size: 28
  })), /*#__PURE__*/React.createElement("span", {
    className: "h1"
  }, "\uC54C\uB9BC")), C.activity.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => {
      if (window.confirm('알림을 모두 지울까요? (이 폰에서만 지워져요)')) {
        C.clearNoti();
        C.toast('알림을 모두 지웠어요');
      }
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trash-2",
    size: 16
  }), "\uBAA8\uB450 \uC9C0\uC6B0\uAE30")), /*#__PURE__*/React.createElement("div", {
    className: "sheetcard"
  }, soon.map(({
    m,
    d
  }) => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    className: "lt",
    onClick: () => C.openProfile(m.id)
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 46,
    ring: "bday"
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, "\uD83C\uDF82 ", m.name, " \uC0DD\uC77C ", d === 0 ? '오늘이에요!' : `${d}일 남았어요`), /*#__PURE__*/React.createElement("span", null, "\uB20C\uB7EC\uC11C \uCD95\uD558 \uD3B8\uC9C0 \uC4F0\uAE30\xB7\uC0AC\uC9C4 \uBCF4\uAE30")))), fresh.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sec-t"
  }, "\uC0C8\uB85C \uC628 \uC18C\uC2DD"), fresh.map(row), old.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "sec-t"
  }, "\uC9C0\uB09C 2\uC8FC"), old.map(row), !C.activity.length && !soon.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 \uC54C\uB9BC\uC774 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uC2DD\uAD6C\uAC00 \uC18C\uC2DD\xB7\uB313\uAE00\xB7\uD3B8\uC9C0\uB97C \uB0A8\uAE30\uBA74 \uC5EC\uAE30 \uBAA8\uC5EC\uC694."))));
}

/* ═══════════ 관리자 · 가족 포인트 (관리자 폰에서만) ═══════════ */
/* 방문: 앱을 열 때·10분 넘게 쉬었다 다시 볼 때 한 번 (점수는 하루 1번만) */
const logVisit = member => {
  if (!member || !familyKey) return;
  const t = Date.now(),
    key = `${member}|${ymd()}`;
  if (store.get('fz_vis_k') === key && t - +(store.get('fz_vis_t') || 0) < 10 * 60e3) return;
  db.rpc('log_visit', {
    p_member: member
  }).then(() => {
    store.set('fz_vis_k', key);
    store.set('fz_vis_t', String(t));
  }).catch(() => {}); // 적힌 뒤에만 "적었음" (PIN 전 실패는 다음에 다시)
};
/* 조회: 남의 소식·기도가 화면에 1초 넘게 보이면 한 번 (같은 건 다시 안 셈) */
const viewed = new Set((() => {
  try {
    return JSON.parse(store.get('fz_viewed') || '[]');
  } catch (e) {
    return [];
  }
})());
const markViewed = (me, id, kind) => {
  const k = me + ':' + id;
  if (viewed.has(k)) return;
  viewed.add(k);
  store.set('fz_viewed', JSON.stringify([...viewed].slice(-3000)));
  db.addOnce('views', {
    item_id: id,
    member_id: me,
    kind
  }, 'item_id,member_id').catch(() => viewed.delete(k));
};
function useViewed(ref, id, kind, author) {
  const C = useC();
  useEffect(() => {
    const el = ref.current;
    if (!el || !id || !C.me || author === C.me || viewed.has(C.me + ':' + id) || !window.IntersectionObserver) return;
    let t = 0;
    const io = new IntersectionObserver(es => {
      clearTimeout(t);
      if (es[0].isIntersecting) t = setTimeout(() => {
        io.disconnect();
        markViewed(C.me, id, kind);
      }, 1000);
    }, {
      threshold: 0.35
    });
    io.observe(el);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [id, C.me]);
}
const TABLE_KO = {
  members: '식구',
  posts: '소식',
  comments: '댓글',
  reactions: '마음',
  notes: '냉장고 메모',
  events: '일정',
  letters: '편지',
  questions: '이번 주 질문',
  answers: '답',
  question_bank: '질문 상자',
  prayers: '기도',
  prayer_marks: '기도했어요',
  memories: '추억',
  wishes: '바라는 것',
  event_tasks: '할 일',
  visits: '방문 기록',
  views: '조회 기록',
  app_settings: '설정'
};
/* 점수 규칙 (서버 family_points 와 같은 기본값) */
const POINT_DEF = {
  visit: 2,
  post: 10,
  daily: 5,
  answer: 10,
  comment: 3,
  letter: 5,
  prayer: 5,
  pmark: 2,
  react: 1,
  view: 1,
  post_cap: 3,
  daily_cap: 1,
  comment_cap: 10,
  letter_cap: 3,
  prayer_cap: 3,
  view_cap: 30
};
/* [규칙, 이름, 기록 칸, 따로 붙는 설명] · 규칙_cap 이 있으면 "하루 n개까지"를 붙인다 */
const POINT_ROWS = [['visit', '앱 들어오기', 'visits', '하루 1번만'], ['post', '새 소식 올리기', 'posts'], ['daily', '오늘의 한 장', 'daily'], ['answer', '이번 주 질문에 답', 'answers'], ['comment', '댓글', 'comments'], ['letter', '편지 보내기', 'letters'], ['prayer', '기도 제목 나누기', 'prayers'], ['pmark', '기도했어요', 'pmarks', '기도마다 하루 1번'], ['react', '마음(이모지) 남기기', 'reacts', '남의 소식에만'], ['view', '소식 보기 (조회)', 'views', '하나당 1번']];
const ruleNote = (k, rules, note) => [note, rules[k + '_cap'] !== undefined ? `하루 ${rules[k + '_cap']}개까지` : ''].filter(Boolean).join(' · ');
const dayAdd = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
function periodOf(k) {
  const t = ymd(),
    d = parseYmd(t);
  if (k === 'week') return [dayAdd(t, -((d.getDay() + 6) % 7)), t];
  if (k === 'last') return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (k === 'year') return [`${d.getFullYear()}-01-01`, t];
  return [t.slice(0, 8) + '01', t];
}
function AdminSheet({
  open,
  onClose
}) {
  const C = useC();
  const today = ymd();
  const [D, setD] = useState(null);
  const [per, setPer] = useState('month');
  const [pts, setPts] = useState(null);
  const [rules, setRules] = useState(POINT_DEF);
  const [edit, setEdit] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinMode, setPinMode] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [rpin, setRpin] = useState('');
  const [bk, setBk] = useState({}); // 'new' 처음 정하기 · 'change' 바꾸기
  const recent = useMemo(() => [...C.posts.filter(p => !isLocked(p)).map(p => ({
    id: p.id,
    kind: 'post',
    author: p.author_id,
    t: p.created_at,
    text: p.kind === 'daily' ? `오늘의 한 장${p.content ? ' · ' + p.content : ''}` : p.title || p.content || `사진 ${photosOf(p).length}장`
  })), ...C.prayers.map(p => ({
    id: p.id,
    kind: 'pray',
    author: p.author_id,
    t: p.created_at,
    text: `🙏 ${p.content || '목소리 기도'}`
  }))].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 6), [C.posts, C.prayers]);
  const load = async () => {
    const since = dayAdd(today, -40);
    const ids = recent.map(x => x.id);
    const [vs, ws, ps, st, first, hasPin, pins] = await Promise.all([db.list('visits', `select=*&day=gte.${since}&order=day,member_id`).catch(() => []), ids.length ? db.list('views', `select=item_id,member_id&item_id=in.(${ids.join(',')})&order=item_id,member_id`).catch(() => []) : [], db.list('push_subs', 'select=member_id&order=member_id').catch(() => []), db.list('app_settings', 'select=*&k=eq.points&order=k').catch(() => []), sb('visits?select=day&order=day.asc&limit=1').catch(() => []), db.rpc('admin_pin_set').catch(() => false), db.rpc('pins_state').catch(() => [])]);
    setRules({
      ...POINT_DEF,
      ...(st[0] && st[0].v || {})
    });
    setD({
      vs,
      ws,
      ps,
      first: first[0] && first[0].day,
      hasPin: !!hasPin,
      pins: pins || []
    });
  };
  const loadPts = async k => {
    setPts(null);
    const [a, b] = periodOf(k);
    try {
      setPts((await db.rpc('family_points', {
        p_from: a,
        p_to: b
      })) || []);
    } catch (e) {
      setPts([]);
    }
  };
  useEffect(() => {
    if (open) {
      setD(null);
      load();
      loadPts(per);
    }
  }, [open]);
  const pick = k => {
    setPer(k);
    loadPts(k);
  };
  /* 점수 규칙은 관리자 PIN 이 맞아야 서버가 바꿔 준다 (가족 암호만으로는 못 바꿈) */
  const saveRules = async () => {
    if (!pin) {
      C.toast('관리자 PIN을 넣어 주세요');
      return;
    }
    const v = {};
    Object.keys(POINT_DEF).forEach(k => {
      v[k] = Math.max(0, Math.round(+edit[k] || 0));
    });
    if (await C.write(() => rpcOk('set_points', {
      p_pin: pin,
      p_rules: v
    }), '점수 규칙을 바꿨어요')) {
      setRules(v);
      setEdit(null);
      setPin('');
      loadPts(per);
    }
  };
  /* 백업에서 되살리기: 목록(창구 v4) 또는 파일 → 미리 세어 보기 → 되살리기 */
  const loadBackups = async () => {
    setBk({
      busy: true
    });
    if ((await gwVersion()) < 4) {
      setBk({});
      C.toast('사진 창구를 v4로 배포하면 목록이 보여요. 지금은 "파일에서 고르기"를 써 주세요');
      return;
    }
    try {
      setBk({
        list: (await gw('bklist')).list || []
      });
    } catch (e) {
      setBk({});
      C.toast('백업 목록을 못 불러왔어요: ' + e.message);
    }
  };
  const pickBackup = async x => {
    setBk(b => ({
      ...b,
      busy: true
    }));
    try {
      let text = x.text;
      if (!text) {
        const r = await gw('get', {
          id: x.id
        });
        const bin = atob(r.data);
        text = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
      }
      const data = JSON.parse(text);
      if (data.app !== 'THE FAMILY ZONE') throw new Error('패밀리그램 백업 파일이 아니에요');
      setBk(b => ({
        ...b,
        busy: false,
        data,
        day: x.day && /^\d{4}-/.test(x.day) ? fmtDate(x.day, true) : x.day
      }));
    } catch (e) {
      setBk(b => ({
        ...b,
        busy: false
      }));
      C.toast('백업을 읽지 못했어요: ' + e.message);
    }
  };
  const runRestore = async dry => {
    if (!rpin) {
      C.toast('관리자 PIN을 넣어 주세요');
      return;
    }
    setBk(b => ({
      ...b,
      busy: true
    }));
    try {
      const r = await rpcOk('restore_backup', {
        p_pin: rpin,
        p_data: bk.data,
        p_dry: dry
      });
      if (dry) setBk(b => ({
        ...b,
        busy: false,
        added: r.added || {}
      }));else {
        C.toast(`되살렸어요 · ${Object.entries(r.added || {}).map(([t, n]) => `${TABLE_KO[t] || t} ${n}개`).join(', ')}`);
        setBk({});
        setRpin('');
        await C.reload();
        load();
      }
    } catch (e) {
      setBk(b => ({
        ...b,
        busy: false
      }));
      C.toast(e.message);
    }
  };
  const savePin = async () => {
    if (!/^\d{4,8}$/.test(pin2)) {
      C.toast('PIN은 숫자 4~8자리로 정해 주세요');
      return;
    }
    if (await C.write(() => rpcOk('set_admin_pin', {
      p_new: pin2,
      p_old: pinMode === 'change' ? pin : null
    }), pinMode === 'change' ? '관리자 PIN을 바꿨어요' : '관리자 PIN을 정했어요')) {
      setPin('');
      setPin2('');
      setPinMode(null);
      setD(x => ({
        ...x,
        hasPin: true
      }));
    }
  };
  const ms = C.members;
  const vs = D ? D.vs : [];
  const lastOf = id => vs.filter(v => v.member_id === id).sort((a, b) => a.last_at.localeCompare(b.last_at)).pop();
  const [w0] = periodOf('week');
  const week = [...Array(7)].map((_, i) => dayAdd(w0, i));
  const pushOn = new Set(D ? D.ps.map(p => p.member_id) : []);
  const rows = (pts || []).map(r => ({
    ...r,
    m: C.getM(r.member_id)
  })).filter(r => ms.some(m => m.id === r.member_id));
  const top = rows.length ? Math.max(1, rows[0].points) : 1;
  const medal = ['🥇', '🥈', '🥉'];
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    full: true,
    title: "\uD83C\uDFC6 \uAD00\uB9AC\uC790 \xB7 \uAC00\uC871 \uD3EC\uC778\uD2B8"
  }, /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 0
    }
  }, "\uAD00\uB9AC\uC790 \uD3F0\uC5D0\uC11C\uB9CC \uBCF4\uC5EC\uC694.", D && D.first ? ` 방문·조회는 ${fmtDate(D.first, true)}부터 세고 있어요.` : ' 방문·조회는 오늘부터 세기 시작해요.'), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uC624\uB298 \uB204\uAC00 \uB4E4\uC5B4\uC654\uB098"), !D ? /*#__PURE__*/React.createElement("div", {
    className: "row gap small muted"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), "\uBD88\uB7EC\uC624\uB294 \uC911\u2026") : ms.map(m => {
    const l = lastOf(m.id);
    const td = vs.find(v => v.member_id === m.id && v.day === today);
    const gap = l ? dayDiff(l.day, today) : null;
    return /*#__PURE__*/React.createElement("div", {
      className: "adm-r",
      key: m.id
    }, /*#__PURE__*/React.createElement(Avatar, {
      m: m,
      size: 32
    }), /*#__PURE__*/React.createElement("b", {
      className: "grow"
    }, m.name), td ? /*#__PURE__*/React.createElement("span", {
      className: "small muted"
    }, relTime(td.last_at), " \xB7 \uC624\uB298 ", td.opens, "\uBC88") : l ? /*#__PURE__*/React.createElement("span", {
      className: 'small' + (gap >= 3 ? ' warn' : ' muted')
    }, gap === 1 ? '어제' : `${gap}일째 안 들어왔어요`) : /*#__PURE__*/React.createElement("span", {
      className: "small muted"
    }, "\uC544\uC9C1 \uAE30\uB85D \uC5C6\uC5B4\uC694"), (!l || gap >= 3) && m.id !== C.me && /*#__PURE__*/React.createElement("button", {
      className: "btn sm soft",
      onClick: () => {
        onClose();
        C.openLetterCompose({
          to: m.id
        });
      }
    }, "\uD83D\uDC8C"));
  })), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uC774\uBC88 \uC8FC \uCD9C\uC11D\uBD80"), /*#__PURE__*/React.createElement("div", {
    className: "att"
  }, /*#__PURE__*/React.createElement("span", null), week.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: d,
    className: 'h' + (d === today ? ' td' : '')
  }, '월화수목금토일'[i]))), ms.map(m => /*#__PURE__*/React.createElement("div", {
    className: "att",
    key: m.id
  }, /*#__PURE__*/React.createElement("span", {
    className: "nm"
  }, m.name), week.map(d => /*#__PURE__*/React.createElement("i", {
    key: d,
    className: vs.some(v => v.member_id === m.id && v.day === d) ? 'on' : d > today ? 'fu' : ''
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uD3EC\uC778\uD2B8 \uC21C\uC704"), /*#__PURE__*/React.createElement("div", {
    className: "chips",
    style: {
      marginBottom: 8
    }
  }, [['week', '이번 주'], ['month', '이번 달'], ['last', '지난달'], ['year', '올해']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: 'chip' + (per === k ? ' on' : ''),
    onClick: () => pick(k)
  }, l))), /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      marginBottom: 6
    }
  }, (() => {
    const [a, b] = periodOf(per);
    return `${fmtDate(a, true)} ~ ${fmtDate(b, true)}`;
  })()), !pts ? /*#__PURE__*/React.createElement("div", {
    className: "row gap small muted"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), "\uACC4\uC0B0\uD558\uB294 \uC911\u2026") : rows.map((r, i) => /*#__PURE__*/React.createElement("button", {
    className: "rank",
    key: r.member_id,
    onClick: () => setDetail(r)
  }, /*#__PURE__*/React.createElement("span", {
    className: "no"
  }, r.points > 0 && medal[i] ? medal[i] : i + 1), /*#__PURE__*/React.createElement(Avatar, {
    m: r.m,
    size: 28
  }), /*#__PURE__*/React.createElement("span", {
    className: "nm"
  }, r.m.name), /*#__PURE__*/React.createElement("span", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${Math.round(r.points / top * 100)}%`
    }
  })), /*#__PURE__*/React.createElement("b", null, r.points, "\uC810"))), pts && rows.length > 0 && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, "\uC774\uB984\uC744 \uB204\uB974\uBA74 \uC810\uC218\uAC00 \uC5B4\uB5BB\uAC8C \uB098\uC654\uB294\uC9C0 \uBCF4\uC5EC\uC694. \uB9E4\uB2EC 1\uC77C \uC544\uCE68 9\uC2DC\uC5D0 \uC9C0\uB09C\uB2EC 1\uB4F1\uC744 \uC628 \uAC00\uC871\uC5D0\uAC8C \uC54C\uB824\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uC2DD\uAD6C\uBCC4 \uAE30\uB85D ", /*#__PURE__*/React.createElement("span", {
    className: "small muted",
    style: {
      fontWeight: 400
    }
  }, "(", {
    week: '이번 주',
    month: '이번 달',
    last: '지난달',
    year: '올해'
  }[per], ")")), /*#__PURE__*/React.createElement("table", {
    className: "atb"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null), /*#__PURE__*/React.createElement("th", null, "\uBC29\uBB38"), /*#__PURE__*/React.createElement("th", null, "\uC870\uD68C"), /*#__PURE__*/React.createElement("th", null, "\uC0C8 \uAE00"), /*#__PURE__*/React.createElement("th", null, "\uB313\uAE00"), /*#__PURE__*/React.createElement("th", null, "\uB9C8\uC74C"), /*#__PURE__*/React.createElement("th", null, "\uAE30\uB3C4"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.member_id,
    onClick: () => setDetail(r)
  }, /*#__PURE__*/React.createElement("td", null, r.m.name), /*#__PURE__*/React.createElement("td", null, r.visits), /*#__PURE__*/React.createElement("td", null, r.views), /*#__PURE__*/React.createElement("td", null, r.posts + r.daily), /*#__PURE__*/React.createElement("td", null, r.comments), /*#__PURE__*/React.createElement("td", null, r.reacts), /*#__PURE__*/React.createElement("td", null, r.prayers + r.pmarks)))))), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t row",
    style: {
      justifyContent: 'space-between'
    }
  }, "\uC810\uC218 \uADDC\uCE59", !edit && D && D.hasPin && /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => {
      setEdit({
        ...rules
      });
      setPin('');
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "pencil",
    size: 16
  }), "\uBC14\uAFB8\uAE30")), D && !D.hasPin && !pinMode && /*#__PURE__*/React.createElement("div", {
    className: "pinbox"
  }, /*#__PURE__*/React.createElement("b", null, "\uD83D\uDD12 \uBA3C\uC800 \uAD00\uB9AC\uC790 PIN\uC744 \uC815\uD574 \uC8FC\uC138\uC694"), /*#__PURE__*/React.createElement("span", null, "\uC810\uC218 \uADDC\uCE59\uC740 \uC774 PIN\uC744 \uC544\uB294 \uC0AC\uB78C\uB9CC \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694. \uAC00\uC871 \uC554\uD638\uC640 \uB2E4\uB978 \uC22B\uC790\uB85C \uC815\uD574 \uC8FC\uC138\uC694."), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    onClick: () => {
      setPinMode('new');
      setPin('');
      setPin2('');
    }
  }, "PIN \uC815\uD558\uAE30")), pinMode && /*#__PURE__*/React.createElement("div", {
    className: "pinbox"
  }, /*#__PURE__*/React.createElement("b", null, pinMode === 'change' ? '관리자 PIN 바꾸기' : '관리자 PIN 정하기'), pinMode === 'change' && /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uC9C0\uAE08 PIN",
    value: pin,
    onChange: e => setPin(e.target.value.trim())
  }), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uC0C8 PIN (\uC22B\uC790 4~8\uC790\uB9AC)",
    value: pin2,
    onChange: e => setPin2(e.target.value.trim())
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft grow",
    onClick: () => {
      setPinMode(null);
      setPin('');
      setPin2('');
    }
  }, "\uADF8\uB9CC\uB450\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    onClick: savePin
  }, "\uC800\uC7A5"))), POINT_ROWS.map(([k, l,, note]) => /*#__PURE__*/React.createElement("div", {
    className: "rule",
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, l, ruleNote(k, rules, note) && /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, " \xB7 ", ruleNote(k, rules, note))), edit ? /*#__PURE__*/React.createElement("input", {
    className: "input pt",
    type: "number",
    inputMode: "numeric",
    min: "0",
    value: edit[k],
    onChange: e => setEdit(x => ({
      ...x,
      [k]: e.target.value
    }))
  }) : /*#__PURE__*/React.createElement("b", {
    className: "pt"
  }, "+", rules[k]))), edit && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "adm-t",
    style: {
      margin: '14px 0 2px',
      fontSize: '.92rem'
    }
  }, "\uD558\uB8E8\uC5D0 \uC810\uC218\uB85C \uC138\uB294 \uCD5C\uB300 \uAC1C\uC218"), POINT_ROWS.filter(([k]) => POINT_DEF[k + '_cap'] !== undefined).map(([k, l]) => /*#__PURE__*/React.createElement("div", {
    className: "rule",
    key: k + '_cap'
  }, /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, l), /*#__PURE__*/React.createElement("input", {
    className: "input pt",
    type: "number",
    inputMode: "numeric",
    min: "0",
    value: edit[k + '_cap'],
    onChange: e => setEdit(x => ({
      ...x,
      [k + '_cap']: e.target.value
    }))
  }), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "\uAC1C"))), /*#__PURE__*/React.createElement("div", {
    className: "rule"
  }, /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, "\uD83D\uDD12 \uAD00\uB9AC\uC790 PIN"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    style: {
      width: 120
    },
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "PIN",
    value: pin,
    onChange: e => setPin(e.target.value.trim())
  })), /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft grow",
    onClick: () => {
      setEdit(null);
      setPin('');
    }
  }, "\uADF8\uB9CC\uB450\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    onClick: saveRules
  }, "\uC800\uC7A5"))), !edit && !pinMode && D && D.hasPin && /*#__PURE__*/React.createElement("button", {
    className: "more",
    style: {
      marginTop: 8
    },
    onClick: () => {
      setPinMode('change');
      setPin('');
      setPin2('');
    }
  }, "\uAD00\uB9AC\uC790 PIN \uBC14\uAFB8\uAE30"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '8px 2px 0'
    }
  }, "\uD558\uB8E8\uC5D0 \uC815\uD55C \uAC1C\uC218\uBCF4\uB2E4 \uB9CE\uC774 \uC62C\uB824\uB3C4 \uC810\uC218\uB294 \uADF8\uB9CC\uD07C\uB9CC \uC138\uC694. \uC18C\uC2DD\uC744 \uC9C0\uC6B0\uBA74 \uADF8 \uC810\uC218\uB3C4 \uBE60\uC838\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uD3F0 \uC54C\uB9BC"), D && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "adm-r"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pill ok"
  }, "\uCF1C\uC9D0"), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, ms.filter(m => pushOn.has(m.id)).map(m => m.name).join(', ') || '없음')), /*#__PURE__*/React.createElement("div", {
    className: "adm-r"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pill no"
  }, "\uAEBC\uC9D0"), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, ms.filter(m => !pushOn.has(m.id)).map(m => m.name).join(', ') || '없음 · 모두 켜져 있어요')), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '4px 2px 0'
    }
  }, "\uAEBC\uC9C4 \uC2DD\uAD6C\uB294 \uC571\uC744 \uD55C \uBC88 \uC5F4\uACE0 \"\uC54C\uB9BC \uBC1B\uAE30\"\uB97C \uB20C\uB7EC\uC57C \uC18C\uC2DD \uC54C\uB9BC\uC774 \uAC00\uC694."))), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uC2DD\uAD6C PIN"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 6px'
    }
  }, "\uC2DD\uAD6C\uAC00 PIN\uC744 \uC78A\uC5C8\uC73C\uBA74 \uC9C0\uC6CC \uC8FC\uC138\uC694. \uADF8 \uC2DD\uAD6C \uD3F0\uC5D0\uC11C \uC571\uC744 \uC5F4\uBA74 \uC0C8 PIN\uC744 \uC815\uD558\uAC8C \uB3FC\uC694."), D && ms.map(m => /*#__PURE__*/React.createElement("div", {
    className: "adm-r",
    key: m.id
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 28
  }), /*#__PURE__*/React.createElement("b", {
    className: "grow"
  }, m.name), D.pins.includes(m.id) ? /*#__PURE__*/React.createElement("span", {
    className: "pill ok"
  }, "PIN \uC788\uC74C") : /*#__PURE__*/React.createElement("span", {
    className: "pill no"
  }, "\uC544\uC9C1 \uC5C6\uC74C"), D.pins.includes(m.id) && /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setResetFor(m)
  }, "\uC9C0\uC6B0\uAE30"))), resetFor && /*#__PURE__*/React.createElement("div", {
    className: "pinbox"
  }, /*#__PURE__*/React.createElement("b", null, resetFor.name, "\uC758 PIN \uC9C0\uC6B0\uAE30"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uAD00\uB9AC\uC790 PIN",
    value: rpin,
    onChange: e => setRpin(e.target.value.replace(/\D/g, ''))
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft grow",
    onClick: () => {
      setResetFor(null);
      setRpin('');
    }
  }, "\uADF8\uB9CC\uB450\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    onClick: async () => {
      if (await C.write(() => rpcOk('reset_member_pin', {
        p_pin: rpin,
        p_member: resetFor.id
      }), `${resetFor.name}의 PIN을 지웠어요`)) {
        setResetFor(null);
        setRpin('');
        load();
      }
    }
  }, "\uC9C0\uC6B0\uAE30")))), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uBC31\uC5C5\uC5D0\uC11C \uB418\uC0B4\uB9AC\uAE30"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 8px'
    }
  }, "\uB4DC\uB77C\uC774\uBE0C\uC5D0 \uB0A0\uB9C8\uB2E4 \uC313\uC778 \uBC31\uC5C5\uC5D0\uC11C ", /*#__PURE__*/React.createElement("b", null, "\uC9C0\uC6CC\uC9C4 \uAC83\uB9CC"), " \uB2E4\uC2DC \uB123\uC5B4\uC694. \uC9C0\uAE08 \uC788\uB294 \uC18C\uC2DD\uC740 \uADF8\uB300\uB85C\uC608\uC694. \uB418\uC0B4\uB9AC\uB294 \uB3D9\uC548 \uD3F0 \uC54C\uB9BC\uC740 \uAC00\uC9C0 \uC54A\uC544\uC694."), !bk.list && /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    disabled: bk.busy,
    onClick: loadBackups
  }, bk.busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "cloud-download",
    size: 16
  }), "\uBC31\uC5C5 \uBAA9\uB85D \uBCF4\uAE30"), /*#__PURE__*/React.createElement("label", {
    className: "btn sm soft"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "file-up",
    size: 16
  }), "\uD30C\uC77C\uC5D0\uC11C \uACE0\uB974\uAE30", /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: "application/json,.json",
    hidden: true,
    onChange: async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) pickBackup({
        day: f.name,
        text: await f.text()
      });
    }
  }))), bk.list && !bk.data && /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 240,
      overflowY: 'auto'
    }
  }, bk.list.map(x => /*#__PURE__*/React.createElement("button", {
    key: x.id,
    className: "rank",
    onClick: () => pickBackup(x)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "file-json",
    size: 18
  }), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, fmtDate(x.day, true), " \uBC31\uC5C5"), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, Math.max(1, Math.round(x.size / 1024)), "KB"))), !bk.list.length && /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC544\uC9C1 \uBC31\uC5C5\uC774 \uC5C6\uC5B4\uC694.")), bk.data && /*#__PURE__*/React.createElement("div", {
    className: "pinbox"
  }, /*#__PURE__*/React.createElement("b", null, "\uD83D\uDCE6 ", bk.day, " \uBC31\uC5C5"), /*#__PURE__*/React.createElement("span", null, bk.data.saved_at ? `${new Date(bk.data.saved_at).toLocaleString('ko-KR')}에 저장` : ''), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uAD00\uB9AC\uC790 PIN",
    value: rpin,
    onChange: e => setRpin(e.target.value.replace(/\D/g, ''))
  }), bk.added && (Object.keys(bk.added).length ? /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, /*#__PURE__*/React.createElement("b", null, "\uB418\uC0B4\uB9B4 \uAC83:"), " ", Object.entries(bk.added).map(([t, n]) => `${TABLE_KO[t] || t} ${n}개`).join(' · ')) : /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, /*#__PURE__*/React.createElement("b", null, "\uBE60\uC9C4 \uAC8C \uC5C6\uC5B4\uC694."), " \uC774 \uBC31\uC5C5\uC758 \uB0B4\uC6A9\uC774 \uC9C0\uAE08 \uBAA8\uB450 \uC788\uC5B4\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft grow",
    onClick: () => {
      setBk({});
      setRpin('');
    }
  }, "\uADF8\uB9CC\uB450\uAE30"), !bk.added ? /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    disabled: bk.busy,
    onClick: () => runRestore(true)
  }, bk.busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : '무엇이 돌아오는지 보기') : Object.keys(bk.added).length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    disabled: bk.busy,
    onClick: () => runRestore(false)
  }, bk.busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : '되살리기')))), /*#__PURE__*/React.createElement("div", {
    className: "adm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "adm-t"
  }, "\uCD5C\uADFC \uC18C\uC2DD \xB7 \uBCF8 \uC0AC\uB78C"), D && recent.map(x => {
    const saw = D.ws.filter(w => w.item_id === x.id).map(w => w.member_id);
    const not = ms.filter(m => m.id !== x.author && !saw.includes(m.id));
    return /*#__PURE__*/React.createElement("div", {
      className: "seen",
      key: x.id
    }, /*#__PURE__*/React.createElement("div", {
      className: "row gap"
    }, /*#__PURE__*/React.createElement(Avatar, {
      m: C.getM(x.author),
      size: 24
    }), /*#__PURE__*/React.createElement("b", {
      className: "grow ell"
    }, C.getM(x.author).name, " \xB7 ", x.text), /*#__PURE__*/React.createElement("span", {
      className: "small muted"
    }, saw.length, "\uBA85 \uBD04")), /*#__PURE__*/React.createElement("div", {
      className: "small",
      style: {
        paddingLeft: 32
      }
    }, saw.length > 0 && /*#__PURE__*/React.createElement("span", null, "\uD83D\uDC40 ", saw.map(id => C.getM(id).name).join(', ')), not.length > 0 && /*#__PURE__*/React.createElement("span", {
      className: "muted"
    }, saw.length ? ' · ' : '', "\uC544\uC9C1: ", not.map(m => m.name).join(', '))));
  })), /*#__PURE__*/React.createElement(Sheet, {
    open: !!detail,
    onClose: () => setDetail(null),
    title: detail ? `${detail.m.name} · 점수 자세히` : ''
  }, detail && /*#__PURE__*/React.createElement(React.Fragment, null, POINT_ROWS.map(([k, l, f]) => /*#__PURE__*/React.createElement("div", {
    className: "rule",
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }, l), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, detail[f], "\uBC88 \xD7 ", rules[k]), /*#__PURE__*/React.createElement("b", {
    className: "pt"
  }, detail[f] * rules[k], "\uC810"))), /*#__PURE__*/React.createElement("div", {
    className: "rule",
    style: {
      borderTop: '2px solid #222'
    }
  }, /*#__PURE__*/React.createElement("b", {
    className: "grow"
  }, "\uD569\uACC4"), /*#__PURE__*/React.createElement("b", {
    className: "pt",
    style: {
      fontSize: '1.2rem'
    }
  }, detail.points, "\uC810")), /*#__PURE__*/React.createElement("p", {
    className: "small muted"
  }, "\uC571\uC740 ", detail.opens, "\uBC88 \uC5F4\uC5C8\uC5B4\uC694 (\uC810\uC218\uB294 \uD558\uB8E8 1\uBC88\uB9CC). \uD69F\uC218\uB294 \uD558\uB8E8 \uCD5C\uB300 \uAC1C\uC218\uAE4C\uC9C0\uB9CC \uC13C \uC22B\uC790\uC608\uC694."))));
}

/* ═══════════ 내 프로필 (+ 우리 식구) ═══════════ */
function MeTab() {
  const C = useC();
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "h1"
  }, "\uB0B4 \uD504\uB85C\uD544"), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, C.isAdmin && /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: C.openAdmin,
    "aria-label": "\uAD00\uB9AC\uC790 \xB7 \uAC00\uC871 \uD3EC\uC778\uD2B8"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trophy",
    size: 23
  })), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: () => C.openMemberEdit(C.getM(C.me)),
    "aria-label": "\uD504\uB85C\uD544 \uACE0\uCE58\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "pencil",
    size: 22
  })), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: C.openSettings,
    "aria-label": "\uC124\uC815"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "settings"
  })))), C.isAdmin && /*#__PURE__*/React.createElement("button", {
    className: "banner adm-go",
    onClick: C.openAdmin
  }, /*#__PURE__*/React.createElement("span", {
    className: "bic"
  }, "\uD83C\uDFC6"), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("b", null, "\uAD00\uB9AC\uC790 \xB7 \uAC00\uC871 \uD3EC\uC778\uD2B8"), /*#__PURE__*/React.createElement("span", null, "\uC21C\uC704 \xB7 \uBC29\uBB38 \xB7 \uC870\uD68C \xB7 \uC54C\uB9BC \uC0C1\uD0DC \uBCF4\uAE30")), /*#__PURE__*/React.createElement(LIcon, {
    name: "chevron-right"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sheetcard",
    style: {
      paddingTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-t",
    style: {
      paddingTop: 8
    }
  }, "\uC6B0\uB9AC \uC2DD\uAD6C ", /*#__PURE__*/React.createElement("span", {
    className: "small muted",
    style: {
      fontWeight: 400
    }
  }, "\uB204\uB974\uBA74 \uADF8 \uC0AC\uB78C\uC758 \uC0AC\uC9C4\xB7\uC5F0\uD45C\xB7\uBAA9\uC18C\uB9AC")), /*#__PURE__*/React.createElement("div", {
    className: "famrow"
  }, C.members.filter(m => m.id !== C.me).map(m => {
    const bd = C.bdayDays(m.id);
    return /*#__PURE__*/React.createElement("button", {
      key: m.id,
      className: "fm",
      onClick: () => C.openProfile(m.id)
    }, /*#__PURE__*/React.createElement(Avatar, {
      m: m,
      size: 60,
      ring: C.storyRing(m.id) || 'plain'
    }), /*#__PURE__*/React.createElement("b", null, m.name), /*#__PURE__*/React.createElement("span", null, bd !== null && bd <= 30 ? `🎂 ${ddayText(bd)}` : m.role || ' '));
  }), /*#__PURE__*/React.createElement("button", {
    className: "fm",
    onClick: () => C.openMemberEdit({})
  }, /*#__PURE__*/React.createElement("span", {
    className: "fm-add"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "user-plus",
    size: 26
  })), /*#__PURE__*/React.createElement("b", null, "\uC2DD\uAD6C \uB354\uD558\uAE30"), /*#__PURE__*/React.createElement("span", null, " ")))), /*#__PURE__*/React.createElement("div", {
    className: "sheetcard",
    style: {
      paddingBottom: 6
    }
  }, /*#__PURE__*/React.createElement(ProfileBody, {
    mid: C.me
  })));
}

/* ═══════════ 해시태그 모아 보기 ═══════════ */
function TagPage({
  tag,
  onClose
}) {
  const C = useC();
  const list = tag ? C.posts.filter(p => p.kind !== 'daily' && !isLocked(p) && tagsOf(p.content).includes(tag)) : [];
  return /*#__PURE__*/React.createElement(Page, {
    open: !!tag,
    onClose: onClose,
    title: tag || ''
  }, /*#__PURE__*/React.createElement("p", {
    className: "small muted pad",
    style: {
      margin: '4px 0 10px'
    }
  }, tag, " \uC18C\uC2DD ", list.length, "\uAC1C"), /*#__PURE__*/React.createElement("div", {
    className: "tagfeed"
  }, list.map(p => /*#__PURE__*/React.createElement(PostCard, {
    key: p.id,
    p: p
  }))));
}

/* 편지함은 맨 위 종이비행기로 여는 창 */
function LettersPage({
  open,
  onClose
}) {
  useLayer(open, onClose);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "page"
  }, /*#__PURE__*/React.createElement(LettersTab, {
    onBack: onClose
  }));
}
function ProfilePage({
  mid,
  onClose
}) {
  const C = useC();
  const m = mid ? C.getM(mid) : null;
  return /*#__PURE__*/React.createElement(Page, {
    open: !!m,
    onClose: onClose,
    title: m ? m.name : '',
    right: m && /*#__PURE__*/React.createElement("button", {
      className: "iconbtn",
      onClick: () => C.openMemberEdit(m),
      "aria-label": "\uD504\uB85C\uD544 \uACE0\uCE58\uAE30"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "pencil",
      size: 20
    }))
  }, m && /*#__PURE__*/React.createElement(ProfileBody, {
    mid: mid
  }));
}
function ProfileBody({
  mid,
  top = 56
}) {
  const C = useC();
  const [tab, setTab] = useState('ph');
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    setTab('ph');
  }, [mid]);
  const m = mid ? C.getM(mid) : null;
  const today = ymd();
  const posts = m ? C.posts.filter(p => (p.author_id === m.id || (p.tagged || []).includes(m.id)) && !isLocked(p)) : [];
  const photoPosts = posts.filter(p => photosOf(p).length || p.kind === 'post');
  const byYear = {};
  photoPosts.forEach(p => (byYear[p.happened_on.slice(0, 4)] = byYear[p.happened_on.slice(0, 4)] || []).push(p));
  const years = Object.keys(byYear).sort().reverse();
  const bd = m ? C.bdayDays(m.id) : null;
  const tl = useMemo(() => {
    if (!m) return [];
    const out = [];
    C.posts.forEach(p => {
      if (p.author_id === m.id) out.push({
        d: p.happened_on,
        t: p.created_at,
        ic: p.kind === 'daily' ? 'camera' : photosOf(p).length ? 'image' : 'pencil',
        bg: '#FFF1E8',
        c: '#D0603A',
        title: isLocked(p) ? '🔒 타임캡슐 소식을 남김' : p.kind === 'daily' ? '오늘의 한 장' : (p.content || '사진 소식').slice(0, 40),
        sub: isLocked(p) ? `${fmtDate(p.open_on, true)}에 열려요` : `소식 · 사진 ${photosOf(p).length}장`,
        p: isLocked(p) ? null : p
      });else if ((p.tagged || []).includes(m.id) && !isLocked(p)) out.push({
        d: p.happened_on,
        t: p.created_at,
        ic: 'users',
        bg: '#EAF3FF',
        c: '#2d5c9e',
        title: `${C.getM(p.author_id).name}의 사진에 함께`,
        sub: (p.content || '').slice(0, 40),
        p
      });
    });
    C.letters.forEach(l => {
      const lock = isLocked(l);
      const d = ymd(new Date(l.created_at));
      if (l.sender_id === m.id) out.push({
        d,
        t: l.created_at,
        ic: lock ? 'lock' : 'send',
        bg: '#F3EEFF',
        c: '#6a3fc8',
        title: `${C.getM(l.receiver_id).name}에게 편지`,
        sub: lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.title || l.content).slice(0, 40),
        l
      });else if (l.receiver_id === m.id) out.push({
        d,
        t: l.created_at,
        ic: lock ? 'lock' : 'mail',
        bg: '#F3EEFF',
        c: '#6a3fc8',
        title: `${C.getM(l.sender_id).name}에게 편지 받음`,
        sub: lock ? `🔒 ${fmtDate(l.open_on, true)}에 열려요` : (l.title || l.content).slice(0, 40),
        l
      });
    });
    C.answers.filter(a => a.member_id === m.id).forEach(a => {
      const q = C.questions.find(x => x.id === a.question_id);
      out.push({
        d: ymd(new Date(a.created_at)),
        t: a.created_at,
        ic: 'circle-help',
        bg: '#FFF5E2',
        c: '#B5861C',
        title: `질문에 답: ${q ? q.text : ''}`.slice(0, 44),
        sub: a.audio_url ? '🎙 목소리 답' : a.content.slice(0, 40),
        q
      });
    });
    if (m.birth_date) out.push({
      d: m.birth_date,
      t: '',
      ic: 'cake',
      bg: '#FDEBE3',
      c: '#D0603A',
      title: `${m.name} 태어난 날`,
      sub: m.bday_lunar && lunarOf(parseYmd(m.birth_date)) ? `음력 ${lunarOf(parseYmd(m.birth_date)).m}월 ${lunarOf(parseYmd(m.birth_date)).d}일` : ''
    });
    return out.sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t));
  }, [m, C.posts, C.letters, C.answers]);
  const voices = m ? [...C.comments.filter(c => c.author_id === m.id && c.audio_url).map(c => {
    const p = C.posts.find(x => x.id === c.post_id);
    return {
      id: c.id,
      src: c.audio_url,
      t: c.created_at,
      text: c.content,
      ctx: p ? `${C.getM(p.author_id).name}의 소식에 남긴 목소리` : '목소리 댓글'
    };
  }), ...C.answers.filter(a => a.member_id === m.id && a.audio_url).map(a => {
    const q = C.questions.find(x => x.id === a.question_id);
    return {
      id: a.id,
      src: a.audio_url,
      t: a.created_at,
      text: a.content,
      ctx: q ? `질문 “${q.text}”에 답` : '질문에 답'
    };
  }), ...C.prayers.filter(p => p.author_id === m.id && p.audio_url).map(p => ({
    id: p.id,
    src: p.audio_url,
    t: p.created_at,
    text: p.content,
    ctx: p.kind === 'prayer' ? '목소리 기도' : '기도 제목'
  })), ...C.letters.filter(l => l.sender_id === m.id && l.audio_url && !isLocked(l)).map(l => ({
    id: l.id,
    src: l.audio_url,
    t: l.created_at,
    text: l.content,
    ctx: `${C.getM(l.receiver_id).name}에게 보낸 목소리 편지`
  }))].sort((a, b) => b.t.localeCompare(a.t)) : [];
  const mine = m && m.id === C.me;
  const age = m && m.birth_date ? ageOn(m.birth_date, today) : null;
  const saved = mine ? C.posts.filter(p => C.isSaved(p.id) && !isLocked(p)) : [];
  return /*#__PURE__*/React.createElement(React.Fragment, null, m && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "prof"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 86,
    ring: C.storyRing(m.id) || 'plain',
    onClick: C.dailyToday(m.id).length ? () => C.openStory(C.dailyToday(m.id)) : undefined
  }), /*#__PURE__*/React.createElement("div", {
    className: "cnts"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", null, "\uC18C\uC2DD"), /*#__PURE__*/React.createElement("b", null, C.posts.filter(p => p.author_id === m.id && p.kind !== 'daily').length)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", null, "\uBC1B\uC740 \uD3B8\uC9C0"), /*#__PURE__*/React.createElement("b", null, C.letters.filter(l => l.receiver_id === m.id).length)), age !== null ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", null, "\uB098\uC774"), /*#__PURE__*/React.createElement("b", null, age)) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", null, "\uC0AC\uC9C4"), /*#__PURE__*/React.createElement("b", null, posts.reduce((n, p) => n + photosOf(p).length, 0))))), /*#__PURE__*/React.createElement("h3", null, m.name, m.role ? ` · ${m.role}` : ''), /*#__PURE__*/React.createElement("p", null, m.birth_date ? /*#__PURE__*/React.createElement(React.Fragment, null, fmtDate(m.birth_date, true), "\uC0DD", m.bday_lunar ? ' (생일은 음력)' : '', bd !== null && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 \uD83C\uDF82 \uC0DD\uC77C\uAE4C\uC9C0 ", bd === 0 ? '오늘!' : `${bd}일`), /*#__PURE__*/React.createElement("br", null)) : /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "\uC0DD\uC77C\uC744 \uB123\uC73C\uBA74 \uB098\uC774\uC640 \uC0DD\uC77C \uC54C\uB9BC\uC774 \uBCF4\uC5EC\uC694", /*#__PURE__*/React.createElement("br", null)), m.likes && /*#__PURE__*/React.createElement(React.Fragment, null, "\uC88B\uC544\uD558\uB294 \uAC83: ", m.likes)), /*#__PURE__*/React.createElement("div", {
    className: "pbtns"
  }, mine ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    onClick: () => C.openMemberEdit(m)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "pencil",
    size: 18
  }), "\uD504\uB85C\uD544 \uACE0\uCE58\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    onClick: () => C.openComposer({
      mode: 'daily'
    })
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "camera",
    size: 18
  }), "\uC624\uB298\uC758 \uD55C \uC7A5")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    onClick: () => C.openLetterCompose({
      to: m.id
    })
  }, "\uD83D\uDC8C \uD3B8\uC9C0 \uC4F0\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    onClick: () => C.openLetterCompose({
      to: m.id
    })
  }, "\uD83C\uDFA4 \uB9D0 \uB0A8\uAE30\uAE30")))), /*#__PURE__*/React.createElement("div", {
    className: "ptabs",
    style: {
      top
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === 'ph' ? 'on' : '',
    onClick: () => setTab('ph')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "grid-3x3",
    size: 18
  }), "\uC0AC\uC9C4"), /*#__PURE__*/React.createElement("button", {
    className: tab === 'tl' ? 'on' : '',
    onClick: () => setTab('tl')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "git-commit-vertical",
    size: 18
  }), "\uC5F0\uD45C"), /*#__PURE__*/React.createElement("button", {
    className: tab === 'vo' ? 'on' : '',
    onClick: () => setTab('vo')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "audio-lines",
    size: 18
  }), "\uBAA9\uC18C\uB9AC"), mine && /*#__PURE__*/React.createElement("button", {
    className: tab === 'sv' ? 'on' : '',
    onClick: () => setTab('sv')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "bookmark",
    size: 18
  }), "\uBCF4\uAD00")), tab === 'sv' && /*#__PURE__*/React.createElement(React.Fragment, null, !saved.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uBCF4\uAD00\uD55C \uC18C\uC2DD\uC774 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uC18C\uC2DD \uC624\uB978\uCABD \uC544\uB798 ", /*#__PURE__*/React.createElement("b", null, "\uCC45\uAC08\uD53C"), "\uB97C \uB204\uB974\uBA74 \uC5EC\uAE30 \uBAA8\uC5EC\uC694.")), /*#__PURE__*/React.createElement("div", {
    className: "grid"
  }, saved.map(p => {
    const ph = photosOf(p)[0];
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => setDetail(p),
      "aria-label": "\uC18C\uC2DD \uBCF4\uAE30"
    }, ph ? /*#__PURE__*/React.createElement("img", {
      src: ph.thumb || ph.url,
      alt: "",
      loading: "lazy"
    }) : /*#__PURE__*/React.createElement("div", {
      className: "txt"
    }, (p.content || '').slice(0, 40)), photosOf(p).length > 1 && /*#__PURE__*/React.createElement("span", {
      className: "multi"
    }, /*#__PURE__*/React.createElement(LIcon, {
      name: "copy",
      size: 18,
      stroke: "#fff"
    })));
  }))), tab === 'ph' && /*#__PURE__*/React.createElement(React.Fragment, null, !years.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 ", m.name, "\uC758 \uC0AC\uC9C4\uC774 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uC18C\uC2DD\uC744 \uC62C\uB9B4 \uB54C \"\uC0AC\uC9C4\uC5D0 \uB204\uAC00 \uB098\uC654\uB098\uC694?\"\uC5D0\uC11C ", josa(m.name, '을', '를'), " \uACE0\uB974\uBA74 \uC5EC\uAE30 \uBAA8\uC5EC\uC694.")), years.map(y => {
    const ps = byYear[y];
    const last = ps.map(p => p.happened_on).sort().pop();
    const cnt = ps.reduce((n, p) => n + photosOf(p).length, 0);
    return /*#__PURE__*/React.createElement("div", {
      key: y
    }, /*#__PURE__*/React.createElement("div", {
      className: "yr"
    }, y, "\uB144", m.birth_date && last >= m.birth_date ? ` · ${ageOn(m.birth_date, last)}살` : '', " ", /*#__PURE__*/React.createElement("span", null, "\uC0AC\uC9C4 ", cnt, "\uC7A5")), /*#__PURE__*/React.createElement("div", {
      className: "grid"
    }, ps.map(p => {
      const ph = photosOf(p)[0];
      return /*#__PURE__*/React.createElement("button", {
        key: p.id,
        onClick: () => setDetail(p),
        "aria-label": "\uC18C\uC2DD \uBCF4\uAE30"
      }, ph ? /*#__PURE__*/React.createElement("img", {
        src: ph.thumb || ph.url,
        alt: "",
        loading: "lazy"
      }) : /*#__PURE__*/React.createElement("div", {
        className: "txt"
      }, (p.content || '').slice(0, 40)), photosOf(p).length > 1 && /*#__PURE__*/React.createElement("span", {
        className: "multi"
      }, /*#__PURE__*/React.createElement(LIcon, {
        name: "copy",
        size: 18,
        stroke: "#fff"
      })));
    })));
  })), tab === 'tl' && /*#__PURE__*/React.createElement("div", {
    className: "tl"
  }, !tl.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 \uAE30\uB85D\uC774 \uC5C6\uC5B4\uC694."), tl.map((x, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "tl-item",
    style: {
      width: '100%',
      textAlign: 'left'
    },
    onClick: () => {
      if (x.p) setDetail(x.p);else if (x.l) C.openLetter(x.l);else if (x.q) C.openQuestion(x.q);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-ic",
    style: {
      background: x.bg,
      color: x.c
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: x.ic,
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("span", null, fmtDate(x.d, true)), /*#__PURE__*/React.createElement("b", null, x.title), /*#__PURE__*/React.createElement("span", null, x.sub))))), tab === 'vo' && /*#__PURE__*/React.createElement("div", {
    className: "tl"
  }, !voices.length && /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "\uC544\uC9C1 ", m.name, "\uC758 \uBAA9\uC18C\uB9AC\uAC00 \uC5C6\uC5B4\uC694.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small"
  }, "\uB313\uAE00\xB7\uC9C8\uBB38 \uB2F5\xB7\uD3B8\uC9C0\uB97C \uBAA9\uC18C\uB9AC\uB85C \uB0A8\uAE30\uBA74 \uC5EC\uAE30 \uBAA8\uC5EC\uC11C \uC624\uB798 \uB0A8\uC544\uC694.")), voices.map(v => /*#__PURE__*/React.createElement("div", {
    key: v.id,
    className: "tl-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-ic",
    style: {
      background: '#F4F1FF',
      color: '#7b4bd1'
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "audio-lines",
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("span", null, fmtDate(ymd(new Date(v.t)), true), " \xB7 ", v.ctx), /*#__PURE__*/React.createElement(VoicePlayer, {
    src: v.src
  }), v.text && /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#5b4a86'
    }
  }, "\u201C", v.text, "\u201D")))))), /*#__PURE__*/React.createElement(Page, {
    open: !!detail,
    onClose: () => setDetail(null),
    title: "\uC18C\uC2DD"
  }, detail && (C.posts.find(x => x.id === detail.id) ? /*#__PURE__*/React.createElement(PostCard, {
    p: C.posts.find(x => x.id === detail.id)
  }) : /*#__PURE__*/React.createElement("p", {
    className: "empty"
  }, "\uC9C0\uC6CC\uC9C4 \uC18C\uC2DD\uC774\uC5D0\uC694."))));
}
function MemberEdit({
  m,
  onClose
}) {
  const C = useC();
  const open = !!m;
  const isNew = m && !m.id;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const pick = useRef(null);
  useEffect(() => {
    if (m) setF({
      name: m.name || '',
      emoji: m.emoji || '🙂',
      role: m.role || '',
      birth_date: m.birth_date || '',
      bday_lunar: !!m.bday_lunar,
      likes: m.likes || '',
      color: m.color || '#F0603A',
      avatar: m.avatar || ''
    });
  }, [m]);
  const set = (k, v) => setF(x => ({
    ...x,
    [k]: v
  }));
  const emojis = ['👵', '👴', '👩', '👨', '🧒', '👧', '👦', '👶', '🧑', '👱‍♀️', '🐶', '🐱'];
  const colors = ['#F0603A', '#D9407A', '#6a3fc8', '#2F7BF6', '#2E7D5B', '#B5861C', '#555555'];
  const save = async () => {
    if (!f.name.trim()) {
      C.toast('이름을 적어 주세요');
      return;
    }
    const row = {
      name: f.name.trim(),
      emoji: f.emoji || '🙂',
      role: f.role.trim(),
      birth_date: f.birth_date || null,
      bday_lunar: !!f.bday_lunar,
      likes: f.likes.trim(),
      color: f.color,
      avatar: f.avatar || ''
    };
    const ok = await C.write(() => isNew ? db.add('members', {
      ...row,
      sort: Math.max(0, ...C.members.map(x => x.sort || 0)) + 1
    }) : db.patch('members', m.id, row), isNew ? '식구를 더했어요' : '프로필을 고쳤어요');
    if (ok) onClose();
  };
  const l = f.birth_date ? lunarOf(parseYmd(f.birth_date)) : null;
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    full: true,
    title: isNew ? '식구 더하기' : '프로필 고치기',
    right: /*#__PURE__*/React.createElement("button", {
      className: "hdbtn",
      disabled: busy,
      onClick: save
    }, "\uC800\uC7A5")
  }, open && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: {
      ...f
    },
    size: 96
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      justifyContent: 'center',
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    disabled: busy,
    onClick: () => pick.current.click()
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "camera",
    size: 18
  }), "\uC0AC\uC9C4\uC73C\uB85C"), f.avatar && /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => set('avatar', '')
  }, "\uC0AC\uC9C4 \uBE7C\uAE30")), /*#__PURE__*/React.createElement("input", {
    ref: pick,
    type: "file",
    accept: "image/*",
    hidden: true,
    onChange: async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      setBusy(true);
      try {
        const r = await uploadPhoto(file, 480);
        set('avatar', r.thumb);
      } catch (err) {
        C.toast('사진을 올리지 못했어요: ' + err.message);
      }
      setBusy(false);
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC774\uB984\xB7\uD638\uCE6D"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: f.name,
    onChange: e => set('name', e.target.value),
    placeholder: "\uC608: \uD560\uBA38\uB2C8, \uC9C0\uC6B0"
  })), !f.avatar && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC5BC\uAD74 \uADF8\uB9BC"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, emojis.map(x => /*#__PURE__*/React.createElement("button", {
    key: x,
    type: "button",
    className: 'chip' + (f.emoji === x ? ' on' : ''),
    style: {
      fontSize: '1.3rem'
    },
    onClick: () => set('emoji', x)
  }, x)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uD55C \uC904 \uC18C\uAC1C"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: f.role,
    onChange: e => set('role', e.target.value),
    placeholder: "\uC608: \uB9C9\uB0B4 \uC190\uC8FC, \uD143\uBC2D \uB300\uC7A5"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC0DD\uB144\uC6D4\uC77C (\uC591\uB825)"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input",
    max: ymd(),
    value: f.birth_date,
    onChange: e => set('birth_date', e.target.value)
  }), l && /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '6px 2px 0'
    }
  }, "\uC74C\uB825\uC73C\uB85C\uB294 ", l.leap ? '윤' : '', l.m, "\uC6D4 ", l.d, "\uC77C\uC774\uC5D0\uC694.")), f.birth_date && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement(Toggle, {
    on: f.bday_lunar,
    onChange: v => set('bday_lunar', v),
    label: "\uC0DD\uC77C\uC744 \uC74C\uB825\uC73C\uB85C \uC1E0\uC694",
    sub: l ? `켜면 매년 음력 ${l.m}월 ${l.d}일에 맞춰 달력에 들어가요` : ''
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC88B\uC544\uD558\uB294 \uAC83"), /*#__PURE__*/React.createElement("input", {
    className: "input",
    value: f.likes,
    onChange: e => set('likes', e.target.value),
    placeholder: "\uC608: \uAE40\uBC25, \uACF5\uB8E1, \uD560\uBA38\uB2C8 \uD143\uBC2D"
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uB0B4 \uC0C9\uAE54 (\uB2EC\uB825 \uD45C\uC2DC)"), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, colors.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    type: "button",
    "aria-label": c,
    onClick: () => set('color', c),
    style: {
      width: 40,
      height: 40,
      borderRadius: '50%',
      background: c,
      border: f.color === c ? '3px solid #1a1a1a' : '3px solid #fff',
      boxShadow: '0 0 0 1px #ddd'
    }
  })))), !isNew && /*#__PURE__*/React.createElement("button", {
    className: "btn soft block danger",
    style: {
      marginTop: 10
    },
    onClick: () => C.deleteMember(m)
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "trash-2",
    size: 18
  }), "\uBA85\uB2E8\uC5D0\uC11C \uBE7C\uAE30")));
}
function SettingsSheet({
  open,
  onClose
}) {
  const C = useC();
  const [pinCh, setPinCh] = useState(null);
  const [ko, setKo] = useState('');
  const [kn, setKn] = useState('');
  const [bk, setBk] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBk(null);
    gwVersion().then(v => {
      if (v >= 2) gw('bkinfo').then(setBk).catch(() => setBk({
        err: true
      }));else setBk({
        old: true,
        v
      });
    });
  }, [open]);
  const fs = C.fontSize;
  return /*#__PURE__*/React.createElement(Sheet, {
    open: open,
    onClose: onClose,
    full: true,
    title: "\uC124\uC815"
  }, !isStandalone() && /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uD83D\uDCF2 \uC571\uC73C\uB85C \uC124\uCE58"), /*#__PURE__*/React.createElement(InstallCard, {
    inSettings: true
  })), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uD83D\uDD14 \uC0C8 \uC18C\uC2DD \uC54C\uB9BC"), /*#__PURE__*/React.createElement(PushSettings, null)), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uAE00\uC528 \uD06C\uAE30"), /*#__PURE__*/React.createElement("div", {
    className: "seg seg3"
  }, [['m', '보통'], ['l', '크게'], ['xl', '아주 크게']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: fs === k ? 'on' : '',
    onClick: () => C.setFontSize(k)
  }, l)))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\uC774 \uD3F0\uC740"), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: C.getM(C.me),
    size: 40
  }), /*#__PURE__*/React.createElement("b", {
    className: "grow"
  }, C.getM(C.me).name), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => setPinCh(x => x ? null : {
      a: '',
      b: ''
    })
  }, "\uB0B4 PIN \uBC14\uAFB8\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn sm soft",
    onClick: () => {
      onClose();
      C.changeMe();
    }
  }, "\uB098 \uBC14\uAFB8\uAE30")), pinCh && /*#__PURE__*/React.createElement("div", {
    className: "pinbox",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uC9C0\uAE08 PIN",
    value: pinCh.a,
    onChange: e => setPinCh(x => ({
      ...x,
      a: e.target.value.replace(/\D/g, '')
    }))
  }), /*#__PURE__*/React.createElement("input", {
    className: "input",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\uC0C8 PIN (\uC22B\uC790 4~8\uC790\uB9AC)",
    value: pinCh.b,
    onChange: e => setPinCh(x => ({
      ...x,
      b: e.target.value.replace(/\D/g, '')
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn soft grow",
    onClick: () => setPinCh(null)
  }, "\uADF8\uB9CC\uB450\uAE30"), /*#__PURE__*/React.createElement("button", {
    className: "btn primary grow",
    onClick: async () => {
      if (await C.write(() => rpcOk('change_my_pin', {
        p_old: pinCh.a,
        p_new: pinCh.b
      }), '내 PIN을 바꿨어요')) setPinCh(null);
    }
  }, "\uC800\uC7A5")))), /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("label", null, "\u2601\uFE0F \uC790\uB3D9 \uBC31\uC5C5 (\uB0B4 \uAD6C\uAE00 \uB4DC\uB77C\uC774\uBE0C)"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: '#f6f6f6',
      borderRadius: 14,
      padding: 12,
      fontSize: '.95rem'
    }
  }, !bk && /*#__PURE__*/React.createElement("div", {
    className: "row gap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), "\uD655\uC778\uD558\uB294 \uC911\u2026"), bk && bk.old && /*#__PURE__*/React.createElement("div", null, "\uC0AC\uC9C4 \uCC3D\uAD6C \uC2A4\uD06C\uB9BD\uD2B8\uB97C ", /*#__PURE__*/React.createElement("b", null, "\uC0C8 \uBC84\uC804\uC73C\uB85C \uD55C \uBC88 \uBC30\uD3EC"), "\uD574\uC57C \uBC31\uC5C5\uC774 \uC2DC\uC791\uB3FC\uC694. (\uC9C0\uAE08 \uBC84\uC804 ", bk.v || '연결 안 됨', ")"), bk && bk.err && /*#__PURE__*/React.createElement("div", null, "\uBC31\uC5C5 \uC0C1\uD0DC\uB97C \uC77D\uC9C0 \uBABB\uD588\uC5B4\uC694."), bk && bk.count !== undefined && /*#__PURE__*/React.createElement("div", null, "\uB9C8\uC9C0\uB9C9 \uBC31\uC5C5: ", /*#__PURE__*/React.createElement("b", null, bk.last ? fmtDate(bk.last, true) : '아직 없음'), " \xB7 \uC313\uC778 \uBC31\uC5C5 ", bk.count, "\uAC1C", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "\uB9E4\uC77C \uCC98\uC74C \uC5F4 \uB54C \uC800\uC808\uB85C \uC800\uC7A5\uB3FC\uC694. \uC9C0\uB09C \uB0A0 \uBC31\uC5C5\uC740 \uC9C0\uC6B0\uC9C0 \uC54A\uACE0 \uC313\uC544 \uB46C\uC694.")), bk && bk.count !== undefined && /*#__PURE__*/React.createElement("div", {
    className: "row gap",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    disabled: busy,
    onClick: async () => {
      setBusy(true);
      const ok = await C.runBackup(true);
      if (ok) setBk(await gw('bkinfo'));
      setBusy(false);
    }
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : /*#__PURE__*/React.createElement(LIcon, {
    name: "cloud-upload",
    size: 18
  }), "\uC9C0\uAE08 \uBC31\uC5C5"), bk.folder && /*#__PURE__*/React.createElement("a", {
    className: "btn sm soft",
    href: bk.folder,
    target: "_blank",
    rel: "noopener",
    style: {
      textDecoration: 'none',
      color: 'inherit'
    }
  }, "\uB4DC\uB77C\uC774\uBE0C \uD3F4\uB354 \uC5F4\uAE30")))), /*#__PURE__*/React.createElement("form", {
    className: "field",
    onSubmit: async e => {
      e.preventDefault();
      if (await C.changeKey(ko, kn)) {
        setKo('');
        setKn('');
      }
    }
  }, /*#__PURE__*/React.createElement("label", null, "\uD83D\uDD12 \uAC00\uC871 \uC554\uD638 \uBC14\uAFB8\uAE30"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "password",
    className: "input",
    autoComplete: "current-password",
    placeholder: "\uC9C0\uAE08 \uC554\uD638",
    value: ko,
    onChange: e => setKo(e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    className: "input",
    autoComplete: "new-password",
    placeholder: "\uC0C8 \uC554\uD638 (6\uC790 \uC774\uC0C1)",
    value: kn,
    onChange: e => setKn(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn soft",
    type: "submit"
  }, "\uC554\uD638 \uBC14\uAFB8\uAE30"), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "\uBC14\uAFB8\uBA74 \uB2E4\uB978 \uC2DD\uAD6C \uD3F0\uC740 \uC0C8 \uC554\uD638\uB97C \uB2E4\uC2DC \uB123\uC5B4\uC57C \uD574\uC694."))), /*#__PURE__*/React.createElement("button", {
    className: "btn soft block danger",
    onClick: () => {
      if (window.confirm('이 폰에서 나갈까요? 다시 들어오려면 가족 암호가 필요해요.')) {
        onClose();
        C.leave();
      }
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "log-out",
    size: 18
  }), "\uC774 \uD3F0\uC5D0\uC11C \uB098\uAC00\uAE30"));
}

/* 지난번 이후 새 소식 */
/* ═══════════ 연말 가족 책 ═══════════ */
function BookView({
  year,
  onClose
}) {
  const C = useC();
  const [y, setY] = useState(year);
  const [withLetters, setWithLetters] = useState(false);
  const [withTalk, setWithTalk] = useState(true);
  useLayer(!!year, onClose);
  useEffect(() => {
    if (year) setY(year);
  }, [year]);
  if (!year) return null;
  const years = [...new Set([new Date().getFullYear(), ...C.posts.map(p => +p.happened_on.slice(0, 4))])].sort((a, b) => b - a);
  const posts = C.posts.filter(p => p.happened_on.startsWith(y + '') && !isLocked(p)).sort((a, b) => a.happened_on.localeCompare(b.happened_on) || a.created_at.localeCompare(b.created_at));
  const months = {};
  posts.forEach(p => (months[+p.happened_on.slice(5, 7)] = months[+p.happened_on.slice(5, 7)] || []).push(p));
  const qs = C.questions.filter(q => q.week_start.startsWith(y + '')).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const letters = C.letters.filter(l => !isLocked(l) && (l.open_on || ymd(new Date(l.created_at))).startsWith(y + ''));
  const nPhotos = posts.reduce((n, p) => n + photosOf(p).length, 0);
  return /*#__PURE__*/React.createElement("div", {
    className: "bookpage"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bookbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    onClick: onClose,
    "aria-label": "\uB2EB\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "x"
  })), /*#__PURE__*/React.createElement("select", {
    className: "input",
    style: {
      width: 'auto',
      minHeight: 40
    },
    value: y,
    onChange: e => setY(+e.target.value)
  }, years.map(x => /*#__PURE__*/React.createElement("option", {
    key: x,
    value: x
  }, x, "\uB144"))), /*#__PURE__*/React.createElement("label", {
    className: "row gap small",
    style: {
      minHeight: 40
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: withLetters,
    onChange: e => setWithLetters(e.target.checked),
    style: {
      width: 20,
      height: 20
    }
  }), "\uD3B8\uC9C0\uB3C4 \uB123\uAE30"), /*#__PURE__*/React.createElement("label", {
    className: "row gap small",
    style: {
      minHeight: 40
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: withTalk,
    onChange: e => setWithTalk(e.target.checked),
    style: {
      width: 20,
      height: 20
    }
  }), "\uB313\uAE00\xB7\uB9C8\uC74C \uB123\uAE30"), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn sm primary",
    onClick: () => window.print()
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "printer",
    size: 18
  }), "PDF\uB85C \uC800\uC7A5 \xB7 \uC778\uC1C4")), /*#__PURE__*/React.createElement("div", {
    className: "bk"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bk-cover"
  }, /*#__PURE__*/React.createElement("div", {
    className: "y"
  }, y), /*#__PURE__*/React.createElement("h1", null, "\uC6B0\uB9AC \uAC00\uC871 \uC774\uC57C\uAE30"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      margin: '14px 0'
    }
  }, C.members.map(m => m.emoji).join(' ')), /*#__PURE__*/React.createElement("div", null, C.members.map(m => m.name).join(' · ')), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#888',
      marginTop: 10,
      fontSize: 14
    }
  }, "\uC18C\uC2DD ", posts.length, "\uAC1C \xB7 \uC0AC\uC9C4 ", nPhotos, "\uC7A5 \xB7 \uC9C8\uBB38 ", qs.length, "\uAC1C")), !posts.length && /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      color: '#888'
    }
  }, y, "\uB144\uC5D0\uB294 \uC544\uC9C1 \uC18C\uC2DD\uC774 \uC5C6\uC5B4\uC694."), Object.keys(months).sort((a, b) => a - b).map(mo => /*#__PURE__*/React.createElement("div", {
    key: mo
  }, /*#__PURE__*/React.createElement("h2", null, mo, "\uC6D4"), months[mo].map(p => {
    const ph = photosOf(p).slice(0, 4);
    const ans = C.commentsOf(p.id).filter(c => c.is_answer);
    return /*#__PURE__*/React.createElement("div", {
      key: p.id,
      className: "bk-post"
    }, /*#__PURE__*/React.createElement("div", {
      className: "m"
    }, fmtDate(p.happened_on, true), " \xB7 ", C.getM(p.author_id).name, p.kind === 'daily' ? ' · 오늘의 한 장' : '', (p.tagged || []).length ? ` · 함께: ${(p.tagged || []).map(id => C.getM(id).name).join(', ')}` : ''), ph.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: 'bk-ph' + (ph.length === 1 ? ' one' : '')
    }, ph.map((x, i) => /*#__PURE__*/React.createElement("img", {
      key: i,
      src: x.url,
      alt: ""
    }))), p.content && /*#__PURE__*/React.createElement("div", {
      style: {
        whiteSpace: 'pre-wrap'
      }
    }, p.content), withTalk && (() => {
      /* 가족이 남긴 마음(이모지)과 댓글도 책에 */
      const rs = C.reactsOf(p.id);
      const cm = C.commentsOf(p.id).filter(c => !c.is_answer);
      return /*#__PURE__*/React.createElement(React.Fragment, null, rs.length > 0 && /*#__PURE__*/React.createElement("div", {
        className: "bk-re"
      }, [...new Set(rs.map(r => r.emoji))].join(''), " ", rs.length, " \xB7 ", rs.map(r => C.getM(r.member_id).name + r.emoji).join(', ')), cm.length > 0 && /*#__PURE__*/React.createElement("div", {
        className: "bk-cm"
      }, cm.map(c => /*#__PURE__*/React.createElement("div", {
        key: c.id
      }, /*#__PURE__*/React.createElement("b", null, C.getM(c.author_id).name), " ", c.content || '(목소리 댓글)', c.audio_url && c.content ? ' 🎙' : ''))));
    })(), p.ask_to && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6,
        color: '#8a4a2a'
      }
    }, "Q. ", C.getM(p.ask_to).name, "\uAED8 \u2014 ", p.ask_text, ans.map(a => /*#__PURE__*/React.createElement("div", {
      key: a.id,
      style: {
        color: '#333'
      }
    }, "A. ", C.getM(a.author_id).name, ": ", a.content || '(목소리 답)'))));
  }))), qs.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h2", null, "\uC774\uBC88 \uC8FC\uC758 \uC9C8\uBB38"), qs.filter(q => q.text).map(q => /*#__PURE__*/React.createElement("div", {
    key: q.id,
    className: "bk-post"
  }, /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, fmtDate(q.week_start, true), " \uC8FC \xB7 \uC9C8\uBB38\uC790 ", C.getM(q.asker_id).name, q.audio_url ? ' 🎙' : ''), /*#__PURE__*/React.createElement("b", null, "Q. ", q.text), q.note && /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, "\uD83D\uDCAC ", q.note), C.answers.filter(a => a.question_id === q.id).map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id
  }, "A. ", C.getM(a.member_id).name, ": ", a.content || '(목소리로 답함)', a.audio_url && a.content ? ' 🎙' : ''))))), C.prayers.some(p => p.answered_at && p.answered_at.startsWith(y + '')) && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h2", null, "\u2728 \uC751\uB2F5 \uB178\uD2B8"), C.prayers.filter(p => p.answered_at && p.answered_at.startsWith(y + '')).map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "bk-post"
  }, /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, fmtDate(ymd(new Date(p.created_at)), true), " \xB7 ", C.getM(p.author_id).name, "\uC758 \uAE30\uB3C4 \uC81C\uBAA9", prayFor(C, p) ? ` · ${prayFor(C, p)}을(를) 위해` : ''), /*#__PURE__*/React.createElement("b", null, "\uD83D\uDE4F ", p.content || '목소리 기도'), /*#__PURE__*/React.createElement("div", null, "\u2728 ", fmtDate(ymd(new Date(p.answered_at)), true), " \uC751\uB2F5", p.answer_note ? ` — ${p.answer_note}` : '')))), withLetters && letters.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h2", null, "\uD3B8\uC9C0"), letters.map(l => /*#__PURE__*/React.createElement("div", {
    key: l.id,
    className: "bk-post"
  }, /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, fmtDate(ymd(new Date(l.created_at)), true), " \xB7 ", C.getM(l.sender_id).name, " \u2192 ", C.getM(l.receiver_id).name), l.title && /*#__PURE__*/React.createElement("b", null, l.title), /*#__PURE__*/React.createElement("div", {
    style: {
      whiteSpace: 'pre-wrap'
    }
  }, l.content))))));
}
function AgoPage({
  items,
  onClose
}) {
  const today = ymd();
  return /*#__PURE__*/React.createElement(Page, {
    open: !!items,
    onClose: onClose,
    title: "N\uB144 \uC804 \uC624\uB298"
  }, items && items.sort((a, b) => b.happened_on.localeCompare(a.happened_on)).map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id
  }, /*#__PURE__*/React.createElement("div", {
    className: "sec-t",
    style: {
      color: '#8a6d2a'
    }
  }, +today.slice(0, 4) - +p.happened_on.slice(0, 4), "\uB144 \uC804 \xB7 ", fmtDate(p.happened_on, true)), /*#__PURE__*/React.createElement(PostCard, {
    p: p
  }))));
}

/* ═══════════ 첫 화면들 ═══════════ */
function Gate({
  onEnter
}) {
  const [mode, setMode] = useState('checking');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    familyKey = '';
    db.rpc('family_ready').then(r => setMode(r ? 'enter' : 'setup')).catch(() => {
      setErr('가족 공간에 연결하지 못했어요. 인터넷을 확인하고 다시 열어 주세요.');
      setMode('error');
    });
  }, []);
  const submit = async e => {
    e.preventDefault();
    setErr('');
    const k = pw.trim();
    if (k.length < 6) {
      setErr('가족 암호는 6자 이상이에요.');
      return;
    }
    if (mode === 'setup' && k !== pw2.trim()) {
      setErr('두 번 적은 암호가 서로 달라요.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'setup') await db.rpc('set_family_key', {
        new_key: k
      });
      familyKey = k;
      if (!(await db.rpc('is_family'))) {
        familyKey = '';
        throw new Error('암호가 맞지 않아요. 다시 확인해 주세요.');
      }
      store.set('fz_key', k);
      onEnter();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 26,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      margin: '6px 0 26px'
    }
  }, "\uC6B0\uB9AC \uC2DD\uAD6C\uB07C\uB9AC\uB9CC \uBCF4\uB294 \uACF5\uAC04"), mode === 'checking' && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\uAC00\uC871 \uACF5\uAC04\uC744 \uCC3E\uB294 \uC911\u2026"), mode === 'error' && /*#__PURE__*/React.createElement("p", {
    style: {
      color: '#c33'
    }
  }, err), (mode === 'setup' || mode === 'enter') && /*#__PURE__*/React.createElement("form", {
    onSubmit: submit,
    style: {
      width: '100%',
      display: 'grid',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      margin: '0 0 6px'
    }
  }, mode === 'setup' ? /*#__PURE__*/React.createElement(React.Fragment, null, "\uCC98\uC74C \uC624\uC168\uB124\uC694. \uC6B0\uB9AC \uAC00\uC871\uB9CC \uB4E4\uC5B4\uC62C \uC218 \uC788\uAC8C", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("b", null, "\uAC00\uC871 \uC554\uD638"), "\uB97C \uC815\uD574 \uC8FC\uC138\uC694.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", null, "\uAC00\uC871 \uC554\uD638"), "\uB97C \uB123\uC5B4 \uC8FC\uC138\uC694.")), /*#__PURE__*/React.createElement("input", {
    type: "password",
    className: "input",
    autoComplete: mode === 'setup' ? 'new-password' : 'current-password',
    placeholder: "\uAC00\uC871 \uC554\uD638 (6\uC790 \uC774\uC0C1)",
    value: pw,
    onChange: e => setPw(e.target.value)
  }), mode === 'setup' && /*#__PURE__*/React.createElement("input", {
    type: "password",
    className: "input",
    autoComplete: "new-password",
    placeholder: "\uD55C \uBC88 \uB354",
    value: pw2,
    onChange: e => setPw2(e.target.value)
  }), err && /*#__PURE__*/React.createElement("p", {
    style: {
      color: '#c33',
      textAlign: 'center',
      margin: 0
    }
  }, err), /*#__PURE__*/React.createElement("button", {
    className: "btn primary block",
    disabled: busy
  }, busy ? '확인하는 중…' : mode === 'setup' ? '가족 암호 정하기' : '들어가기')));
}
function PickMe({
  members,
  onPick,
  onLeave
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 26,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '18px 0 4px',
      fontSize: '1.3rem'
    }
  }, "\uC774 \uD3F0\uC740 \uB204\uAD6C\uC758 \uAC83\uC778\uAC00\uC694?"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 0
    }
  }, "\uACE0\uB978 \uC774\uB984\uC73C\uB85C \uC18C\uC2DD\uACFC \uD3B8\uC9C0\uAC00 \uC62C\uB77C\uAC00\uC694. \uB098\uC911\uC5D0 \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694."), /*#__PURE__*/React.createElement("div", {
    className: "famgrid",
    style: {
      width: '100%',
      padding: 0
    }
  }, members.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    className: "famcard",
    onClick: () => onPick(m.id)
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: m,
    size: 68
  }), /*#__PURE__*/React.createElement("b", null, m.name), /*#__PURE__*/React.createElement("span", null, m.role)))), /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    style: {
      marginTop: 18
    },
    onClick: onLeave
  }, "\uC774 \uD3F0\uC5D0\uC11C \uB098\uAC00\uAE30"));
}

/* 이 폰이 누구인지 서버에 증명: 식구마다 개인 PIN → 폰 열쇠. 열쇠가 있어야 그 이름으로 글을 쓸 수 있다 */
function PinGate({
  member,
  onDone,
  onOther
}) {
  const [state, setState] = useState(null); // 'new' 처음 정하기 · 'enter' 넣기
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    db.rpc('pins_state').then(ids => setState((ids || []).includes(member.id) ? 'enter' : 'new')).catch(() => setState('enter'));
  }, [member.id]);
  const go = async () => {
    setErr('');
    if (!/^\d{4,8}$/.test(a)) {
      setErr('숫자 4~8자리로 넣어 주세요');
      return;
    }
    if (state === 'new' && a !== b) {
      setErr('두 번 넣은 숫자가 달라요');
      return;
    }
    setBusy(true);
    try {
      const r = await rpcOk('claim_member', {
        p_member: member.id,
        p_pin: a
      });
      onDone(r.token);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  const pinInput = (v, set, ph) => /*#__PURE__*/React.createElement("input", {
    className: "input pin",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    maxLength: 8,
    placeholder: ph,
    value: v,
    onChange: e => set(e.target.value.replace(/\D/g, '')),
    onKeyDown: e => {
      if (e.key === 'Enter') go();
    }
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 26,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), /*#__PURE__*/React.createElement(Avatar, {
    m: member,
    size: 84
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '12px 0 4px',
      fontSize: '1.3rem'
    }
  }, member.name, state === 'new' ? ' · 나만의 PIN 정하기' : ' · PIN 넣기'), !state ? /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 14px',
      textAlign: 'center',
      lineHeight: 1.6
    }
  }, state === 'new' ? /*#__PURE__*/React.createElement(React.Fragment, null, member.name, "\uB9CC \uC544\uB294 \uC22B\uC790 4\uC790\uB9AC\uB97C \uC815\uD574 \uC8FC\uC138\uC694.", /*#__PURE__*/React.createElement("br", null), "\uB2E4\uB978 \uC2DD\uAD6C\uAC00 ", member.name, " \uC774\uB984\uC73C\uB85C \uAE00\uC744 \uC4F8 \uC218 \uC5C6\uAC8C \uC9C0\uCF1C \uC918\uC694.", /*#__PURE__*/React.createElement("br", null), "\uC774 \uD3F0\uC5D0\uC11C\uB294 \uD55C \uBC88\uB9CC \uB123\uC73C\uBA74 \uB3FC\uC694.") : /*#__PURE__*/React.createElement(React.Fragment, null, member.name, "\uC758 PIN\uC744 \uB123\uC5B4 \uC8FC\uC138\uC694.", /*#__PURE__*/React.createElement("br", null), "\uC774 \uD3F0\uC5D0\uC11C\uB294 \uD55C \uBC88\uB9CC \uB123\uC73C\uBA74 \uB3FC\uC694.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10,
      width: '100%',
      maxWidth: 260
    }
  }, pinInput(a, setA, state === 'new' ? '숫자 4자리' : 'PIN'), state === 'new' && pinInput(b, setB, '한 번 더'), err && /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      color: '#d0402a',
      textAlign: 'center'
    }
  }, err), /*#__PURE__*/React.createElement("button", {
    className: "btn primary block",
    disabled: busy,
    onClick: go
  }, busy ? /*#__PURE__*/React.createElement("span", {
    className: "spin"
  }) : state === 'new' ? 'PIN 정하고 들어가기' : '들어가기')), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      marginTop: 16,
      textAlign: 'center'
    }
  }, "PIN\uC744 \uC78A\uC5C8\uC73C\uBA74 \uAD00\uB9AC\uC790(\uC544\uBE60)\uC5D0\uAC8C \uC9C0\uC6CC \uB2EC\uB77C\uACE0 \uD558\uC138\uC694.")), /*#__PURE__*/React.createElement("button", {
    className: "linkbtn",
    style: {
      marginTop: 10
    },
    onClick: onOther
  }, josa(member.name, '이', '가'), " \uC544\uB2C8\uC5D0\uC694"));
}

/* ═══════════ 앱 ═══════════ */
function App() {
  const [hasKey, setHasKey] = useState(!!familyKey);
  const [me, setMeState] = useState(store.get('fz_me') || '');
  const [auth, setAuth] = useState(''); // '' 확인 중 · 'need' PIN 필요 · 'ok'
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState('home');
  const [toastMsg, setToastMsg] = useState('');
  const [D, setD] = useState({
    members: [],
    posts: [],
    reactions: [],
    comments: [],
    notes: [],
    events: [],
    letters: [],
    questions: [],
    answers: [],
    bank: [],
    prayers: [],
    pmarks: [],
    nreacts: [],
    nreplies: []
  });
  const [noteView, setNoteView] = useState(null);
  /* 알림 지우기: 이 폰에서만 숨긴다 (지운 알림 열쇠들 + "이때까지 모두 지움") */
  const [notiHide, setNotiHide] = useState(() => {
    try {
      const j = JSON.parse(store.get('fz_noti_hide') || '{}');
      return {
        keys: j.keys || [],
        before: j.before || ''
      };
    } catch (e) {
      return {
        keys: [],
        before: ''
      };
    }
  });
  const saveHide = h => {
    setNotiHide(h);
    store.set('fz_noti_hide', JSON.stringify({
      keys: h.keys.slice(-600),
      before: h.before
    }));
  };
  const [speaking, setSpeaking] = useState(null);
  const [fontSize, setFontSizeState] = useState(store.get('fz_fs') || 'm');
  const [seen, setSeen] = useState(() => {
    try {
      return JSON.parse(store.get('fz_story') || '[]');
    } catch (e) {
      return [];
    }
  });
  const [prevSeen, setPrevSeen] = useState(() => store.get('fz_seen') || new Date(Date.now() - 3 * 864e5).toISOString());
  /* 창들 */
  const [composer, setComposer] = useState(null);
  const [cmtPost, setCmtPost] = useState(null);
  const [cmtMode, setCmtMode] = useState('');
  const [profile, setProfile] = useState(null);
  const [story, setStory] = useState(null);
  const [letterCfg, setLetterCfg] = useState(null);
  const [letterView, setLetterView] = useState(null);
  const [question, setQuestion] = useState(null);
  const [book, setBook] = useState(null);
  const [postView, setPostView] = useState(null);
  const [notiOpen, setNotiOpen] = useState(false);
  const [prayFocus, setPrayFocus] = useState(null);
  /* 알림을 누르고 들어온 주소(?post=… 등): 자료가 다 오면 그 소식을 연다 */
  const [linkReq, setLinkReq] = useState(() => /[?&](post|letter|q|story|pray)=/.test(location.search) ? location.search : '');
  const [settings, setSettings] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [lettersOpen, setLettersOpen] = useState(false);
  const [tagView, setTagView] = useState(null);
  const [memberEdit, setMemberEdit] = useState(null);
  const [ago, setAgo] = useState(null);
  const toastTimer = useRef(null);
  const toast = msg => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3200);
  };
  useEffect(() => {
    document.documentElement.style.fontSize = {
      m: '16px',
      l: '18px',
      xl: '20px'
    }[fontSize] || '16px';
  }, [fontSize]);
  const loadAll = async () => {
    try {
      const [ms, ps, rs, cs, ns, es, ls, qs, as, bk, pr, pk, nr, ny] = await Promise.all([db.list('members', 'select=*&order=sort,created_at,id'), db.list('posts', 'select=*&order=happened_on.desc,created_at.desc,id'), db.list('reactions', 'select=post_id,member_id,emoji,created_at&order=created_at,post_id,member_id,emoji'), db.list('comments', 'select=*&order=created_at,id'), db.list('notes', 'select=*&order=created_at,id'), db.list('events', 'select=*&order=event_date,id'), db.list('letters', 'select=*&order=created_at.desc,id'), db.list('questions', 'select=*&order=week_start.desc,id'), db.list('answers', 'select=*&order=created_at,id'), db.list('question_bank', 'select=*&order=created_at,id').catch(() => []), db.list('prayers', 'select=*&order=created_at.desc,id').catch(() => []), db.list('prayer_marks', 'select=*&order=created_at,prayer_id,member_id,day').catch(() => []), db.list('note_reacts', 'select=*&order=created_at,note_id,member_id').catch(() => []), db.list('note_replies', 'select=*&order=created_at,id').catch(() => [])]);
      if (!ms.length && !(await db.rpc('is_family'))) {
        leave('가족 암호가 바뀌었어요. 새 암호를 넣어 주세요.');
        return;
      }
      setD({
        members: ms,
        posts: ps.map(p => ({
          ...p,
          tagged: p.tagged || [],
          photos: photosOf(p)
        })),
        reactions: rs,
        comments: cs,
        notes: ns,
        events: es,
        letters: ls,
        questions: qs,
        answers: as,
        bank: bk,
        prayers: pr,
        pmarks: pk,
        nreacts: nr,
        nreplies: ny
      });
      setLoaded(true);
      setLoadErr('');
      return {
        ms,
        qs
      };
    } catch (e) {
      setLoadErr(navigator.onLine === false ? '인터넷이 끊겨 있어요' : e.message);
      toast(navigator.onLine === false ? '인터넷 연결을 확인해 주세요' : '가족 공간을 읽지 못했어요: ' + e.message);
    }
  };
  const write = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      await loadAll();
      return true;
    } catch (e) {
      toast('저장하지 못했어요: ' + e.message);
      return false;
    }
  };

  /* 이번 주 질문이 없으면 만든다 (식구가 돌아가며 받는다) */
  /* 이번 주 질문 줄이 없으면 서버 함수가 만든다 (지난 질문자의 다음 식구가 질문자) */
  const ensureWeekly = async (ms, qs) => {
    if (!ms || !ms.length || qs.some(q => q.week_start === weekStart())) return;
    try {
      await db.rpc('ensure_week_q');
      await loadAll();
    } catch (e) {}
  };
  /* 매일 한 번 드라이브로 백업 (창구 v2 이상일 때만) */
  const runBackup = async manual => {
    try {
      if ((await gwVersion()) < 2) {
        if (manual) toast('사진 창구 스크립트를 새 버전으로 배포해야 해요');
        return false;
      }
      const tables = ['members', 'posts', 'reactions', 'comments', 'notes', 'events', 'letters', 'questions', 'answers', 'question_bank', 'prayers', 'prayer_marks', 'memories', 'wishes', 'event_tasks', 'visits', 'views', 'app_settings', 'note_reacts', 'note_replies'];
      const all = await Promise.all(tables.map(t => db.list(t, t === 'reactions' ? 'select=*&order=post_id,member_id,emoji' : t === 'prayer_marks' ? 'select=*&order=prayer_id,member_id,day' : t === 'visits' ? 'select=*&order=member_id,day' : t === 'views' ? 'select=*&order=item_id,member_id' : t === 'app_settings' ? 'select=*&order=k' : t === 'note_reacts' ? 'select=*&order=note_id,member_id' : undefined).catch(() => [])));
      const data = {
        app: 'THE FAMILY ZONE',
        saved_at: new Date().toISOString(),
        by: me
      };
      tables.forEach((t, i) => data[t] = all[i]);
      await gw('backup', {
        day: ymd(),
        data: JSON.stringify(data)
      });
      store.set('fz_bk', ymd());
      if (manual) toast('드라이브에 백업했어요');
      return true;
    } catch (e) {
      if (manual) toast('백업하지 못했어요: ' + e.message);
      return false;
    }
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
      if (document.visibilityState === 'visible' && familyKey) {
        clearBadge();
        ensurePush(store.get('fz_me'));
        logVisit(store.get('fz_me'));
      }
      if (document.visibilityState === 'hidden') {
        store.set('fz_seen', new Date().toISOString());
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
      if (document.visibilityState === 'visible' && familyKey) {
        setPrevSeen(store.get('fz_seen') || prevSeen);
        loadAll();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const onOnline = () => {
      if (familyKey) loadAll();
    }; // 인터넷이 다시 연결되면 새로 불러오기
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', () => store.set('fz_seen', new Date().toISOString()));
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
  }, []);
  const setMe = id => {
    if (id !== store.get('fz_me')) {
      store.del('fz_tok');
      memberTok = '';
    }
    store.set('fz_me', id);
    setMeState(id);
    setAuth('');
  };
  /* 이 폰의 열쇠가 고른 식구와 맞는지 서버에 묻는다 (안 맞거나 없으면 PIN 화면) */
  useEffect(() => {
    if (!loaded || !me || auth) return;
    if (!memberTok) {
      setAuth('need');
      return;
    }
    db.rpc('whoami').then(w => {
      if (w === me) setAuth('ok');else {
        store.del('fz_tok');
        memberTok = '';
        setAuth('need');
      }
    }).catch(() => setAuth('ok'));
  }, [loaded, me, auth]);
  const leave = msg => {
    store.del('fz_key');
    store.del('fz_me');
    store.del('fz_tok');
    memberTok = '';
    familyKey = '';
    setMeState('');
    setLoaded(false);
    setHasKey(false);
    if (msg) toast(msg);
  };

  /* ── 계산해 두는 것들 ── */
  const today = ymd();
  const memberMap = useMemo(() => {
    const m = {};
    D.members.forEach(x => m[x.id] = x);
    return m;
  }, [D.members]);
  const getM = id => memberMap[id] || {
    id,
    name: '(떠난 식구)',
    emoji: '👤',
    color: '#999'
  };
  /* 반응 표 하나에 좋아요와 보관(🔖)을 함께 적는다 */
  const likesMap = useMemo(() => {
    const m = {};
    D.reactions.filter(r => r.emoji !== SAVE).forEach(r => (m[r.post_id] = m[r.post_id] || []).includes(r.member_id) || m[r.post_id].push(r.member_id));
    return m;
  }, [D.reactions]);
  const reactMap = useMemo(() => {
    const m = {};
    D.reactions.filter(r => r.emoji !== SAVE).forEach(r => {
      const a = m[r.post_id] = m[r.post_id] || [];
      const i = a.findIndex(x => x.member_id === r.member_id);
      if (i < 0) a.push(r);else if ((r.created_at || '') >= (a[i].created_at || '')) a[i] = r;
    });
    return m;
  }, [D.reactions]);
  const savedSet = useMemo(() => new Set(D.reactions.filter(r => r.emoji === SAVE && r.member_id === me).map(r => r.post_id)), [D.reactions, me]);
  const cmtMap = useMemo(() => {
    const m = {};
    D.comments.forEach(c => (m[c.post_id] = m[c.post_id] || []).push(c));
    return m;
  }, [D.comments]);
  const posts = useMemo(() => D.posts.map(p => ({
    ...p,
    isNew: p.author_id !== me && p.created_at > prevSeen
  })), [D.posts, me, prevSeen]);
  const allEvents = useMemo(() => [...D.events, ...D.members.map(birthdayEvent).filter(Boolean)], [D.events, D.members]);
  const dailyToday = id => posts.filter(p => p.kind === 'daily' && p.author_id === id && p.happened_on === today).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const bdayDays = id => {
    const m = memberMap[id];
    const ev = m && birthdayEvent(m);
    const n = ev && nextOccur(ev, today);
    return n ? dayDiff(today, n) : null;
  };
  const storyRing = id => {
    const bd = bdayDays(id);
    if (bd !== null && bd <= 7) return 'bday';
    const ds = dailyToday(id);
    if (!ds.length) return null;
    return ds.every(p => seen.includes(p.id)) ? 'seen' : 'new';
  };
  const unread = D.letters.filter(l => l.receiver_id === me && !l.read_at && !isLocked(l)).length;
  const weekQ = D.questions.find(q => q.week_start === weekStart()) || null;
  const activity = useMemo(() => {
    const out = [];
    const two = new Date(Date.now() - 14 * 864e5).toISOString();
    const since = prevSeen < two ? prevSeen : two;
    posts.filter(p => p.author_id !== me && p.created_at > since && !isLocked(p)).forEach(p => out.push({
      key: 'p' + p.id,
      who: p.author_id,
      t: p.created_at,
      text: `${josa(getM(p.author_id).name, '이', '가')} ${p.kind === 'daily' ? '오늘의 한 장을' : '새 소식을'} 올렸어요`,
      thumb: photosOf(p)[0] && photosOf(p)[0].thumb,
      go: () => p.kind === 'daily' ? setStory(dailyToday(p.author_id)) : setCmtPost(p)
    }));
    D.comments.filter(c => c.author_id !== me && c.created_at > since).forEach(c => {
      const p = posts.find(x => x.id === c.post_id);
      if (p && (p.author_id === me || (cmtMap[p.id] || []).some(x => x.author_id === me))) out.push({
        key: 'c' + c.id,
        who: c.author_id,
        t: c.created_at,
        text: `${josa(getM(c.author_id).name, '이', '가')} ${c.audio_url ? '목소리 댓글' : '댓글'}을 남겼어요${c.content ? `: ${c.content.slice(0, 30)}` : ''}`,
        go: () => setCmtPost(p)
      });
    });
    D.reactions.filter(r => r.emoji !== SAVE && r.member_id !== me && r.created_at > since).forEach(r => {
      const p = posts.find(x => x.id === r.post_id);
      if (p && p.author_id === me) out.push({
        key: 'r' + r.post_id + r.member_id,
        who: r.member_id,
        t: r.created_at,
        text: `${josa(getM(r.member_id).name, '이', '가')} 내 소식에 ${r.emoji} ${reactWord(r.emoji)}`,
        thumb: photosOf(p)[0] && photosOf(p)[0].thumb,
        go: () => setCmtPost(p)
      });
    });
    D.letters.filter(l => l.receiver_id === me && !l.read_at && !isLocked(l)).forEach(l => out.push({
      key: 'l' + l.id,
      who: l.sender_id,
      t: l.created_at,
      unread: true,
      text: `${josa(getM(l.sender_id).name, '이', '가')} 편지를 보냈어요 💌`,
      go: () => setLetterView(l)
    }));
    D.prayers.filter(p => p.author_id !== me && p.created_at > since).forEach(p => out.push({
      key: 'pr' + p.id,
      who: p.author_id,
      t: p.created_at,
      text: `${josa(getM(p.author_id).name, '이', '가')} ${p.kind === 'prayer' ? '목소리 기도를 남겼어요 🎙' : '기도 제목을 나눴어요 🙏'}${p.content ? ` “${p.content.slice(0, 30)}”` : ''}`,
      go: () => {
        setNotiOpen(false);
        setTab('pray');
        setPrayFocus(p.id);
      }
    }));
    D.prayers.filter(p => p.answered_at && p.author_id !== me && p.answered_at > since).forEach(p => out.push({
      key: 'pa' + p.id,
      who: p.author_id,
      t: p.answered_at,
      text: `✨ ${getM(p.author_id).name}의 기도가 응답됐어요${p.answer_note ? ` “${p.answer_note.slice(0, 30)}”` : ''}`,
      go: () => {
        setNotiOpen(false);
        setTab('pray');
        setPrayFocus(p.id);
      }
    }));
    D.pmarks.filter(k => k.member_id !== me && k.created_at > since).forEach(k => {
      const p = D.prayers.find(x => x.id === k.prayer_id);
      if (p && p.author_id === me) out.push({
        key: 'pk' + k.prayer_id + k.member_id + k.day,
        who: k.member_id,
        t: k.created_at,
        text: `${josa(getM(k.member_id).name, '이', '가')} 내 기도 제목으로 함께 기도했어요 🙏`,
        go: () => {
          setNotiOpen(false);
          setTab('pray');
          setPrayFocus(p.id);
        }
      });
    });
    D.questions.filter(q => q.text && q.asker_id && q.asker_id !== me && q.picked_at && q.picked_at > since).forEach(q => out.push({
      key: 'q' + q.id,
      who: q.asker_id,
      t: q.picked_at,
      text: `${josa(getM(q.asker_id).name, '이', '가')} 이번 주 질문을 냈어요 ❓ “${q.text.slice(0, 30)}”`,
      go: () => setQuestion(q)
    }));
    D.answers.filter(a => a.member_id !== me && a.created_at > since).forEach(a => out.push({
      key: 'a' + a.id,
      who: a.member_id,
      t: a.created_at,
      text: `${josa(getM(a.member_id).name, '이', '가')} 이번 주 질문에 답했어요`,
      go: () => setQuestion(D.questions.find(q => q.id === a.question_id) || weekQ)
    }));
    D.nreplies.filter(y => y.author_id !== me && y.created_at > since).forEach(y => {
      const n = D.notes.find(x => x.id === y.note_id);
      if (n && (n.author_id === me || D.nreplies.some(z => z.note_id === n.id && z.author_id === me))) out.push({
        key: 'ny' + y.id,
        who: y.author_id,
        t: y.created_at,
        text: `${josa(getM(y.author_id).name, '이', '가')} 냉장고 메모에 답했어요 📌 “${y.content.slice(0, 30)}”`,
        go: () => {
          setNotiOpen(false);
          setNoteView(n);
        }
      });
    });
    D.nreacts.filter(r => r.member_id !== me && r.created_at > since).forEach(r => {
      const n = D.notes.find(x => x.id === r.note_id);
      if (n && n.author_id === me) out.push({
        key: 'nr' + r.note_id + r.member_id,
        who: r.member_id,
        t: r.created_at,
        text: `${josa(getM(r.member_id).name, '이', '가')} 내 메모에 ${r.emoji} ${reactWord(r.emoji)}`,
        go: () => {
          setNotiOpen(false);
          setNoteView(n);
        }
      });
    });
    const hid = new Set(notiHide.keys);
    return out.filter(x => !hid.has(x.key) && !(notiHide.before && x.t <= notiHide.before)).map(x => ({
      ...x,
      isNew: x.unread || x.t > prevSeen
    })).sort((a, b) => b.t.localeCompare(a.t));
  }, [posts, D, me, prevSeen, notiHide]);
  const newCount = activity.filter(x => x.isNew).length;
  const C = {
    me,
    members: D.members,
    posts,
    comments: D.comments,
    notes: D.notes,
    letters: D.letters,
    questions: D.questions,
    answers: D.answers,
    allEvents,
    getM,
    unread,
    weekQ,
    activity,
    speaking,
    fontSize,
    bank: D.bank,
    likesOf: id => likesMap[id] || [],
    reactsOf: id => reactMap[id] || [],
    myReact: id => ((reactMap[id] || []).find(r => r.member_id === me) || {}).emoji || null,
    commentsOf: id => cmtMap[id] || [],
    dailyToday,
    bdayDays,
    storyRing,
    toast,
    write,
    setTab: t => goTab(t),
    runBackup,
    newCount,
    markSeen: id => setSeen(s => {
      if (s.includes(id)) return s;
      const n = [...s, id].slice(-300);
      store.set('fz_story', JSON.stringify(n));
      return n;
    }),
    setFontSize: k => {
      store.set('fz_fs', k);
      setFontSizeState(k);
    },
    toggleSpeak: (key, text) => {
      if (speaking === key) {
        window.speechSynthesis && window.speechSynthesis.cancel();
        setSpeaking(null);
        return;
      }
      if (speak(text, () => setSpeaking(s => s === key ? null : s))) setSpeaking(key);
    },
    react: async (p, emoji) => {
      // 같은 걸 다시 고르면 지우고, 다른 걸 고르면 바꾼다
      const cur = ((reactMap[p.id] || []).find(r => r.member_id === me) || {}).emoji;
      const off = cur === emoji;
      setD(d => ({
        ...d,
        reactions: [...d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me && r.emoji !== SAVE)), ...(off ? [] : [{
          post_id: p.id,
          member_id: me,
          emoji,
          created_at: new Date().toISOString()
        }])]
      }));
      try {
        if (cur) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=neq.${encodeURIComponent(SAVE)}`);
        if (!off) await db.add('reactions', {
          post_id: p.id,
          member_id: me,
          emoji
        });
      } catch (e) {
        toast('마음을 저장하지 못했어요');
        loadAll();
      }
    },
    toggleLike: async p => {
      const had = (likesMap[p.id] || []).includes(me);
      setD(d => ({
        ...d,
        reactions: had ? d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me)) : [...d.reactions, {
          post_id: p.id,
          member_id: me,
          emoji: '❤️',
          created_at: new Date().toISOString()
        }]
      }));
      try {
        if (had) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=neq.${encodeURIComponent(SAVE)}`);else await db.add('reactions', {
          post_id: p.id,
          member_id: me,
          emoji: '❤️'
        });
      } catch (e) {
        toast('좋아요를 저장하지 못했어요');
        loadAll();
      }
    },
    isSaved: id => savedSet.has(id),
    toggleSave: async p => {
      const had = savedSet.has(p.id);
      setD(d => ({
        ...d,
        reactions: had ? d.reactions.filter(r => !(r.post_id === p.id && r.member_id === me && r.emoji === SAVE)) : [...d.reactions, {
          post_id: p.id,
          member_id: me,
          emoji: SAVE,
          created_at: new Date().toISOString()
        }]
      }));
      toast(had ? '보관함에서 뺐어요' : '보관했어요 · 내 프로필 → 보관에서 다시 볼 수 있어요');
      try {
        if (had) await db.del('reactions', `post_id=eq.${p.id}&member_id=eq.${me}&emoji=eq.${encodeURIComponent(SAVE)}`);else await db.add('reactions', {
          post_id: p.id,
          member_id: me,
          emoji: SAVE
        });
      } catch (e) {
        toast('보관하지 못했어요');
        loadAll();
      }
    },
    /* 보내기: 폰의 공유 창(카톡 등)으로 글과 사진 주소를 보낸다 */
    sharePost: async p => {
      const a = getM(p.author_id);
      const ph = photosOf(p)[0];
      const text = `${a.name}의 소식${p.title ? ` · ${p.title}` : ''}\n${p.content || ''}`.trim();
      try {
        if (navigator.share) {
          await navigator.share({
            title: 'Familygram',
            text,
            url: ph ? ph.url : undefined
          });
          return;
        }
        await navigator.clipboard.writeText(ph ? `${text}\n${ph.url}` : text);
        toast('글을 복사했어요. 카톡에 붙여 넣으세요');
      } catch (e) {
        if (e && e.name !== 'AbortError') toast('보내지 못했어요');
      }
    },
    addComment: row => write(() => db.add('comments', row)),
    deleteComment: c => {
      if (window.confirm('이 댓글을 지울까요?')) {
        write(() => db.del('comments', `id=eq.${c.id}`), '댓글을 지웠어요');
        const id = driveId(c.audio_url);
        if (id) gw('delete', {
          id
        }).catch(() => {});
      }
    },
    deletePost: async p => {
      if (!window.confirm('이 소식을 지울까요? 댓글도 함께 지워져요. (사진은 구글 드라이브에 그대로 남아요)')) return;
      const files = (cmtMap[p.id] || []).map(c => driveId(c.audio_url)).filter(Boolean); // 사진(줄인 것·원본)은 드라이브에 남긴다 (사용자 요청) · 목소리 댓글만 정리
      if (await write(() => db.del('posts', `id=eq.${p.id}`), '소식을 지웠어요')) files.forEach(id => gw('delete', {
        id
      }).catch(() => {}));
    },
    addNote: content => write(() => db.add('notes', {
      author_id: me,
      content,
      color: '#FFF6B8',
      angle: +(Math.random() * 4 - 2).toFixed(1)
    })),
    deleteNote: n => write(() => db.del('notes', `id=eq.${n.id}`)),
    deleteEvent: ev => {
      if (window.confirm(`"${ev.title}" 일정을 지울까요?`)) write(() => db.del('events', `id=eq.${ev.id}`), '일정을 지웠어요');
    },
    markRead: l => db.patch('letters', l.id, {
      read_at: new Date().toISOString()
    }).then(loadAll).catch(() => {}),
    deleteLetter: async l => {
      if (!window.confirm('이 편지를 지울까요?')) return;
      setLetterView(null);
      if (await write(() => db.del('letters', `id=eq.${l.id}`), '편지를 지웠어요')) {
        const id = driveId(l.audio_url);
        if (id) gw('delete', {
          id
        }).catch(() => {});
      }
    },
    deleteMember: async m => {
      if (D.members.length <= 1) {
        toast('마지막 한 명은 뺄 수 없어요');
        return;
      }
      if (!window.confirm(`${josa(m.name, '을', '를')} 명단에서 뺄까요?\n쓴 소식과 편지는 남아요.`)) return;
      if (await write(() => db.del('members', `id=eq.${m.id}`), `${josa(m.name, '을', '를')} 명단에서 뺐어요`)) {
        setMemberEdit(null);
        setProfile(null);
      }
    },
    changeKey: async (ko, kn) => {
      const k = kn.trim();
      if (k.length < 6) {
        toast('새 암호는 6자 이상이에요');
        return false;
      }
      try {
        await db.rpc('set_family_key', {
          new_key: k,
          old_key: ko.trim()
        });
        familyKey = k;
        store.set('fz_key', k);
        toast('가족 암호를 바꿨어요. 다른 폰은 새 암호를 넣어야 해요.');
        return true;
      } catch (e) {
        toast(e.message);
        return false;
      }
    },
    leave: () => leave(),
    changeMe: () => setMe(''),
    openComposer: cfg => setComposer(cfg || {}),
    openComments: (p, mode) => {
      setCmtMode(mode || '');
      setCmtPost(p);
    },
    openProfile: id => setProfile(id),
    openStory: items => items && items.length && setStory(items),
    openLetterCompose: cfg => setLetterCfg(cfg || {}),
    openLetter: l => setLetterView(l),
    openQuestion: q => setQuestion(q),
    openBook: y => setBook(y),
    openSettings: () => setSettings(true),
    reload: loadAll,
    hideNoti: key => saveHide({
      ...notiHide,
      keys: [...notiHide.keys, key]
    }),
    clearNoti: () => saveHide({
      keys: [],
      before: new Date().toISOString()
    }),
    openNote: n => setNoteView(n),
    noteReactsOf: id => D.nreacts.filter(r => r.note_id === id),
    noteRepliesOf: id => D.nreplies.filter(r => r.note_id === id),
    reactNote: async (n, emoji) => {
      // 메모마다 한 사람 한 마음: 같은 걸 다시 누르면 지우고, 다른 걸 누르면 바꾼다
      const cur = (D.nreacts.find(r => r.note_id === n.id && r.member_id === me) || {}).emoji;
      const off = cur === emoji;
      setD(d => ({
        ...d,
        nreacts: [...d.nreacts.filter(r => !(r.note_id === n.id && r.member_id === me)), ...(off ? [] : [{
          note_id: n.id,
          member_id: me,
          emoji,
          created_at: new Date().toISOString()
        }])]
      }));
      try {
        if (cur) await db.del('note_reacts', `note_id=eq.${n.id}&member_id=eq.${me}`);
        if (!off) await db.add('note_reacts', {
          note_id: n.id,
          member_id: me,
          emoji
        });
      } catch (e) {
        toast('마음을 저장하지 못했어요');
        loadAll();
      }
    },
    replyNote: (n, content) => write(() => db.add('note_replies', {
      note_id: n.id,
      author_id: me,
      content
    }), '답글을 남겼어요'),
    editNoteReply: (r, content) => write(() => db.patch('note_replies', r.id, {
      content,
      edited_at: new Date().toISOString()
    }), '답글을 수정했어요'),
    editComment: (c, content) => write(() => db.patch('comments', c.id, {
      content,
      edited_at: new Date().toISOString()
    }), '댓글을 수정했어요'),
    deleteNoteReply: r => {
      if (window.confirm('이 답글을 지울까요?')) write(() => db.del('note_replies', `id=eq.${r.id}`), '답글을 지웠어요');
    },
    openAdmin: () => setAdmin(true),
    isAdmin: !!(memberMap[me] && memberMap[me].is_admin),
    openLetters: () => setLettersOpen(true),
    openNoti: () => setNotiOpen(true),
    prayers: D.prayers,
    pmarks: D.pmarks,
    prayFocus,
    openPray: id => {
      setTab('pray');
      setPrayFocus(id);
    },
    /* 🙏 기도했어요: 오늘 한 번 (다시 누르면 취소) */
    togglePray: async p => {
      const day = ymd();
      const had = D.pmarks.some(m => m.prayer_id === p.id && m.member_id === me && m.day === day);
      setD(d => ({
        ...d,
        pmarks: had ? d.pmarks.filter(m => !(m.prayer_id === p.id && m.member_id === me && m.day === day)) : [...d.pmarks, {
          prayer_id: p.id,
          member_id: me,
          day,
          created_at: new Date().toISOString()
        }]
      }));
      if (!had) toast('함께 기도했어요 🙏');
      try {
        if (had) await db.del('prayer_marks', `prayer_id=eq.${p.id}&member_id=eq.${me}&day=eq.${day}`);else await db.add('prayer_marks', {
          prayer_id: p.id,
          member_id: me,
          day
        });
      } catch (e) {
        toast('저장하지 못했어요');
        loadAll();
      }
    },
    openTag: t => setTagView(t),
    openMemberEdit: m => setMemberEdit(m),
    openAgo: items => setAgo(items)
  };

  /* 알림: 앱을 열면 숫자 지우기 / 이 폰 주인이 바뀌면 알림 주소의 식구도 바꾸기 / 알림 눌러 열기 */
  useEffect(() => {
    if (!loaded || !me) return;
    clearBadge();
    ensurePush(me);
    logVisit(me);
  }, [loaded, me]);
  useEffect(() => {
    if (!PUSH_OK) return;
    const f = e => {
      if (e.data && e.data.type === 'fz-resub') {
        store.del('fz_push_ep');
        ensurePush(store.get('fz_me'));
        return;
      }
      if (e.data && e.data.type === 'fz-open') loadAll().then(() => setLinkReq(new URL(e.data.url).search));
    };
    navigator.serviceWorker.addEventListener('message', f);
    return () => navigator.serviceWorker.removeEventListener('message', f);
  }, []);
  useEffect(() => {
    if (!loaded || !linkReq || !D.members.some(m => m.id === me)) return;
    const q = new URLSearchParams(linkReq);
    setLinkReq('');
    history.replaceState(history.state, '', location.pathname);
    const post = q.get('post') && posts.find(p => p.id === q.get('post'));
    if (post) {
      if (q.get('c')) {
        setCmtMode('');
        setCmtPost(post);
      } else setPostView(post.id);
    }
    const l = q.get('letter') && D.letters.find(x => x.id === q.get('letter'));
    if (l) setLetterView(l);
    const qq = q.get('q') && D.questions.find(x => x.id === q.get('q'));
    if (qq) setQuestion(qq);
    const sid = q.get('story');
    if (sid) {
      const it = dailyToday(sid);
      if (it.length) setStory(it);
    }
    const pid = q.get('pray');
    if (pid) {
      setTab('pray');
      setPrayFocus(pid);
    }
    const nid = q.get('note');
    if (nid) {
      const n = D.notes.find(x => x.id === nid);
      if (n) setNoteView(n);
    }
  }, [loaded, linkReq, me, D]);

  /* 폰 뒤로가기: 홈이 아닌 탭(달력·기도·내 프로필)에서는 홈으로, 홈에서는 앱이 닫힌다.
     홈이 아닌 탭을 창 하나처럼 쌓아 두면, 뒤로가기가 열린 창 → 탭 → (홈이면 기록이 없어) 앱 종료 순으로 간다 */
  useLayer(tab !== 'home', () => {
    setTab('home');
    window.scrollTo(0, 0);
  });
  if (!hasKey) return /*#__PURE__*/React.createElement(Gate, {
    onEnter: () => setHasKey(true)
  });
  if (!loaded) return /*#__PURE__*/React.createElement("div", {
    className: "gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 26,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), loadErr ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 4px',
      fontWeight: 700
    }
  }, "\uAC00\uC871 \uC18C\uC2DD\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC5B4\uC694"), /*#__PURE__*/React.createElement("p", {
    className: "small muted",
    style: {
      margin: '0 0 14px'
    }
  }, loadErr, ". \uC778\uD130\uB137 \uC5F0\uACB0\uC744 \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uB20C\uB7EC \uC8FC\uC138\uC694."), /*#__PURE__*/React.createElement("button", {
    className: "btn primary",
    onClick: () => {
      setLoadErr('');
      loadAll();
    }
  }, "\uB2E4\uC2DC \uBD88\uB7EC\uC624\uAE30")) : /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  }), " \uAC00\uC871 \uC18C\uC2DD\uC744 \uD3BC\uCE58\uB294 \uC911\u2026"));
  if (!D.members.some(m => m.id === me)) return /*#__PURE__*/React.createElement(PickMe, {
    members: D.members,
    onPick: id => setMe(id),
    onLeave: () => leave()
  });
  if (auth === 'need') return /*#__PURE__*/React.createElement(PinGate, {
    member: D.members.find(m => m.id === me),
    onDone: tok => {
      store.set('fz_tok', tok);
      memberTok = tok;
      setAuth('ok');
      logVisit(me);
    },
    onOther: () => setMe('')
  });
  if (!auth) return /*#__PURE__*/React.createElement("div", {
    className: "gate"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, "Familygram", /*#__PURE__*/React.createElement(LIcon, {
    name: "heart",
    size: 26,
    fill: "#ED4956",
    stroke: "#ED4956"
  })), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, /*#__PURE__*/React.createElement("span", {
    className: "spin dark"
  })));

  /* 알림 탭을 떠날 때 "여기까지 봤어요" 로 적는다 */
  const goTab = t => {
    setTab(t);
    if (t !== 'pray') setPrayFocus(null);
  };
  /* 알림 창을 닫을 때 "여기까지 봤어요" 로 적는다 */
  const closeNoti = () => {
    setNotiOpen(false);
    const now = new Date().toISOString();
    store.set('fz_seen', now);
    setPrevSeen(now);
  };
  const me0 = getM(me);
  return /*#__PURE__*/React.createElement(Ctx.Provider, {
    value: C
  }, /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, tab === 'home' && /*#__PURE__*/React.createElement(HomeTab, null), tab === 'cal' && /*#__PURE__*/React.createElement(CalendarTab, null), tab === 'pray' && /*#__PURE__*/React.createElement(PrayTab, null), tab === 'me' && /*#__PURE__*/React.createElement(MeTab, null), /*#__PURE__*/React.createElement("nav", {
    className: "tabbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: tab === 'home' ? 'on' : '',
    onClick: () => {
      if (tab === 'home') window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      goTab('home');
    }
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "house",
    size: 26,
    fill: tab === 'home' ? '#1a1a1a' : undefined
  }), "\uD648"), /*#__PURE__*/React.createElement("button", {
    className: tab === 'cal' ? 'on' : '',
    onClick: () => goTab('cal')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "calendar-days",
    size: 26,
    sw: tab === 'cal' ? 2.4 : undefined
  }), "\uB2EC\uB825"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setComposer({}),
    "aria-label": "\uC0C8 \uC18C\uC2DD \uC62C\uB9AC\uAE30"
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "square-plus",
    size: 27
  }), "\uCD94\uAC00"), /*#__PURE__*/React.createElement("button", {
    className: tab === 'pray' ? 'on' : '',
    onClick: () => goTab('pray')
  }, /*#__PURE__*/React.createElement(LIcon, {
    name: "hand-heart",
    size: 26,
    sw: tab === 'pray' ? 2.4 : undefined
  }), "\uAE30\uB3C4"), /*#__PURE__*/React.createElement("button", {
    className: tab === 'me' ? 'on' : '',
    onClick: () => goTab('me')
  }, me0.avatar ? /*#__PURE__*/React.createElement("span", {
    className: "me-av"
  }, /*#__PURE__*/React.createElement(Avatar, {
    m: me0,
    size: 24
  })) : /*#__PURE__*/React.createElement(LIcon, {
    name: "circle-user-round",
    size: 26,
    sw: tab === 'me' ? 2.4 : undefined
  }), "\uB0B4 \uD504\uB85C\uD544"))), /*#__PURE__*/React.createElement(ProfilePage, {
    mid: profile,
    onClose: () => setProfile(null)
  }), /*#__PURE__*/React.createElement(AgoPage, {
    items: ago,
    onClose: () => setAgo(null)
  }), /*#__PURE__*/React.createElement(Composer, {
    cfg: composer,
    onClose: () => setComposer(null)
  }), /*#__PURE__*/React.createElement(CommentsSheet, {
    post: cmtPost,
    mode: cmtMode,
    onClose: () => setCmtPost(null)
  }), /*#__PURE__*/React.createElement(LetterCompose, {
    cfg: letterCfg,
    onClose: () => setLetterCfg(null)
  }), /*#__PURE__*/React.createElement(LetterView, {
    l: letterView,
    onClose: () => setLetterView(null)
  }), /*#__PURE__*/React.createElement(QuestionSheet, {
    q: question,
    onClose: () => setQuestion(null)
  }), /*#__PURE__*/React.createElement(MemberEdit, {
    m: memberEdit,
    onClose: () => setMemberEdit(null)
  }), /*#__PURE__*/React.createElement(SettingsSheet, {
    open: settings,
    onClose: () => setSettings(false)
  }), /*#__PURE__*/React.createElement(AdminSheet, {
    open: admin,
    onClose: () => setAdmin(false)
  }), /*#__PURE__*/React.createElement(LettersPage, {
    open: lettersOpen,
    onClose: () => setLettersOpen(false)
  }), /*#__PURE__*/React.createElement(TagPage, {
    tag: tagView,
    onClose: () => setTagView(null)
  }), /*#__PURE__*/React.createElement(NotiPage, {
    open: notiOpen,
    onClose: closeNoti
  }), /*#__PURE__*/React.createElement(NoteSheet, {
    note: noteView,
    onClose: () => setNoteView(null)
  }), /*#__PURE__*/React.createElement(Page, {
    open: !!postView,
    onClose: () => setPostView(null),
    title: "\uC18C\uC2DD"
  }, postView && (posts.find(p => p.id === postView) ? /*#__PURE__*/React.createElement(PostCard, {
    p: posts.find(p => p.id === postView)
  }) : /*#__PURE__*/React.createElement("p", {
    className: "empty"
  }, "\uC9C0\uC6CC\uC9C4 \uC18C\uC2DD\uC774\uC5D0\uC694."))), /*#__PURE__*/React.createElement(StoryViewer, {
    items: story,
    onClose: () => setStory(null)
  }), /*#__PURE__*/React.createElement(BookView, {
    year: book,
    onClose: () => setBook(null)
  }), toastMsg && /*#__PURE__*/React.createElement("div", {
    className: "toast",
    role: "status"
  }, toastMsg));
}
ReactDOM.createRoot(document.getElementById('root')).render( /*#__PURE__*/React.createElement(App, null));