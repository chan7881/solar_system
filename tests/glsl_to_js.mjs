// GLSL 함수 문자열 → JS 함수 묶음 (tests/rings_glsl.test.mjs가 셰이더 식을 rings.js와 대조할 때 쓴다)
// 다룰 수 있는 것: float·bool·vec2/3/4 타입, 스칼라 사칙연산, vec 생성자, dot·length·max·min·abs·exp·sqrt·pow·sin·cos·acos·log, 한 글자 스위즐(.x .y .z .w).
// 그 밖의 것(여러 글자 스위즐·벡터 사칙연산·int·mat·텍스처)을 만나면 조용히 틀린 값을 내지 않고 오류를 던진다.

const TYPE = '(?:float|bool|vec2|vec3|vec4)';

export function glslToJs(src) {
  const bad = src.match(/\.[xyzwrgba]{2,}\b|\b(?:int|mat[234]|texture2D|texture|sampler2D|uniform|varying)\b/);
  if (bad) throw new Error(`glslToJs: 다룰 수 없는 문법 「${bad[0]}」`);

  // 벡터 변수(매개변수·지역 변수) 이름 — 스위즐 없이 사칙연산에 쓰이면 거부
  const vecNames = [...src.matchAll(/\bvec[234]\s+(\w+)\b(?!\s*\()/g)].map(m => m[1]);
  for (const n of new Set(vecNames)) {
    const re = new RegExp(`(?:[-+*/]\\s*\\b${n}\\b(?!\\s*\\.))|(?:\\b${n}\\b(?!\\s*\\.)\\s*[-+*/](?!=))`);
    const m = src.match(re);
    if (m) throw new Error(`glslToJs: 벡터 사칙연산 「${m[0].trim()}」 — 성분별로 풀어 써야 대조할 수 있다`);
  }

  const js = src
    .replace(new RegExp(`\\b${TYPE}\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g'),
      (_, name, args) => `fns.${name} = function (${args.replace(new RegExp(`\\b${TYPE}\\s+`, 'g'), '')}) {`)
    .replace(new RegExp(`\\b${TYPE}\\s+(?=\\w+\\s*[=;,])`, 'g'), 'let ')
    .replace(/\bvec[234]\(/g, 'V(')
    .replace(/([\w)\]])\.([xyzw])\b/g, (_, a, c) => `${a}[${'xyzw'.indexOf(c)}]`);
  const fns = {};
  const V = (...a) => a, dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), length = a => Math.sqrt(dot(a, a));
  // GLSL 함수끼리 서로 부를 수 있게 이름을 fns에서 찾는다
  const body = `with (fns) { ${js} }`;
  new Function('fns', 'V', 'dot', 'length', 'max', 'min', 'abs', 'exp', 'sqrt', 'pow', 'sin', 'cos', 'acos', 'log', body)(
    fns, V, dot, length, Math.max, Math.min, Math.abs, Math.exp, Math.sqrt, Math.pow, Math.sin, Math.cos, Math.acos, Math.log);
  return fns;
}
