
const UTFC = {
  // Maximum codepoint that can be encoded in short (13-bit) mode
  MAX_13BIT_CP: 0x1FFF,

  // All characters below this code point are considered Latin,
  // so within this range the state of `offs` stays equal to 0
  MAX_LATIN_CP: 0x02FF,

  // Offs always includes top 6 bits of the codepoint (it identifies the currently selected "alphabet")
  OFFS_MASK_13BIT: 0xFFFFFF80, // Characters encoded using their lowest 7 bits
  OFFS_MASK_21BIT: 0xFFFF8000, // Characters encoded using their lowest 15 bits

  // Special 1-byte range: 0xC0-0xFF (64 values)
  //   if current offs=0: a corresponding part of CP1252/ISO-8859-1/Latin-1 Supplement
  //   otherwise: a portion of previously selected alphabet
  MARKER_AUX:   0b11000000, // => 1 byte encoding, auxiliary alphabet
  MARKER_13BIT: 0b10000000, // => 2 byte encoding
  MARKER_21BIT: 0b10100000, // => 3 byte encoding
  MARKER_EXTRA: 0b10110000, // => 2 byte encoding, extra ranges

  // The subrange of the previous (auxiliary) alphabet is coded via 0b11000000.
  // Unfortunately, a lot of alphabets are not aligned to 64-byte chunks in a good way,
  // so we select different portions here to cover most frequently used characters.
  AUX_OFFSETS: {
    // 0x0000, Latin is a special case, it merges A-Z, a-z, 0-9, "-" and " " characters.
    0x0080: 0x00E0, // Latin-1 Supplement
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
    0x0F00: 0x0F40, // Tibetan (also remap 0x0F0B-0x0F0D to 0x0F6D-0x0F6F?)
    0x0F80: 0x0F90, // Tibetan
    0x1080: 0x10B0, // Georgian
    0x3000: 0x3040, // Hiragana
  },

  debug: function(buf, msg, ...args) {
    console.log(msg, buf.map(b => b.toString(2).padStart(8, '0')), ...args);
  },

  // Encodes String to an UTF-C Uint8Array (similarly to TextEncoder.prototype.encode)
  encode: function(input, stateless) {
    const buf = [];

    // `offs`, `auxOffs` and `is21Bit` describe the current state.
    // `offs` is the start of the currently active window of Unicode codepoints.
    // `auxOffs` allows encoding 64 codepoints of the auxiliary alphabet. 
    // `is21Bit` is true if we're in 21-bit mode (2-3 bytes per character).
    let offs = 0, auxOffs = 0x00C0, is21Bit = false;
    for (let ch of input) {
      let cp = ch.codePointAt(0);
      const len = buf.length;
      // First, check if we can use 1-byte encoding via small 6-bit auxiliary alphabet
      if (auxOffs === 0 && (cp === 0x20 || cp === 0x2D || (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A) || (cp >= 0x30 && cp <= 0x39))) {
        // Auxiliary alphabet is Latin, rearrange it to fit 0xC0-0xFF range
        if (cp >= 0x41 && cp <= 0x5A) {
          buf.push(0xC0 + (cp - 0x41));
        } else
        if (cp >= 0x61 && cp <= 0x7A) {
          buf.push(0xDA + (cp - 0x61));
        } else
        if (cp >= 0x30 && cp <= 0x39) {
          buf.push(0xF4 + (cp - 0x30));
        } else {
          buf.push(cp == 0x2D ? 0xFE : 0xFF);
        }
        this.debug(buf.slice(len), 'AUX Latin');
      } else
      if (cp >= auxOffs && cp <= auxOffs + 0x3F) {
        // Code point is within the auxiliary alphabet, can still be encoded with 1 byte
        buf.push(0xC0 + (cp - auxOffs));
        this.debug(buf.slice(len), 'AUX');
      } else
      // Second, there're 5 extra ranges that normally would require 3 bytes/character,
      // but are encoded with 2 (using range of codepoints 0x10FFFF-0x1FFFFF, which are not covered by Unicode)
      if ((cp >= 0x2000 && cp < 0x2800) || (cp >= 0x3000 && cp < 0x3100) || (cp >= 0xFE00 && cp < 0xFE10) || 
          (cp >= 0x1F300 && cp < 0x1F700) || (cp >= 0x1F900 && cp < 0x1FA00)) {
        const newOffs = cp & UTFC.OFFS_MASK_13BIT;
        if (!is21Bit && newOffs === offs) {
          // Current offset is still valid, encode only the rightmost 7 bits of the codepoint
          buf.push(cp & 0x7F);
          this.debug(buf.slice(len), 'EXTRA');
        } else {
          // Reindex 5 ranges into a single contigious one
          const extra = cp < 0x2800 ? cp - 0x2000 : (cp < 0x3100 ? cp - 0x3000 + 0x800 : 
            (cp < 0xFE10 ? cp - 0xFE00 + 0x900 : (cp < 0x1F700 ? cp - 0x1F300 + 0x910 : cp - 0x1F900 + 0xD10)));
          buf.push(UTFC.MARKER_EXTRA | (1 + extra >> 8), cp & 0xFF);
          auxOffs = offs in UTFC.AUX_OFFSETS ? UTFC.AUX_OFFSETS[offs] : offs;
          offs = newOffs, is21Bit = false;
          this.debug(buf.slice(len), 'EXTRA Shift', newOffs.toString(16));
        }
      } else
      // Lastly, check codepoint size to determine if it needs short (13-bit) or long (21-bit) mode
      if (cp > UTFC.MAX_13BIT_CP) {
        // This code point requires 21 bit to encode
        // Characters up to 0x2800 can be encoded in shorter forms, so we start from 0
        cp -= 0x2800;
        const newOffs = cp & UTFC.OFFS_MASK_21BIT;
        if (is21Bit && newOffs === offs) {
          // Current offset is still valid, encode only the rightmost 15 bits of the codepoint
          buf.push((cp >> 8) & 0x7F, cp & 0xFF);
          this.debug(buf.slice(len), '21b');
        } else {
          // We need to store the new offset, this character will cost 3 bytes
          buf.push(UTFC.MARKER_21BIT | (cp >> 16), cp >> 8, cp & 0xFF);
          auxOffs = offs, offs = newOffs, is21Bit = true;
          this.debug(buf.slice(len), '21b Shift', newOffs.toString(16));
        }
      } else {
        // This code point requires max 13 bits to encode
        const newOffs = cp & UTFC.OFFS_MASK_13BIT;
        if (!is21Bit && newOffs === offs) {
          // Current offset is still valid, encode only the rightmost 7 bits of the codepoint
          buf.push(cp & 0x7F);
          this.debug(buf.slice(len), '13b');
        } else {
          // Final case: we need 2 bytes for this character
          buf.push(UTFC.MARKER_13BIT | (cp >> 8), cp & 0xFF);
          if (cp <= UTFC.MAX_LATIN_CP) {
            // For extended Latin we keep alphabet equal to 0
            offs = 0;
            this.debug(buf.slice(len), '13b No Shift', newOffs.toString(16));
          } else {
            // Otherwise, change the current alphabet, and store the previous one as auxiliary
            auxOffs = offs in UTFC.AUX_OFFSETS ? UTFC.AUX_OFFSETS[offs] : offs;
            offs = newOffs;
            this.debug(buf.slice(len), '13b Shift', newOffs.toString(16));
          }
          is21Bit = false;
        }
      }
    }
    return Uint8Array.from(buf);
  },
  // Decodes String from an UTF-C Uint8Array (similarly to TextEncoder.prototype.decode)
  decode: function(input) {

  },
}
