// 거리 재기의 최소·최대 거리 계산을 화면 밖에서 돌린다(위성끼리는 수 초 걸린다). 받는 것 { id, a, b, jd0, jd1 }
import { distanceExtremes } from './extremes.js';

self.onmessage = ({ data: { id, a, b, jd0, jd1 } }) => {
  try { self.postMessage({ id, result: distanceExtremes(a, b, jd0, jd1) }); }
  catch (e) { self.postMessage({ id, error: String(e?.message ?? e) }); }
};
