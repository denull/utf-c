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