// Familygram 폰 알림 보내기 (Supabase Edge Function "notify")
// - 표에 새 줄이 생기면(posts·comments·letters·answers·reactions) DB 트리거가 이 함수를 부른다
// - 밤 10시~아침 8시(한국)에는 바로 안 보내고 push_outbox 에 모았다가 ?mode=morning(아침 8시 cron)에 보낸다
// - 아침에는 내일 생일·행사도 알려 준다
// 열쇠(VAPID)·비밀값은 private.push_config 에 있고 push_cfg() 로만 읽는다 (코드에 없음)
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP = "https://shanghun099-web.github.io/family_zone/";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Msg = { to: string[]; pref: string; title: string; body?: string; url?: string; tag?: string; image?: string };
type Sub = { id: string; member_id: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, boolean>; unread: number };

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await sb.rpc("push_cfg");
  if (error) throw error;
  cfg = data as Record<string, string>;
  webpush.setVapidDetails(cfg.subject, cfg.vapid_pub, cfg.vapid_priv);
  return cfg;
}

/* ── 날짜: 한국 시간 ── */
const pad = (n: number) => String(n).padStart(2, "0");
const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymdUTC = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayKST = () => ymdUTC(kst());
const weekKST = () => { const d = kst(); return ymdUTC(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5)); };   // 이번 주 월요일
const isQuiet = () => { const h = kst().getUTCHours(); return h >= 22 || h < 8; };
const fmtDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return `${y}년 ${m}월 ${d}일`; };
const josa = (w: string, a: string, b: string) => { const c = w.charCodeAt(w.length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b); };
const cut = (s: string | null | undefined, n = 80) => { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

/* ── 음력·매년 일정 (앱과 같은 계산) ── 이 함수 안의 Date 는 UTC 를 그대로 날짜로 쓴다 */
const LUNAR = new Intl.DateTimeFormat("ko-KR-u-ca-dangi", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
function lunarOf(d: Date) {
  const p: Record<string, string> = {}; LUNAR.formatToParts(d).forEach(x => p[x.type] = x.value);
  const mm = String(p.month || "");
  return { y: +(p.relatedYear || p.year), m: parseInt(mm.replace(/\D/g, ""), 10), d: parseInt(p.day, 10), leap: /윤/.test(mm) };
}
const lyCache: Record<number, Record<string, string>> = {};
function lunarYear(Y: number) {
  if (lyCache[Y]) return lyCache[Y];
  const map: Record<string, string> = {}; let d = new Date(Date.UTC(Y, 0, 10));
  for (let i = 0; i < 420; i++) {
    const l = lunarOf(d); if (l.y > Y) break;
    if (l.y === Y && !l.leap) { const k = l.m + "-" + l.d; if (!map[k]) map[k] = ymdUTC(d); }
    d = new Date(d.getTime() + 864e5);
  }
  return lyCache[Y] = map;
}
const solarOfLunar = (Y: number, m: number, d: number) => { const map = lunarYear(Y); return map[m + "-" + d] || (d === 30 ? map[m + "-29"] : null) || null; };
// deno-lint-ignore no-explicit-any
function occursOn(ev: any, day: string) {
  const Y = +day.slice(0, 4);
  if (ev.calendar === "lunar" && ev.lunar_month) return [Y - 1, Y].some(ly => solarOfLunar(ly, ev.lunar_month, ev.lunar_day) === day);
  if (!ev.event_date) return false;
  if (!ev.yearly) return ev.event_date === day;
  const [, m, d] = ev.event_date.split("-");
  let s = `${Y}-${m}-${d}`;
  if (m === "02" && d === "29" && new Date(Date.UTC(Y, 1, 29)).getUTCMonth() !== 1) s = `${Y}-02-28`;
  return ev.event_date.slice(0, 4) <= String(Y) && s === day;
}

/* ── 보내기 ── */
async function send(sub: Sub, m: Omit<Msg, "to" | "pref">) {
  const badge = (sub.unread || 0) + 1;
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: m.title, body: m.body || "", url: m.url || APP, tag: m.tag, image: m.image, badge }),
      { TTL: 86400, urgency: "normal" });
    await sb.from("push_subs").update({ unread: badge, last_ok: new Date().toISOString() }).eq("id", sub.id);
    sub.unread = badge;
    return 1;
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const code = (e as any)?.statusCode;
    if (code === 404 || code === 410) { console.log("expired sub removed", sub.member_id, code); await sb.from("push_subs").delete().eq("id", sub.id); }   // 알림을 끈 폰·지운 앱
    else console.error("push fail", code, String(e).slice(0, 200));
    return 0;
  }
}
async function deliver(m: Msg) {
  if (!m.to.length) return 0;
  const { data } = await sb.from("push_subs").select("*").in("member_id", m.to);
  let n = 0; const quiet = isQuiet();
  for (const sub of (data || []) as Sub[]) {
    if (sub.prefs && sub.prefs[m.pref] === false) continue;
    const { to: _t, pref: _p, ...msg } = m;
    if (quiet && sub.prefs?.quiet !== false) { await sb.from("push_outbox").insert({ sub_id: sub.id, msg }); continue; }
    n += await send(sub, msg);
  }
  return n;
}

