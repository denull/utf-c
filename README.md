## UTF-C

This repository contains two implementations (in JavaScript and in Go) of a custom Unicode encoding scheme for storing strings in a compact way. It's mainly intended for storing a lot of short strings in memory. It's not a standard algorithm, and you should not use it in external APIs: it does not provide ASCII transparency (the produced output can contain 7-bit ASCII values that weren't present in the original string), so it can lead to a number of security vulnerabilities. It is, however, ASCII (and partly CP1252/ISO-8859-1) compatible: every ASCII string (and some CP1252 strings) is represented in the same way in UTF-C.

**UTF-C** (C stands for "compact") is similar to [https://en.wikipedia.org/wiki/Standard_Compression_Scheme_for_Unicode](SCSU) (Standard Compression Scheme for Unicode), but it's more lightweight and simple (for example, minified JS version is just 1.7 Kb that includes both encoder and decoder). It's implementation does not require any heuristics to achieve good performance. In comparision with a SCSU compressor of same complexity, it often delivers better results in terms of compressed strings size.

You can try it for yourself in this [https://denull.github.io/utf-c/](online demo).

# JavaScript Library

To use this encoding you can install `utf-c` library via **npm** or **yarn**:

```
npm install -s utf-c
```

In browser environment you can also link to it directly via **unpkg**:

```html
<script src="https://unpkg.com/utf-c@1/utf-c.min.js"></script>
```

This library provides two methods: `encode` for converting Strings to UTF-C byte arrays (`Uint8Array` in browsers, `Buffer` in Node), and `decode` for decoding it back. In browser enviroment those methods available on global `UTFC` object, in Node you need to import it first:

```js
const UTFC = require('utf-c');

console.log(UTFC.encode('Hello World!'));
```

# Go Package

Run `go get` to install this package as a dependency:

```go
go get github.com/deNULL/utf-c
```

Just like in JavaScript, this package provides `Encode` (which converts `string` to the corresponding `[]byte` buffer) and `Decode` functions:

```go
import (
  utfc "github.com/deNULL/utf-c"
)

func main() {
  buf := utfc.Encode("Hello World!")
  fmt.Println(buf)
}
```

It would probably make sense to implement `Encoder` and `Decoder` interfaces from the default `golang.org/x/text/encoding` package, but it's not yet done.

TBD: The code of this implementation can be optimised a bit to reduce number of memory allocations and operating on string content directly (without extracting decoded Unicode runes).

# Encoding details

UTF-8 is the most widely used way to represent Unicode strings. It is, however, not the most efficient one: it can use up to 4 bytes to represent a single codepoint, although the total number of codepoints is much less than a maximum 3-byte integer: 0x10FFFF. UTF-8 still tries not to be too wasteful by encoding most common characters in 1, 2 or 3 bytes. Unfortunately, most languages that use any characters outside of ASCII range, require at least 2 bytes per character.

UTF-C is developed for those rare cases where you need to store strings more compactly than that (and don't need any compatability that UTF-8 provides). For example, my own application of this algorithm is for a multilingual [https://en.wikipedia.org/wiki/Radix_tree](radix tree). If you're looking for storing long texts, a general-purpose compression algorithms (gzip/deflate, LZW/LZMA and so on) will be a better choice.

UTF-C is **stateful**. That means that encoder and decoder need to keep some state between decoding characters. This state consist of three variables: an offset `offs` to the base alphabet, a flag `is21Bit` defining the current mode (21-bit or 7/13-bit), and an offset `auxOffs` to the auxiliary alphabet. Base alphabet is basically a range of 128 codepoints in all Unicode space, and auxiliary alphabet is a range of 64 codepoints. By default the base alphabet is `0` (i.e. Latin), and auxiliary alphabet is `0xC0` (i.e. top part of Latin-1 Supplement, CP1252 and ISO-8859-1).

Similarly to UTF-8, UTF-C uses variable-length coding, identified by the first byte of the sequence. There're 5 coding variants, which have those bit masks:

* `0xxx xxxx`: a character from the base alphabet. Depending on the current state (`is21Bit` flag, to be more precise), this byte can be followed by the second one.
* `11xx xxxx`: a character from the auxiliary alphabet. Always a single byte.
* `100x xxxx  xyyy yyyy`: a "change alphabet and encode" command for 7/13-bit alphabets. Sets `auxOffs` to a predefined portion of previously active base alphabet (`offs`), sets `offs` to `xxxxx x0000000`, resets flag `is21Bit` to false, and encodes 7/13-bit character `xxxxx xyyyyyyy` in that alphabet.
* `101x xxxx  xyyy yyyy  yyyy yyyy`: a "change alphabet and encode" command for 21-bit alphabets. Similarly to 7/13-bit mode, sets `auxOffs` to previous subrange of `offs`, sets `offs` to `xxxxx x0000000 00000000`, sets flag `is21Bit` to true, and encodes 21-bit character `xxxxx xyyyyyyy yyyyyyyy` in that alphabet.
* `1011 xxxx  xxxx xxxx`: a character from "extra" ranges. Characters in those Unicode ranges would normally require 21 bit coding (3 bytes), but remapped here to be encoded in just 2. Those ranges include Japanase hieroglyphs and most of the emojis.

Note that base alphabet always stores top 6 bits of Unicode codepoints. After any alphabet change, `0xxx xxxx` byte values are simply added to these offset to determine the desired character.

When the base alphabet is changed, it's previous value is stored to auxiliary alphabet for quick access (via `11xx xxxx`). The auxiliary alphabet, however, is smaller: it contains only 64 values (6 bits). To prevent frequent alphabet changes, for some predefined alphabets the start of auxiliary alphabet is offseted from the start of the base one. For example, the base alphabet used for Cyrillic is `0x0400` (it's the start of the corresponding Unicode block). However, when alphabet is changed, this offset would become `0x0410` -- because the main portion of cyrillic letters starts at that point. When Latin alphabet becomes auxiliary, it's ASCII range not just offseted, but remapped, so it includes all "A"-"Z", "a"-"z" characters, digits, "-" (dash) and " " (space). For many languages it allows inserting latin characters without switching alphabets.

You may notice that prefixes of the last 2 coding variants -- `101x xxxx  xyyy yyyy  yyyy yyyy` and `1011 xxxx  xxxx xxxx` -- overlap with each other. That's because the former one allows encoding values up to `0x1FFFFF`, but Unicode extends only to `0x10FFFF`. So if the first byte is `1011 xxxx`, and `xxxx` is non-zero, there's no corresponding Unicode codepoint. UTF-C utilises this fact to reduce the number of space used by some characters that otherwise would require 3 byte coding. Those characters mostly include emojis (which tend to be very "wide" in terms of bytes used) and Hiragana/Katakana (frequently used in Japanese language).

If some implementation details still remain unclear, you can inspect the source code in [https://github.com/deNULL/utf-c/js/utf-c.js](JavaScript) or [https://github.com/deNULL/utf-c/go/utfc.go](Go) — it contains a lot of detailed comments.

# Possible variations and extensions

Stateful encoding is sometimes undesirable. For example, you may want to have any character or substring to be encoded in the same way, independently from context. It's pretty simple to achieve by removing any changes to the state (`offs`, `auxOffs` and `is21Bit` variables in code) both from encoder and decoder. After that every character will be fully encoded. This won't be as efficient as default implementation of UTF-C, but should still perform better than UTF-8 (and similar codepoints will still have similar encodings in terms of most significant bits).

In cases when most of strings to be compressed are known to be of certain language, it can be useful to change the default state (initial base and auxiliary alphabets). It can be especially useful in the stateless mode described above. This is similar to choosing a specific (non-Unicode) encoding, but it still allows representing all Unicode characters.

Although UTF-C is not intended for storing a large portions of texts (general purpose compression algorithm may be a better approach in this case), it's still can be used for that. But unfortunately, due to very compact (and variable-length) coding, there's no reliable way to find a character boundary without doing a full scan from the start. To fix that, you can insert the byte sequence `0xBF 0xBF 0xBF` periodically (for example, one for each 10 Kb of output) in the produced buffer (no Unicode character should produce this sequence in UTF-C) and reset the encoder state. After that, if you'll need to find a closest character boundary from a random point, you can scan the previous 10 Kb chunk until you'll find this sequence. After the last `0xBF` byte you'll get the character boundary and can continue decoding data.

# Links

* [https://denull.github.io/utf-c/](Demo Page for UTF-C)
* [https://en.wikipedia.org/wiki/Standard_Compression_Scheme_for_Unicode](SCSU on Wikipedia)
* [https://en.wikipedia.org/wiki/Binary_Ordered_Compression_for_Unicode](BOCU-1 on Wikipedia)
* [https://www.unicode.org/reports/tr6/tr6-4.html](Standard Compression Scheme for Unicode)
* [http://ewellic.org/compression.html](A survey of Unicode compression), Doug Ewell, 2004