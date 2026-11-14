/**
 * TIFF-flavoured LZW decoder (compression tag 259 = 5): MSB-first codes, 9-12 bits,
 * ClearCode 256, EOI 257, "early change" code-width bump.
 *
 * Each dictionary entry is stored as (offset, length) into the output buffer: an entry is
 * always the previous code's output plus one byte, which already sits in the output.
 */
export function lzwDecode(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  const entStart = new Int32Array(4096);
  const entLen = new Int32Array(4096);
  let nextCode = 258;
  let codeLen = 9;
  let bitBuf = 0;
  let bitCnt = 0;
  let si = 0;
  let pos = 0;
  let lastPos = -1;
  let lastLen = 0;

  const read = (): number => {
    while (bitCnt < codeLen) {
      bitBuf = ((bitBuf << 8) | (si < src.length ? src[si++]! : 0)) >>> 0;
      bitCnt += 8;
      if (si > src.length + 2) return 257;
    }
    const code = (bitBuf >>> (bitCnt - codeLen)) & ((1 << codeLen) - 1);
    bitCnt -= codeLen;
    bitBuf &= (1 << bitCnt) - 1;
    return code;
  };

  while (pos < outLen) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      nextCode = 258;
      codeLen = 9;
      lastPos = -1;
      continue;
    }
    const curPos = pos;
    let curLen: number;
    if (code < 256) {
      out[pos++] = code;
      curLen = 1;
    } else if (code < nextCode) {
      const s = entStart[code]!;
      curLen = entLen[code]!;
      const n = Math.min(curLen, outLen - pos);
      out.copyWithin(pos, s, s + n);
      pos += n;
    } else {
      // KwKwK: previous string + its own first byte (forward byte copy handles the overlap)
      if (lastPos < 0) throw new Error("LZW: bad code sequence");
      curLen = lastLen + 1;
      const n = Math.min(curLen, outLen - pos);
      for (let i = 0; i < n; i++) out[pos + i] = out[lastPos + i]!;
      pos += n;
    }
    if (lastPos >= 0 && nextCode < 4096) {
      entStart[nextCode] = lastPos;
      entLen[nextCode] = lastLen + 1;
      nextCode++;
      if (nextCode >= (1 << codeLen) - 1 && codeLen < 12) codeLen++;
    }
    lastPos = curPos;
    lastLen = curLen;
  }
  return out;
}