/* ── 새 줄 → 누구에게 무슨 알림 ── */
// deno-lint-ignore no-explicit-any
async function build(table: string, r: any, op = "INSERT", old: any = null): Promise<Msg[]> {
  const { data: ms } = await sb.from("members").select("id,name");
  const all = (ms || []) as { id: string; name: string }[];
  const name = (id: string) => (all.find(x => x.id === id) || { name: "식구" }).name;
  const others = (...ex: string[]) => all.map(x => x.id).filter(id => !ex.includes(id));
  const today = todayKST();

  if (table === "posts") {
    const a = name(r.author_id); const ph = Array.isArray(r.photos) && r.photos[0];
    if (r.kind === "daily") return [{ to: others(r.author_id), pref: "post", title: `${a}의 오늘의 한 장 📷`, body: cut(r.content) || "사진을 올렸어요", url: `${APP}?story=${r.author_id}`, tag: `daily-${r.author_id}`, image: ph && (ph.thumb || ph.url) }];
    if (r.open_on && r.open_on > today) return [{ to: others(r.author_id), pref: "post", title: `${josa(a, "이", "가")} 타임캡슐을 묻었어요 🔒`, body: `${fmtDate(r.open_on)}에 열려요`, url: APP, tag: `post-${r.id}` }];
    const out: Msg[] = [{ to: others(r.author_id, r.ask_to || ""), pref: "post", title: `${josa(a, "이", "가")} 새 소식을 올렸어요`, body: cut(r.title ? `${r.title} · ${r.content || ""}` : r.content) || `사진 ${Array.isArray(r.photos) ? r.photos.length : 0}장`, url: `${APP}?post=${r.id}`, tag: `post-${r.id}`, image: ph && (ph.thumb || ph.url) }];
    if (r.ask_to && r.ask_to !== r.author_id) out.push({ to: [r.ask_to], pref: "letter", title: `${josa(a, "이", "가")} 질문했어요 ❓`, body: cut(r.ask_text), url: `${APP}?post=${r.id}&c=1`, tag: `ask-${r.id}`, image: ph && (ph.thumb || ph.url) });
    return out;
  }
  if (table === "comments") {
    const { data: p } = await sb.from("posts").select("id,author_id,content,open_on").eq("id", r.post_id).maybeSingle();
    if (!p) return [];
    const { data: cs } = await sb.from("comments").select("author_id").eq("post_id", r.post_id);
    const to = [...new Set([p.author_id, ...((cs || []).map((c: { author_id: string }) => c.author_id))])].filter(id => id !== r.author_id);
    const c = name(r.author_id);
    const title = r.is_answer ? `${josa(c, "이", "가")} 질문에 답했어요` : `${josa(c, "이", "가")} ${r.audio_url ? "목소리 댓글" : "댓글"}을 남겼어요`;
    return [{ to, pref: "react", title, body: cut(r.content) || (r.audio_url ? "🎙 눌러서 들어 보세요" : ""), url: `${APP}?post=${p.id}&c=1`, tag: `cmt-${p.id}` }];
  }
  if (table === "reactions") {
    if (r.emoji === "🔖") return [];
    const { data: p } = await sb.from("posts").select("id,author_id,content").eq("id", r.post_id).maybeSingle();
    if (!p || p.author_id === r.member_id) return [];
    return [{ to: [p.author_id], pref: "react", title: `${josa(name(r.member_id), "이", "가")} 내 소식을 좋아해요 ❤️`, body: cut(p.content, 60), url: `${APP}?post=${p.id}`, tag: `like-${p.id}` }];
  }
  if (table === "letters") {
    if (!r.receiver_id || r.receiver_id === r.sender_id) return [];
    const s = name(r.sender_id);
    if (r.open_on && r.open_on > today) return [{ to: [r.receiver_id], pref: "letter", title: `${josa(s, "이", "가")} 타임캡슐 편지를 보냈어요 🔒`, body: `${fmtDate(r.open_on)}에 열려요`, url: APP, tag: `letter-${r.id}` }];
    return [{ to: [r.receiver_id], pref: "letter", title: `${josa(s, "이", "가")} 편지를 보냈어요 💌`, body: cut(r.title || r.content) || (r.audio_url ? "🎙 목소리 편지" : ""), url: `${APP}?letter=${r.id}`, tag: `letter-${r.id}` }];
  }
  if (table === "answers") {
    // 다 같이 공개: 답 내용은 알림에 안 넣고, 모두 답하면 "답이 열렸어요"
    const { data: q } = await sb.from("questions").select("id,text").eq("id", r.question_id).maybeSingle();
    const { data: as } = await sb.from("answers").select("member_id").eq("question_id", r.question_id);
    const done = new Set((as || []).map((a: { member_id: string }) => a.member_id)).size;
    if (done >= all.length) return [{ to: all.map(x => x.id), pref: "letter", title: "모두 답했어요! 이번 주 답이 열렸어요 🎁", body: q ? `“${cut(q.text, 60)}”` : "", url: `${APP}?q=${r.question_id}`, tag: `ans-${r.question_id}` }];
    return [{ to: others(r.member_id), pref: "letter", title: `${josa(name(r.member_id), "이", "가")} 이번 주 질문에 답했어요`, body: `답 ${done}/${all.length} · 모두 답하면 다 같이 열려요`, url: `${APP}?q=${r.question_id}`, tag: `ans-${r.question_id}` }];
  }
  if (table === "questions") {
    if (!r.asker_id) return [];
    const who = name(r.asker_id);
    const url = `${APP}?q=${r.id}`;
    if (!r.text) {   // 질문자가 아직 고르는 중: 새 주가 시작됐거나 차례가 넘어왔을 때 질문자에게만
      if (op === "INSERT") return [{ to: [r.asker_id], pref: "letter", title: `이번 주는 ${josa(who, "이", "가")} 질문할 차례예요 🎤`, body: "질문 상자에서 고르거나, 글이나 말로 직접 물어보세요", url, tag: `q-${r.id}` }];
      if (old && old.asker_id !== r.asker_id) return [{ to: [r.asker_id], pref: "letter", title: `차례가 넘어왔어요 🎤 이번 주 질문자는 ${who}`, body: `${old.asker_id ? name(old.asker_id) : "식구"}에게서 차례를 받았어요. 온 가족에게 물어볼 질문을 정해 주세요`, url, tag: `q-${r.id}` }];
      return [];
    }
    if (op === "UPDATE" && old && old.text === r.text) return [];
    const title = r.auto ? `이번 주 질문이 나왔어요 ❓ (${who} 차례 · 자동)` : `${josa(who, "이", "가")} 이번 주 질문을 냈어요 ❓`;
    return [{ to: r.auto ? all.map(x => x.id) : others(r.asker_id), pref: "letter", title, body: `“${cut(r.text, 70)}”${r.note ? ` · ${cut(r.note, 30)}` : ""}`, url, tag: `q-${r.id}` }];
  }
  return [];
}

