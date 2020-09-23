package utfc

// All characters below this code point are considered Latin, so within this range the state of `offs` stays equal to 0
const maxLatinCp = 0x02FF

// All characters starting from this code encoded in long (21-bit) mode
const min21BitCp = 0x2800

// Offs always includes top 6 bits of the codepoint (it identifies the currently selected "alphabet")
const offsMask13Bit = 0xFFFFFF80 // Characters encoded using their lowest 7 bits
const offsMask21Bit = 0xFFFF8000 // Characters encoded using their lowest 15 bits

const markerAux = 0b11000000   // => 1 byte encoding, auxiliary alphabet
const marker13Bit = 0b10000000 // => 2 byte encoding
const marker21Bit = 0b10100000 // => 3 byte encoding
const markerExtra = 0b10110000 // => 2 byte encoding, extra ranges

const offsInitAux = 0x00C0

// The subrange of the previous (auxiliary) alphabet is coded via 0b11000000.
// Unfortunately, a lot of alphabets are not aligned to 64-byte chunks in a good way,
// so we select different portions here to cover most frequently used characters.
var auxOffset = map[int]int{
	// 0x0000, Latin is a special case, it merges A-Z, a-z, 0-9, "-" and " " characters.
	0x0080: offsInitAux, // Latin-1 Supplement
	0x0380: 0x0391,      // Greek
	0x0400: 0x0410,      // Cyrillic
	0x0580: 0x05BE,      // Hebrew
	0x0530: 0x0531,      // Armenian
	0x0600: 0x060B,      // Arabic
	0x0900: 0x090D,      // Devangari
	0x0980: 0x098F,      // Bengali
	0x0A00: 0x0A02,      // Gurmukhi
	0x0A80: 0x0A8F,      // Gujarati
	0x0B00: 0x0B0F,      // Oriya
	0x0B80: 0x0B8E,      // Tamil
	0x0C80: 0x0C8E,      // Kannada
	0x0D00: 0x0D0E,      // Malayalam
	0x0D80: 0x0D9B,      // Sinhala
	0x0E00: 0x0E01,      // Thai
	0x0E80: 0x0E81,      // Lao
	0x0F00: 0x0F40,      // Tibetan
	0x0F80: 0x0F90,      // Tibetan
	0x1080: 0x10B0,      // Georgian
	0x3000: 0x3040,      // Hiragana
}

// Hiragana and Katakana
var rangeHK = []int{0x3000, 0x3100}

var rangesLatin = [][]int{
	{0x41, 0x5B}, {0x61, 0x7B}, {0x30, 0x3A},
	{0x20, 0x21}, {0x2D, 0x2C},
}
var rangesExtra = [][]int{
	{0x2000, 0x2800}, rangeHK, {0xFE00, 0xFE10},
	{0x1F170, 0x1F200}, {0x1F300, 0x1F700}, {0x1F900, 0x1FA00},
}

func inRanges(cp int, ranges [][]int) bool {
	for _, rng := range ranges {
		if rng[0] <= cp && cp < rng[1] {
			return true
		}
	}
	return false
}

func encodeRanges(cp int, ranges [][]int) int {
	v := 0
	for _, rng := range ranges {
		if rng[0] <= cp && cp < rng[1] {
			return v + (cp - rng[0])
		}
		v += rng[1] - rng[0]
	}
	return -1
}

func decodeRanges(v int, ranges [][]int) int {
	for _, rng := range ranges {
		if v < rng[1]-rng[0] {
			return rng[0] + v
		}
		v -= rng[1] - rng[0]
	}
	return -1
}

func getAuxOffset(offs int) int {
	if remappedOffs, ok := auxOffset[offs]; ok {
		return remappedOffs
	}
	return offs
}

