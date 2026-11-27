// 고리와 몸체를 같이 볼 때의 화면 밝기 비(브라우저에서) — tests/rings_hst.test.mjs가 순수 함수로 맞춘 비가 화면에서도 나오는지 잰다.
// 쓰는 법: 앱을 연 뒤 이 파일을 agent-browser eval --stdin으로 넣고, 초점을 토성으로(__app.flyTo('saturn'), 도착까지 기다림) __rg().
//   카메라를 해 쪽·반지름 400배 거리에 두고 시야각을 좁혀(가까우면 안사가 해 방향에서 비껴 위상각이 커진다 — 8배 거리면 약 12°로 0.8배), 고리를 끈 그림에서 몸체 원반 평균 G, 몸체를 끈 그림에서 고리띠 화소 평균을 잰다
//   (몸체가 겹치는 화소는 뺀다). 램버트 몸체의 보름 원반 평균은 (2/3)·반사율이라 고리/G = 고리 I/F ÷ 몸체 원반 평균(실제는 pV)이다.
window.__rg = () => {
  const A = window.__app, B = A.bodies.saturn, cam = A.camera, sp = A.bodies.sun.pos;
  const d = [sp[0] - B.pos[0], sp[1] - B.pos[1], sp[2] - B.pos[2]], L = Math.hypot(...d), k = 400 * B.radius / L, tgt = A.controls.target;
  cam.position.set(tgt.x + d[0] * k, tgt.y + d[1] * k, tgt.z + d[2] * k); cam.lookAt(tgt);
  const fov0 = cam.fov; cam.fov = 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) * 8 / 400) * 180 / Math.PI; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const ring = B.mesh.children.find(c => c.material && c.material.uniforms && c.material.uniforms.uTauA);
  // draw()는 고리의 카메라 위치(uCamL, 토성 로컬)를 갱신하지 않는다(step의 updateRings가 한다) → 여기서 넣는다
  ring.material.uniforms.uCamL.value.copy(cam.position).sub(B.mesh.position).applyQuaternion(B.mesh.quaternion.clone().invert());
  const scene = A.bodies.sun.mesh.parent, hid = [];
  scene.traverse(o => { if ((o.isLine || o.isPoints || o.isSprite) && o.visible) { hid.push(o); o.visible = false; } });
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const grab = () => { A.draw(); const c = A.renderer.domElement, x = document.createElement('canvas'); x.width = c.width; x.height = c.height;
    const g = x.getContext('2d'); g.drawImage(c, 0, 0); return { W: c.width, H: c.height, px: g.getImageData(0, 0, c.width, c.height).data }; };
  const Y = (p, i) => 0.2126 * lin(p[i]) + 0.7152 * lin(p[i + 1]) + 0.0722 * lin(p[i + 2]);
  // 몸체만 잴 때는 고리 그림자(몸체 위)도 끈다 — 위상각 0이면 그림자는 고리 바로 뒤에 숨어 있어, 고리만 지우면 그림자가 드러나 G가 낮아진다
  const sh = ring.material.uniforms.uShadowOn, sh0 = sh.value;
  ring.visible = false; sh.value = 0; const gImg = grab(); ring.visible = true; sh.value = sh0;
  B.mesh.material.colorWrite = false; const rImg = grab(); B.mesh.material.colorWrite = true;
  hid.forEach(o => (o.visible = true));
  let gs = 0, gn = 0, peak = 0;
  for (let i = 0; i < gImg.px.length; i += 4) { const y = Y(gImg.px, i); if (y > 0.004) { gs += y; gn++; peak = Math.max(peak, y); } }
  const G = gs / gn;
  // 고리면 법선과 해 방향 사이 |cos| = μ0 = μ(해 쪽에서 봄)
  const n = B.mesh.localToWorld(cam.position.clone().set(0, 1, 0)).sub(B.mesh.getWorldPosition(cam.position.clone())).normalize();
  const mu = Math.abs(n.dot(cam.position.clone().sub(tgt).normalize()));
  const band = (a, b) => {
    let s = 0, c = 0; const seen = new Set();
    for (let j = 0; j < 40; j++) for (let t = 0; t < 1440; t++) {
      const r = a + (b - a) * (j + 0.5) / 40, f = t / 1440 * 2 * Math.PI;
      const p = B.mesh.localToWorld(cam.position.clone().set(r * Math.cos(f), 0, r * Math.sin(f))).project(cam);
      const x = Math.round((p.x + 1) / 2 * rImg.W), y = Math.round((1 - p.y) / 2 * rImg.H);
      if (x < 0 || y < 0 || x >= rImg.W || y >= rImg.H) continue;
      const i = (y * rImg.W + x) * 4; if (seen.has(i)) continue; seen.add(i);
      if (Y(gImg.px, i) > 0.002) continue; // 몸체와 겹치는 화소는 뺀다
      s += Y(rImg.px, i); c++;
    }
    return { mean: s / c, n: c };
  };
  const C = band(78000, 83000), Bb = band(100000, 107000), Ar = band(127000, 129000);
  cam.fov = fov0; cam.updateProjectionMatrix();
  return JSON.stringify({ muDeg: +(Math.asin(mu) * 180 / Math.PI).toFixed(2), G: +G.toFixed(4), globePeak: +peak.toFixed(3), globeN: gn,
    C: +(C.mean / G).toFixed(3), B: +(Bb.mean / G).toFixed(3), A: +(Ar.mean / G).toFixed(3), ringPx: [C.n, Bb.n, Ar.n] });
};
