(() => {
// All characters below this code point are considered Latin, so within this range the state of `offs` stays equal to 0
const MAX_LATIN_CP = 0x02FF;

// All characters starting from this code encoded in long (21-bit) mode
const MIN_21BIT_CP = 0x2800;

// Offs always includes top 6 bits of the codepoint (it identifies the currently selected "alphabet")
const OFFS_MASK_13BIT = 0xFFFFFF80; // Characters encoded using their lowest 7 bits
const OFFS_MASK_21BIT = 0xFFFF8000; // Characters encoded using their lowest 15 bits

const MARKER_AUX   = 0b11000000; // => 1 byte encoding, auxiliary alphabet
const MARKER_13BIT = 0b10000000; // => 2 byte encoding
const MARKER_21BIT = 0b10100000; // => 3 byte encoding
const MARKER_EXTRA = 0b10110000; // => 2 byte encoding, extra ranges

const OFFS_INIT_AUX = 0x00C0;

// The subrange of the previous (auxiliary) alphabet is coded via 0b11000000.
// Unfortunately, a lot of alphabets are not aligned to 64-byte chunks in a good way,
// so we select different portions here to cover most frequently used characters.
const AUX_OFFSETS = {
  // 0x0000, Latin is a special case, it merges A-Z, a-z, 0-9, "-" and " " characters.
  0x0080: OFFS_INIT_AUX, // Latin-1 Supplement
  0x0380: 0x0391, // Greek
  0x0400: 0x0410, // Cyrillic
  0x0580: 0x05BE, // Hebrew
  0x0530: 0x0531, // Armenian
  0x0600: 0x060B, // Arabic
  0x0900: 0x090D, // Devangari
  0x0980: 0x098F, // Bengali
  0x0A00: 0x0A02, // Gurmukhi
  0x0A80: 0x0A8F, // Gujarati
  0x0B00: 0x0B0F, // Oriya
  0x0B80: 0x0B8E, // Tamil
  0x0C80: 0x0C8E, // Kannada
  0x0D00: 0x0D0E, // Malayalam
  0x0D80: 0x0D9B, // Sinhala
  0x0E00: 0x0E01, // Thai
  0x0E80: 0x0E81, // Lao
  0x0F00: 0x0F40, // Tibetan
  0x0F80: 0x0F90, // Tibetan
  0x1080: 0x10B0, // Georgian
  0x3000: 0x3040, // Hiragana
};

const RANGES_LATIN = [[0x41, 0x5B], [0x61, 0x7B], [0x30, 0x3A], [0x20, 0x21], [0x2D, 0x2C]];
const RANGE_HK = [0x3000, 0x3100]; // Hiragana and Katakana
const RANGES_EXTRA = [[0x2000, 0x2800], RANGE_HK, [0xFE00, 0xFE10], [0x1F170, 0x1F200], [0x1F300, 0x1F700], [0x1F900, 0x1FA00]];

const inRanges = (cp, ranges) => {
  for (let rng of ranges) {
    if (rng[0] <= cp && cp < rng[1]) {
      return true;
    }
  }
}

const encodeRanges = (cp, ranges) => {
  let v = 0;
  for (let rng of ranges) {
    if (rng[0] <= cp && cp < rng[1]) {
      return v + (cp - rng[0]);
    } else {
      v += rng[1] - rng[0];
    }
  }
}

const decodeRanges = (v, ranges) => {
  let cp = 0;
  for (let rng of ranges) {
    if (v < rng[1] - rng[0]) {
      return rng[0] + v;
    } else {
      v -= rng[1] - rng[0];
    }
  }
}

const UTFC = {
  // Encodes String to an UTF-C Uint8Array in browser/Buffer in Node (similarly to TextEncoder.prototype.encode)
  encode(str) {
    // `offs`, `auxOffs` and `is21Bit` describe the current state.
    // `offs` is the start of the currently active window of Unicode codepoints.
    // `auxOffs` allows encoding 64 codepoints of the auxiliary alphabet. 
    // `is21Bit` is true if we're in 21-bit mode (2-3 bytes per character).
    let offs = 0, auxOffs = OFFS_INIT_AUX, is21Bit = false;
    const buf = [];
    for (let ch of str) {
      let cp = ch.codePointAt(0);
      // First, check if we can use 1-byte encoding via small 6-bit auxiliary alphabet
      if (auxOffs === 0 && inRanges(cp, RANGES_LATIN)) {
        // 1 byte: auxiliary alphabet is Latin, rearrange it to fit 0xC0-0xFF range
        buf.push(MARKER_AUX | encodeRanges(cp, RANGES_LATIN));
      } else
      if (auxOffs !== 0 && cp >= auxOffs && cp <= auxOffs + 0x3F) {
        // 1 byte: code point is within the auxiliary alphabet (non-Latin)
        buf.push(MARKER_AUX | (cp - auxOffs));
      } else
      // Second, there're 6 extra ranges (Hiragana, Katakana, and Emojis) that normally would require 3 bytes/character,
      // but are encoded with 2 (using range of codepoints 0x10FFFF-0x1FFFFF, which are not covered by Unicode)
      if (inRanges(cp, RANGES_EXTRA)) {
        const newOffs = cp & OFFS_MASK_13BIT;
        if (!is21Bit && newOffs === offs) { // 1 byte: code point is within the current alphabet
          buf.push(cp & 0x7F);
        } else {
          // Reindex 6 ranges into a single contiguous one
          const extra = encodeRanges(cp, RANGES_EXTRA);
          buf.push(MARKER_EXTRA | (1 + extra >> 8), extra & 0xFF);
          if (cp >= RANGE_HK[0] && cp < RANGE_HK[1]) { // Only Hiragana and Katakana change the current alphabet
            auxOffs = offs in AUX_OFFSETS ? AUX_OFFSETS[offs] : offs, offs = newOffs, is21Bit = false;
          }
        }
      } else
      // Lastly, check codepoint size to determine if it needs short (13-bit) or long (21-bit) mode
      if (cp >= MIN_21BIT_CP) {
        // This code point requires 21 bit to encode
        // Characters up to 0x2800 can be encoded in shorter forms, so we start from 0
        cp -= MIN_21BIT_CP;
        const newOffs = cp & OFFS_MASK_21BIT;
        if (is21Bit && newOffs === offs) { // 2 bytes: code point is within the current alphabet
          buf.push((cp >> 8) & 0x7F, cp & 0xFF);
        } else { // 3 bytes: we need to switch to the new alphabet
          buf.push(MARKER_21BIT | (cp >> 16), cp >> 8, cp & 0xFF);
          auxOffs = offs, offs = newOffs, is21Bit = true;
        }
      } else { // This code point requires max 13 bits to encode
        const newOffs = cp & OFFS_MASK_13BIT;
        if (!is21Bit && newOffs === offs) { // 1 byte: code point is within the current alphabet
          buf.push(cp & 0x7F);
        } else { // Final case: we need 2 bytes for this character
          buf.push(MARKER_13BIT | (cp >> 8), cp & 0xFF);
          if (cp <= MAX_LATIN_CP) { // For extended Latin we keep alphabet equal to 0
            offs = 0;
          } else { // Otherwise, change the current alphabet, and store the previous one as auxiliary
            auxOffs = offs in AUX_OFFSETS ? AUX_OFFSETS[offs] : offs, offs = newOffs;
          }
          is21Bit = false;
        }
      }
    }
    return (typeof Uint8Array === 'undefined' ? Buffer : Uint8Array).from(buf);
  },

  // Decodes String from an UTF-C Uint8Array/Buffer (similarly to TextEncoder.prototype.decode)
  decode(buf) {
    let offs = 0, auxOffs = OFFS_INIT_AUX, is21Bit = false;
    let str = [];
    for (let i = 0; i < buf.length; i++) {
      let cp = buf[i];
      if ((cp & MARKER_AUX) === MARKER_AUX) {
        cp = auxOffs === 0 ? decodeRanges(cp & ~MARKER_AUX, RANGES_LATIN) : (auxOffs + (cp & ~MARKER_AUX));
      } else
      if ((cp & MARKER_EXTRA) === MARKER_EXTRA) {
        cp = decodeRanges((cp & ~MARKER_EXTRA) << 8 | buf[++i], RANGES_EXTRA);
        if (cp >= RANGE_HK[0] && cp < RANGE_HK[1]) {
          auxOffs = offs in AUX_OFFSETS ? AUX_OFFSETS[offs] : offs, offs = cp & OFFS_MASK_13BIT, is21Bit = false;
        }
      } else
      if ((cp & MARKER_21BIT) === MARKER_21BIT) {
        cp = ((cp & ~MARKER_21BIT) << 16 | buf[++i] << 8 | buf[++i]);
        auxOffs = offs, offs = cp & OFFS_MASK_21BIT, is21Bit = true;
        cp += MIN_21BIT_CP;
      } else
      if ((cp & MARKER_13BIT) === MARKER_13BIT) {
        cp = (cp & ~MARKER_13BIT) << 8 | buf[++i];
        if (cp <= MAX_LATIN_CP) {
          offs = 0;
        } else {
          auxOffs = offs in AUX_OFFSETS ? AUX_OFFSETS[offs] : offs, offs = cp & OFFS_MASK_13BIT;
        }
        is21Bit = false;
      } else
      if (is21Bit) {
        cp = MIN_21BIT_CP + (offs | cp << 8 | buf[++i]);
      } else {
        cp = offs | cp;
      }
      str.push(cp);
    }
    return String.fromCodePoint(...str);
  },
}

if (typeof window !== 'undefined') {
  window.UTFC = UTFC;
} else {
  module.exports = UTFC;
}
})();