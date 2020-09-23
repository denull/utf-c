# UTF-C JavaScript Library

This is an implementation of a custom Unicode encoding scheme for storing strings in a compact way. It's mainly intended for storing a lot of short strings in memory. It's not a standard algorithm, and you should not use it in external APIs: it does not provide ASCII transparency (the produced output can contain 7-bit ASCII values that weren't present in the original string), so it can lead to a number of security vulnerabilities. It is, however, ASCII (and partly CP1252/ISO-8859-1) compatible: every ASCII string (and some CP1252 strings) is represented in the same way in UTF-C.

**UTF-C** (C stands for "compact") is similar to [SCSU](https://en.wikipedia.org/wiki/Standard_Compression_Scheme_for_Unicode) (Standard Compression Scheme for Unicode), but it's more lightweight and simple (for example, minified JS version is just 1.7 Kb that includes both encoder and decoder). It's implementation does not require any heuristics to achieve good performance. In comparision with a SCSU compressor of same complexity, it often delivers better results in terms of compressed strings size.

You can try it for yourself in this [online demo](https://denull.github.io/utf-c/). More details about this algorithm can be found on [the main page of this repository](https://github.com/deNULL/utf-c).

## How to use

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