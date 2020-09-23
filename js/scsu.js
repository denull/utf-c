// Ported from https://www.unicode.org/Public/PROGRAMS/SCSUMini/scsumini.c

(() => {
const SCSU = {
  SQ0: 0x01,
  SQU: 0x0E,
  SCU: 0x0F,
  SC0: 0x10,
  UC0: 0xE0,
  UQU: 0xF0,

  offsets: [
    /* initial offsets for the 8 dynamic (sliding) windows */
    0x0080, /* Latin-1 */
    0x00C0, /* Latin Extended A */
    0x0400, /* Cyrillic */
    0x0600, /* Arabic */
    0x0900, /* Devanagari */
    0x3040, /* Hiragana */
    0x30A0, /* Katakana */
    0xFF00, /* Fullwidth ASCII */

    /* offsets for the 8 static windows */
    0x0000, /* ASCII for quoted tags */
    0x0080, /* Latin - 1 Supplement (for access to punctuation) */
    0x0100, /* Latin Extended-A */
    0x0300, /* Combining Diacritical Marks */
    0x2000, /* General Punctuation */
    0x2080, /* Currency Symbols */
    0x2100, /* Letterlike Symbols and Number Forms */
    0x3000, /* CJK Symbols and punctuation */
  ],

  isInWindow: function(offset, c) {
    return offset <= c && c <= offset + 0x7F;
  },

  getWindow: function(c) {
    for (let i = 0; i < 16; i++) {
      if (SCSU.isInWindow(SCSU.offsets[i], c)) {
        return i;
      }
    }
    return -1;
  },

  encode: function(input) {
    const buf = [];
    let isUnicodeMode = false;
    let wnd = 0;
    let w;
    function encode(cp) {
      if (cp > 0xFFFF) {
        encode(0xD7C0 + (cp >> 10));
        encode(0xDC00 + (cp & 0x03FF));
        return;
      }
      if (!isUnicodeMode) {
        if (cp < 0x20) {
          /*
           * Encode C0 control code:
           * Check the code point against the bit mask 0010 0110 0000 0001
           * which contains 1-bits at the bit positions corresponding to
           * code points 0D 0A 09 00 (CR LF TAB NUL)
           * which are encoded directly.
           * All other C0 control codes are quoted with SQ0.
           */
          if (cp <= 0x0F && ((1 << cp) & 0x2601 === 0)) {
            buf.push(SCSU.SQ0);
          }
          buf.push(cp);
        } else if (cp < 0x7F) {
          /* encode US-ASCII directly */
          buf.push(cp);
        } else if (SCSU.isInWindow(SCSU.offsets[wnd], cp)) {
          /* use the current dynamic window */
          buf.push(0x80 + (cp - SCSU.offsets[wnd]));
        } else if ((w = SCSU.getWindow(cp)) >= 0) {
          if (w <= 7) {
            /* switch to a dynamic window */
            buf.push(SCSU.SC0 + w);
            buf.push(0x80 + (cp - SCSU.offsets[w]));
            wnd = w;
          } else {
            /* quote from a static window */
            buf.push(SCSU.SQ0 + (w - 8));
            buf.push(cp - SCSU.offsets[w]);
          }
        } else if (cp === 0xFEFF) {
          /* encode the signature character U+FEFF with SQU */
          buf.push(SCSU.SQU);
          buf.push(0xFE);
          buf.push(0xFF);
        } else {
          /* switch to Unicode mode */
          buf.push(SCSU.SCU);
          isUnicodeMode = true;
          encode(cp);
        }
      } else {
        /* Unicode mode */
        if (cp <= 0x7F) {
          /* US-ASCII: switch to single-byte mode with the previous dynamic window */
          isUnicodeMode = false;
          buf.push(SCSU.UC0 + wnd);
          encode(cp);
        } else if ((w = SCSU.getWindow(cp)) >= 0 && w <= 7) {
          buf.push(SCSU.UC0 + w);
          wnd = w;
          isUnicodeMode = false;
          encode(cp);
        } else {
          if (0xE000 <= cp && cp <= 0xF2FF) {
            buf.push(SCSU.UQU);
          }
          buf.push(cp >> 8);
          buf.push(cp);
        }
      }
    }
    for (let i = 0, cp; cp = input.codePointAt(i), cp !== undefined; i++) {
      encode(cp);
    }
    return Uint8Array.from(buf);
  }
}

if (typeof window !== 'undefined') {
  window.SCSU = SCSU;
} else {
  module.exports = SCSU;
}
})();