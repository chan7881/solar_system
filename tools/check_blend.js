// 반투명 합성 검사(브라우저에서) — 고리가 선형 빛 세기로 섞이는지 잰다: on = L + T·off
// 쓰는 법: 앱을 연 뒤 이 파일을 콘솔·agent-browser eval --stdin으로 넣고, 고리가 몸체 앞을 지나는 화면에서 __lin('saturn') 또는 __lin('haumea').
// L = 고리만(검은 배경), T = (회색 배경 − L)/0.5, off = 몸체만. linErr가 0.003 아래면 선형(2026-11-27: 토성 0.0009 · 하우메아 0.0017),
// 캔버스에 바로 그리던 예전 방식은 0.0285 · 0.0173.
window.__lin = (key) => {
  const A = window.__app, B = A.bodies[key], scene = A.bodies.sun.mesh.parent;
  const ring = B.mesh.children.find(c => c.material && c.material.uniforms && c.material.blending === 5);
  const grab = () => { A.draw(); const c = A.renderer.domElement, x = document.createElement('canvas'); x.width = c.width; x.height = c.height;
    const g = x.getContext('2d'); g.drawImage(c, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const bodyMat = B.mesh.material, bg0 = scene.background.clone();
  const others = []; scene.traverse(o => { if (o.isLine || o.isPoints) { if (o.visible) others.push(o); o.visible = false; } });
  const hideBody = on => { B.mesh.material.colorWrite = !on; };
  const both = grab();
  hideBody(true); const L = grab();
  const G = 0.5; scene.background.setRGB(G, G, G); const LG = grab(); scene.background.copy(bg0);
  hideBody(false); ring.visible = false; const off = grab(); ring.visible = true;
  others.forEach(o => o.visible = true);
  let n = 0, err = 0, errS = 0, maxe = 0, sumT = 0;
  for (let i = 0; i < both.length; i += 4) {
    const k = 1; // 초록 채널
    const l = lin(L[i + k]), lg = lin(LG[i + k]), f = lin(off[i + k]), o = lin(both[i + k]);
    const T = (lg - l) / G;
    if (f < 0.05 || T > 0.95 || T < 0.05 || lg > 0.98) continue; // 몸체 위 + 고리가 반쯤 비치는 곳만
    const pred = l + T * f;
    // sRGB 합성이었다면: on_s = L_s + T·off_s
    const s = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
    const predS = lin(Math.min(255, s(l) + T * s(f)));
    n++; err += Math.abs(o - pred); errS += Math.abs(o - predS); maxe = Math.max(maxe, Math.abs(o - pred)); sumT += T;
  }
  return JSON.stringify({ key, n, meanT: +(sumT / n).toFixed(3), linErr: +(err / n).toFixed(4), srgbModelErr: +(errS / n).toFixed(4), maxLinErr: +maxe.toFixed(4) });
};
