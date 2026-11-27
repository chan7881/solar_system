// 천체 밝기 검사(브라우저에서) — 혼자 볼 때 원반 평균 밝기가 고른지, 지구의 화면 평균(albedo.js EARTH_DISPLAY)이 얼마인지 잰다.
// 쓰는 법: 앱을 연 뒤 이 파일을 agent-browser eval --stdin으로 넣고, 초점을 그 천체로 옮긴 다음(__app.flyTo, 도착까지 기다림)
//   __alb() → { key, D, n, expo }. 카메라를 해 쪽(보름 위상)·반지름 4배 거리에 두고 한 번 그려 원반 화소(선형 Rec.709 밝기)의 평균 D를 잰다.
//   램버트 구를 보름 위상에서 보면 원반 평균 = 반사율 × (3/π) × (2/3) — D / 0.6366이 화면 평균 반사율에 해당한다.
window.__alb = () => {
  const A = window.__app, B = A.bodies[A.state.focus], cam = A.camera, sp = A.bodies.sun.pos;
  const d = [sp[0] - B.pos[0], sp[1] - B.pos[1], sp[2] - B.pos[2]], L = Math.hypot(...d);
  const R = B.reach ?? B.radius, k = 4 * R / L;
  const tgt = A.controls.target;
  cam.position.set(tgt.x + d[0] * k, tgt.y + d[1] * k, tgt.z + d[2] * k);
  cam.lookAt(tgt);
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  // 해를 향한 반구에 따라 밝기가 달라(달 앞면의 바다 등) 몸체를 자전축(몸체 Y) 둘레로 45°씩 8번 돌려 평균한다 — draw는 자세를 다시 계산하지 않는다
  const q0 = B.mesh.quaternion.clone(); let n = 0, s = 0;
  for (let r = 0; r < 8; r++) {
    B.mesh.quaternion.copy(q0); B.mesh.rotateY(r * Math.PI / 4); B.mesh.updateMatrixWorld(true);
    A.draw();
    const c = A.renderer.domElement, x = document.createElement('canvas'); x.width = c.width; x.height = c.height;
    const g = x.getContext('2d'); g.drawImage(c, 0, 0); const px = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 3) { n++; s += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]); }
  }
  B.mesh.quaternion.copy(q0);
  return { key: B.key, D: +(s / n / 0.6366).toFixed(4), n: n / 8, expo: +B.expo.value.toFixed(4) };
};