/* ── 아침 8시: 밤사이 모은 것 + 내일 생일·행사 ── */
async function morning() {
  let sent = 0;
  const { data: box } = await sb.from("push_outbox").select("id,sub_id,msg").order("id");
  const bySub: Record<string, { id: number; msg: Msg }[]> = {};
  (box || []).forEach((b: { id: number; sub_id: string; msg: Msg }) => (bySub[b.sub_id] = bySub[b.sub_id] || []).push(b));
  for (const [sid, items] of Object.entries(bySub)) {
    const { data: sub } = await sb.from("push_subs").select("*").eq("id", sid).maybeSingle();
    if (sub) {
      if (items.length > 3) sent += await send(sub as Sub, { title: `밤사이 소식 ${items.length}개가 왔어요 🌙`, body: items.slice(0, 3).map(x => x.msg.title).join(" · "), url: APP, tag: "night" });
      else for (const x of items) sent += await send(sub as Sub, x.msg);
    }
    await sb.from("push_outbox").delete().in("id", items.map(x => x.id));
  }
  // 이번 주 질문: 월요일엔 질문자 차례 줄 만들기(트리거가 질문자에게 알림), 수요일부터 아직 비어 있으면 상자에서 자동으로
  const dow = kst().getUTCDay();
  if (dow === 1) await sb.rpc("ensure_week_q");
  if (dow >= 3 || dow === 0) {
    const { data: wq } = await sb.from("questions").select("id,text").eq("week_start", weekKST()).maybeSingle();
    if (wq && !wq.text) {
      const { data: used } = await sb.from("questions").select("text");
      const usedSet = new Set((used || []).map((x: { text: string }) => x.text));
      const { data: bank } = await sb.from("question_bank").select("text,added_by");
      const pool = (bank || []).filter((b: { text: string }) => !usedSet.has(b.text));
      const fam = pool.filter((b: { added_by: string | null }) => b.added_by);   // 식구가 넣은 질문 먼저
      const pick = (fam.length ? fam : pool)[Math.floor(Math.random() * (fam.length || pool.length))];
      if (pick) await sb.from("questions").update({ text: pick.text, auto: true, picked_at: new Date().toISOString() }).eq("id", wq.id);
    }
  }
  // 내일 생일·행사
  const tomorrow = ymdUTC(new Date(kst().getTime() + 864e5));
  const { data: ms } = await sb.from("members").select("id,name,birth_date,bday_lunar");
  const { data: evs } = await sb.from("events").select("*");
  const ids = (ms || []).map((m: { id: string }) => m.id);
  const days: { title: string; skip?: string }[] = [];
  for (const m of (ms || []) as { id: string; name: string; birth_date: string | null; bday_lunar: boolean }[]) {
    if (!m.birth_date) continue;
    const [y, mo, d] = m.birth_date.split("-").map(Number);
    const ev = m.bday_lunar ? (() => { const l = lunarOf(new Date(Date.UTC(y, mo - 1, d))); return { calendar: "lunar", lunar_month: l.m, lunar_day: l.d }; })()
      : { calendar: "solar", event_date: m.birth_date, yearly: true };
    if (occursOn(ev, tomorrow)) days.push({ title: `내일은 ${m.name} 생일이에요 🎂`, skip: m.id });
  }
  for (const e of (evs || [])) if (occursOn(e, tomorrow)) days.push({ title: `내일은 ${josa(e.title, "이에요", "예요")} 📅` });
  for (const d of days) sent += await deliver({ to: ids.filter((id: string) => id !== d.skip), pref: "day", title: d.title, body: fmtDate(tomorrow), url: APP, tag: `day-${tomorrow}-${d.title}` });
  return { sent, outbox: (box || []).length, days: days.length };
}

