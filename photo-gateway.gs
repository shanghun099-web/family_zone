/**
 * THE FAMILY ZONE → 사진·목소리 창구 (Apps Script 웹앱, v1)
 *   가족 앱이 보낸 사진과 음성을 "내 구글 드라이브"의 가족 폴더에 넣어 준다.
 *   가족 암호가 맞는 요청만 받는다 (Supabase 의 is_family 로 확인).
 *
 *   - 사진: 링크가 있는 사람만 볼 수 있게 공유하고, 앱에 보여 줄 주소를 돌려준다
 *   - 목소리: 공유하지 않는다. 앱이 가족 암호로 이 창구를 통해서만 꺼내 듣는다
 *   - 지우기: 드라이브 휴지통으로 옮긴다 (30일 안에는 드라이브에서 되살릴 수 있음)
 *
 * 설치 (한 번만):
 *  1. https://script.google.com 에서 "새 프로젝트" → 이 파일 내용을 전부 붙여넣고 저장 (프로젝트 이름: 패밀리 존 사진 창구)
 *  2. 오른쪽 위 "배포" → "새 배포" → 톱니바퀴에서 유형 "웹 앱"
 *       - 설명: 사진 창구
 *       - 다음 사용자 인증 정보로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자   ← 이게 아니면 가족 폰에서 연결이 안 됩니다
 *  3. "배포" → 권한 허용(내 계정, 드라이브·외부 연결 허용) → 나오는 웹 앱 URL(…/exec) 복사
 *     ("Google에서 확인하지 않은 앱" 화면이 나오면: 고급 → "패밀리 존 사진 창구(으)로 이동")
 *  4. 그 URL 을 Claude 에게 알려주면 앱에 넣어 드립니다
 *
 * 스크립트를 고친 뒤(이 파일을 새로 붙여넣은 뒤)에는:
 *    "배포" → "배포 관리" → 연필(수정) → 버전: "새 버전" → "배포"   를 해야 반영됩니다. URL은 그대로입니다.
 *    ("새 배포"를 누르면 다른 URL이 생기니 주의)
 *
 * 폴더는 처음 올릴 때 내 드라이브에 "THE FAMILY ZONE" 이름으로 자동 생성되고, 안에 "사진"·"목소리" 폴더가 생깁니다.
 */

const SUPABASE_URL = 'https://ijpbmlphaanmqnsixckt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lZIA-d3DTswNZOKdhEn4iw_W8k7BDQl';   // 공개용 키 (앱 코드에도 들어 있음)
const ROOT_NAME = 'THE FAMILY ZONE';
const VERSION = 1;

/* 연결 확인용. 암호 없이도 살아 있는지만 알려 준다 */
function doGet() {
  return json_({ ok: true, v: VERSION });
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (!isFamily_(p.key)) return json_({ ok: false, error: '가족 암호가 맞지 않습니다' });

    if (p.action === 'upload') return json_(upload_(p));
    if (p.action === 'get') return json_(getFile_(p.id));
    if (p.action === 'delete') return json_(trash_(p.id));
    if (p.action === 'ping') return json_({ ok: true, v: VERSION, folder: root_().getUrl() });
    return json_({ ok: false, error: '모르는 요청입니다: ' + p.action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------- 올리기 ---------- */

/* p: { kind: 'photo'|'voice', name, mime, data(base64) }  */
function upload_(p) {
  const kind = p.kind === 'voice' ? 'voice' : 'photo';
  const mime = String(p.mime || (kind === 'voice' ? 'audio/webm' : 'image/jpeg'));
  if (kind === 'photo' && mime.indexOf('image/') !== 0) throw new Error('사진 파일이 아닙니다');
  if (kind === 'voice' && mime.indexOf('audio/') !== 0) throw new Error('음성 파일이 아닙니다');
  if (!p.data) throw new Error('파일 내용이 비어 있습니다');

  const bytes = Utilities.base64Decode(p.data);
  const name = today_() + '_' + safeName_(p.name || (kind === 'voice' ? '목소리' : '사진')) + ext_(mime);
  const file = sub_(kind === 'voice' ? '목소리' : '사진').createFile(Utilities.newBlob(bytes, mime, name));

  if (kind === 'photo') {
    // 사진은 링크를 아는 사람만 볼 수 있게 — 파일 ID 는 추측할 수 없는 긴 글자라 앱 밖에서는 찾을 수 없다
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const id = file.getId();
    return {
      ok: true, id: id,
      url: 'https://lh3.googleusercontent.com/d/' + id + '=w1600',    // 크게 보기
      thumb: 'https://lh3.googleusercontent.com/d/' + id + '=w480'    // 목록용
    };
  }
  return { ok: true, id: file.getId() };
}

/* ---------- 꺼내기 (목소리) ---------- */

function getFile_(id) {
  const file = inFamily_(id);
  const blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- 지우기 ---------- */

function trash_(id) {
  inFamily_(id).setTrashed(true);
  return { ok: true };
}

/* ---------- 내부 ---------- */

/* 가족 암호 확인: Supabase 에 그 암호로 is_family() 를 물어본다. 맞으면 10분 동안 기억해 둔다 */
function isFamily_(key) {
  if (!key || String(key).length < 6) return false;
  const cache = CacheService.getScriptCache();
  const tag = 'fam_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key), Utilities.Charset.UTF_8));
  if (cache.get(tag) === '1') return true;
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/is_family', {
    method: 'post', contentType: 'application/json', payload: '{}', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY, 'x-family-key': String(key) }
  });
  const ok = res.getResponseCode() === 200 && res.getContentText().trim() === 'true';
  if (ok) cache.put(tag, '1', 600);
  return ok;
}

/* 가족 폴더 안에 있는 파일만 다룬다 (다른 드라이브 파일은 건드리지 않게) */
function inFamily_(id) {
  if (!id) throw new Error('파일 ID 가 없습니다');
  const file = DriveApp.getFileById(String(id));
  const rootId = root_().getId();
  const parents = file.getParents();
  while (parents.hasNext()) {
    const up = parents.next();
    if (up.getId() === rootId) return file;
    const grand = up.getParents();
    while (grand.hasNext()) if (grand.next().getId() === rootId) return file;
  }
  throw new Error('가족 폴더의 파일이 아닙니다');
}

/* "THE FAMILY ZONE" 폴더: 저장해 둔 ID → (없으면) 새로 만들기 */
function root_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('root_id');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 지워졌으면 아래에서 새로 만든다 */ }
  }
  const folder = DriveApp.createFolder(ROOT_NAME);
  props.setProperty('root_id', folder.getId());
  return folder;
}

function sub_(name) {
  const root = root_();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function today_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd_HHmmss');
}

function safeName_(s) {
  return String(s).replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 40) || '파일';
}

function ext_(mime) {
  const m = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
              'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg' };
  return m[String(mime).split(';')[0]] || '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
