// Shared, deterministic reference/query extraction. No network, OCR, or image storage.
// JSON shape: {version:1,width,height,count,coarse:number[768],
//   keypoints:number[count*2], descriptors:string (base64 count*32 ORB bytes)}.
// Coordinates are integer pixels in the aspect-preserving, maxEdge-sized image.
// coarse is a 16x16 RGB thumbnail for retrieval/fallback ranking; it is never displayed.
export const FEATURE_VERSION = 1;
export const COARSE_EDGE = 16;

export function bytesToBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function extractFeatures(cv, input, {maxFeatures = 400, maxEdge = 720} = {}) {
  if (!input?.width || !input?.height) throw new Error('Feature input must be a nonempty canvas.');
  const scale = Math.min(1, maxEdge / Math.max(input.width, input.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(input.width * scale));
  canvas.height = Math.max(1, Math.round(input.height * scale));
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
  const thumb = document.createElement('canvas');
  thumb.width = thumb.height = COARSE_EDGE;
  const thumbCtx = thumb.getContext('2d', {willReadFrequently: true});
  thumbCtx.drawImage(canvas, 0, 0, COARSE_EDGE, COARSE_EDGE);
  const rgba = thumbCtx.getImageData(0, 0, COARSE_EDGE, COARSE_EDGE).data;
  const coarse = [];
  for (let i = 0; i < rgba.length; i += 4) coarse.push(rgba[i], rgba[i + 1], rgba[i + 2]);
  const owned = [];
  const own = value => {owned.push(value); return value;};
  try {
    const source = own(cv.imread(canvas)), gray = own(new cv.Mat());
    const mask = own(new cv.Mat()), descriptors = own(new cv.Mat());
    const points = own(new cv.KeyPointVector());
    // Explicit parameters keep reference and query descriptors compatible.
    const orb = own(new cv.ORB(maxFeatures, 1.2, 8, 20, 0, 2, 0, 31, 12));
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    orb.detectAndCompute(gray, mask, points, descriptors);
    const count = descriptors.rows, keypoints = [];
    for (let i = 0; i < count; i++) {
      const point = points.get(i);
      keypoints.push(Math.round(point.pt.x), Math.round(point.pt.y));
      point.delete?.();
    }
    return {version: FEATURE_VERSION, width: canvas.width, height: canvas.height,
      count, coarse, keypoints, descriptors: bytesToBase64(descriptors.data)};
  } finally {
    for (let i = owned.length - 1; i >= 0; i--) owned[i].delete();
    canvas.width = canvas.height = thumb.width = thumb.height = 0;
  }
}