// 앱(github.io)이 시험 알림 결과를 읽을 수 있게 CORS 허용 (요청은 text/plain 이라 사전 확인 없음)
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

Deno.serve(async req => {
  try {
    const c = await config();
    const mode = new URL(req.url).searchParams.get("mode");
    if (mode === "self") {   // 앱의 "시험 알림 받기": 자기 폰 알림 주소로만 한 통 (주소를 아는 폰만 부를 수 있음)
      const { endpoint } = await req.json();
      const { data: sub } = await sb.from("push_subs").select("*").eq("endpoint", String(endpoint || "")).maybeSingle();
      if (!sub) return json({ sent: 0, error: "not_subscribed" }, 404);
      const n = await send(sub as Sub, { title: "Familygram 시험 알림 🔔", body: "이 알림이 보이면 성공이에요! 누르면 앱이 열려요.", url: APP, tag: "self-test" });
      return json({ sent: n }, n ? 200 : 410);
    }
    if (req.headers.get("x-push-secret") !== c.secret) return json({ error: "no" }, 401);
    if (mode === "morning") return json(await morning());
    if (mode === "reveal") {   // 토요일 밤 9시(cron q-reveal): 다 같이 공개
      const { data: wq } = await sb.from("questions").select("id,text").eq("week_start", weekKST()).maybeSingle();
      if (!wq || !wq.text) return json({ sent: 0 });
      const { data: as } = await sb.from("answers").select("member_id").eq("question_id", wq.id);
      const { data: ms } = await sb.from("members").select("id");
      const done = new Set((as || []).map((a: { member_id: string }) => a.member_id)).size;
      if (!done || done >= (ms || []).length) return json({ sent: 0, done });   // 아무도 안 했거나 이미 모두 답해서 열림
      return json({ sent: await deliver({ to: (ms || []).map((m: { id: string }) => m.id), pref: "letter", title: "이번 주 답이 다 같이 열렸어요 🎁", body: `“${cut(wq.text, 60)}” · 답 ${done}개`, url: `${APP}?q=${wq.id}`, tag: `ans-${wq.id}` }) });
    }
    const body = await req.json();
    if (mode === "test") {   // 시험: 한 식구에게 바로 한 통 (밤에도)
      const { data } = await sb.from("push_subs").select("*").eq("member_id", body.member_id);
      let n = 0; for (const s of (data || []) as Sub[]) n += await send(s, { title: body.title || "Familygram 알림 시험", body: body.body || "알림이 잘 와요 👍", url: APP, tag: "test" });
      return json({ sent: n, subs: (data || []).length });
    }
    const msgs = await build(body.table, body.record || {}, body.op || "INSERT", body.old || null);
    let sent = 0; for (const m of msgs) sent += await deliver(m);
    return json({ sent, msgs: msgs.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
