// 화면 코드 미리 번역하기: src/app.jsx (JSX) → app.js (보통 자바스크립트)
// 폰이 열 때마다 번역하지 않아서 빨리 뜨고, 1.5MB 번역기(babel)도 안 받는다.
// 쓰는 법: 화면을 고친 뒤 `npm run build` → index.html 의 app.js?v=… 가 새 값으로 바뀐다
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Babel = require('@babel/standalone');

const src = readFileSync('src/app.jsx', 'utf8');
const { code } = Babel.transform(src, { presets: ['react'], compact: false, comments: true, sourceType: 'script' });
const out = '/* 이 파일은 src/app.jsx 에서 만들어져요 (npm run build). 여기를 직접 고치지 마세요 */\n' + code;
writeFileSync('app.js', out);
const v = createHash('sha1').update(out).digest('hex').slice(0, 8);

let html = readFileSync('index.html', 'utf8');
html = html.replace(/<script src="app\.js\?v=[0-9a-f]+"><\/script>/, `<script src="app.js?v=${v}"></script>`);
if (!html.includes(`app.js?v=${v}`)) throw new Error('index.html 에서 app.js 자리를 못 찾았어요');
writeFileSync('index.html', html);
console.log(`app.js ${(out.length / 1024).toFixed(0)}KB · v=${v}`);
