// MD5 纯函数实现。
// 为什么不用 Web Crypto：crypto.subtle.digest('MD5', ...) 会抛 "Unrecognized algorithm name" —— Web Crypto 只支持 SHA 系列。
// 而 flomo 网页版签名强制要求 MD5，因此只能自带实现。
// 纯函数：无平台依赖，Node 可直接单测（用 crypto.createHash('md5') 交叉验证）。
// 参考 RFC 1321，输入按 UTF-8 字节处理（中文需多字节编码，不能按 JS charCode 处理）。

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
}

function toUtf8Bytes(str) {
  // 优先用 TextEncoder（浏览器与 Node 均有）；不可用时回退手写实现
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(str));
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else {
      // 代理对：合并为单个码点
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(i) & 0x3ff));
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// ⚠️ MD5 输出按**小端字节序**拼接（RFC 1321）：状态字 0x67452301 输出为 "01234567"，
// 不能直接用 toString(16)（那是大端，会让结果每 4 字节反转）。
function toHex(n) {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return s;
}

/** 计算字符串的 MD5（32 位小写十六进制） */
export function md5(input) {
  const bytes = toUtf8Bytes(input);

  // 补位：0x80 + 若干个 0，使长度 ≡ 56 (mod 64)，再追加 8 字节原始位长（小端）
  const bitLen = bytes.length * 8;
  const padLen = (56 - ((bytes.length + 1) % 64) + 64) % 64;
  const total = bytes.length + 1 + padLen + 8;
  const buf = new Uint8Array(total);
  buf.set(bytes, 0);
  buf[bytes.length] = 0x80;
  // 用两个 32 位写入 64 位长度（避免 BigInt，兼容性与性能更好）
  const lo = bitLen >>> 0;
  const hi = Math.floor(bitLen / 4294967296) >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, lo, true);
  dv.setUint32(total - 4, hi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < total; off += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = F >>> 0;
      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + K[i] + M[g]) >>> 0;
      B = (B + rotl(sum, S[i])) >>> 0;
      A = tmp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

/** 便捷：计算字节数组的 MD5（用于非文本场景） */
export function md5Bytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return md5(unescape(encodeURIComponent(s)));
}
