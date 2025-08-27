// src/services/hashTiny.js
export function md5(str) {
  let h = 0, i, chr;
  for (i = 0; i < str.length; i++) { chr = str.charCodeAt(i); h = ((h << 5) - h) + chr; h |= 0; }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