// Encode converts string to an UTF-C byte array
func Encode(str string) []byte {
	// `offs`, `auxOffs` and `is21Bit` describe the current state.
	// `offs` is the start of the currently active window of Unicode codepoints.
	// `auxOffs` allows encoding 64 codepoints of the auxiliary alphabet.
	// `is21Bit` is true if we're in 21-bit mode (2-3 bytes per character).
	offs := 0
	auxOffs := offsInitAux
	is21Bit := false
	buf := []byte{}
	for _, ch := range str {
		cp := int(ch)
		// First, check if we can use 1-byte encoding via small 6-bit auxiliary alphabet
		if auxOffs == 0 && inRanges(cp, rangesLatin) {
			// 1 byte: auxiliary alphabet is Latin, rearrange it to fit 0xC0-0xFF range
			buf = append(buf, byte(markerAux|encodeRanges(cp, rangesLatin)))
		} else if auxOffs != 0 && cp >= auxOffs && cp <= auxOffs+0x3F {
			// 1 byte: code point is within the auxiliary alphabet (non-Latin)
			buf = append(buf, byte(markerAux|(cp-auxOffs)))
		} else
		// Second, there're 6 extra ranges (Hiragana, Katakana, and Emojis) that normally would require 3 bytes/character,
		// but are encoded with 2 (using range of codepoints 0x10FFFF-0x1FFFFF, which are not covered by Unicode)
		if inRanges(cp, rangesExtra) {
			newOffs := cp & offsMask13Bit
			if !is21Bit && newOffs == offs { // 1 byte: code point is within the current alphabet
				buf = append(buf, byte(cp&0x7F))
			} else {
				// Reindex 6 ranges into a single contiguous one
				extra := encodeRanges(cp, rangesExtra)
				buf = append(buf, byte(markerExtra|(1+extra>>8)), byte(extra))
				if cp >= rangeHK[0] && cp < rangeHK[1] { // Only Hiragana and Katakana change the current alphabet
					auxOffs = getAuxOffset(offs)
					offs = newOffs
					is21Bit = false
				}
			}
		} else
		// Lastly, check codepoint size to determine if it needs short (13-bit) or long (21-bit) mode
		if cp >= min21BitCp {
			// This code point requires 21 bit to encode
			// Characters up to 0x2800 can be encoded in shorter forms, so we start from 0
			cp -= min21BitCp
			newOffs := cp & offsMask21Bit
			if is21Bit && newOffs == offs { // 2 bytes: code point is within the current alphabet
				buf = append(buf, byte((cp>>8)&0x7F), byte(cp))
			} else { // 3 bytes: we need to switch to the new alphabet
				buf = append(buf, byte(marker21Bit|(cp>>16)), byte(cp>>8), byte(cp))
				auxOffs = offs
				offs = newOffs
				is21Bit = true
			}
		} else { // This code point requires max 13 bits to encode
			newOffs := cp & offsMask13Bit
			if !is21Bit && newOffs == offs { // 1 byte: code point is within the current alphabet
				buf = append(buf, byte(cp&0x7F))
			} else { // Final case: we need 2 bytes for this character
				buf = append(buf, byte(marker13Bit|(cp>>8)), byte(cp&0xFF))
				auxOffs = getAuxOffset(offs)
				if cp <= maxLatinCp {
					offs = 0
				} else {
					offs = newOffs
				}
				is21Bit = false
			}
		}
	}
	return buf
}

// Decode converts UTF-C byte array to a string
func Decode(buf []byte) string {
	offs := 0
	auxOffs := offsInitAux
	is21Bit := false
	str := ""
	i := 0
	for i < len(buf) {
		cp := int(buf[i])
		i++
		if (cp & markerAux) == markerAux {
			if auxOffs == 0 {
				cp = decodeRanges(cp^markerAux, rangesLatin)
			} else {
				cp = auxOffs + (cp ^ markerAux)
			}
		} else if (cp & markerExtra) == markerExtra {
			cp = decodeRanges((cp^markerExtra)<<8|int(buf[i]), rangesExtra)
			i++
			if cp >= rangeHK[0] && cp < rangeHK[1] {
				auxOffs = getAuxOffset(offs)
				offs = cp & offsMask13Bit
				is21Bit = false
			}
		} else if (cp & marker21Bit) == marker21Bit {
			cp = ((cp^marker21Bit)<<16 | int(buf[i])<<8 | int(buf[i+1]))
			i += 2
			auxOffs = offs
			offs = cp & offsMask21Bit
			is21Bit = true
			cp += min21BitCp
		} else if (cp & marker13Bit) == marker13Bit {
			cp = (cp^marker13Bit)<<8 | int(buf[i])
			i++
			auxOffs = getAuxOffset(offs)
			if cp <= maxLatinCp {
				offs = 0
			} else {
				offs = cp & offsMask13Bit
			}
			is21Bit = false
		} else if is21Bit {
			cp = min21BitCp + (offs | cp<<8 | int(buf[i]))
			i++
		} else {
			cp = offs | cp
		}
		str += string(rune(cp))
	}
	return str
}
