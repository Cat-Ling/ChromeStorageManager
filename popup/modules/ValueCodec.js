// LZString assumed global (loaded via script tag)

/**
 * Interface for Value Codecs
 */
class Codec {
    get name() { return 'raw'; }
    get displayName() { return 'Raw Text'; }

    /**
     * Determine if this codec can handling the given value.
     * @param {string} val 
     * @returns {number} Confidence score (0-100)
     */
    canDecode(val) { return 0; }

    decode(val) { return val; }
    encode(val) { return val; }
}

class JsonCodec extends Codec {
    get name() { return 'json'; }
    get displayName() { return 'JSON'; }

    canDecode(val) {
        if (typeof val !== 'string') return 0;
        val = val.trim();
        if ((!val.startsWith('{') && !val.startsWith('[')) || (!val.endsWith('}') && !val.endsWith(']'))) {
            return 0;
        }
        try {
            JSON.parse(val);
            return 100; // Certainty
        } catch (e) {
            return 0;
        }
    }

    decode(val) {
        try {
            return JSON.stringify(JSON.parse(val), null, 2);
        } catch (e) { return val; }
    }

    encode(val) {
        try {
            // Minify by default for storage
            return JSON.stringify(JSON.parse(val));
        } catch (e) { return val; }
    }
}

class LZStringCodec extends Codec {
    get name() { return 'lzstring'; }
    get displayName() { return 'LZString'; }

    canDecode(val) {
        if (typeof val !== 'string' || val.length < 4) return 0;

        // Fast-track signature for UTF-16 LZString
        // Many game saves start with ᯡ (U+1BE1) or ᯡࠫ
        if (val.startsWith('\u1BE1')) {
            return 95;
        }

        // Try all common LZString formats
        const results = [
            { format: 'UTF16', decoded: this.safeDecompress(val, 'decompressFromUTF16') },
            { format: 'Base64', decoded: this.safeDecompress(val, 'decompressFromBase64') },
            { format: 'URI', decoded: this.safeDecompress(val, 'decompressFromEncodedURIComponent') },
            { format: 'Generic', decoded: this.safeDecompress(val, 'decompress') }
        ].filter(r => r.decoded && r.decoded !== val && r.decoded.length > 0);

        if (results.length === 0) return 0;

        // Pick the best result (usually only one will yield meaningful output)
        for (const res of results) {
            const decompressed = res.decoded;

            // Heuristic 1: Is it valid JSON?
            try {
                JSON.parse(decompressed);
                return 100; // Certainty
            } catch (e) { }

            // Heuristic 2: Expansion Ratio & Meaningful Text
            const ratio = decompressed.length / val.length;

            if (val.length < 20) {
                // For very short strings, we ONLY accept if it's JSON
                continue;
            }

            // UTF-16 encoded LZString often has a 1:1 or smaller ratio in character count 
            // even if the raw data is much larger, because it uses 16-bit indexes.
            const isUTF16Like = res.format === 'UTF16' || res.format === 'Generic';

            if ((ratio > 1.1 || (isUTF16Like && ratio > 0.5)) && this.isMeaningfulText(decompressed)) {
                return 85;
            }
        }

        return 0;
    }

    safeDecompress(val, method) {
        try {
            return LZString[method](val);
        } catch (e) {
            return null;
        }
    }

    isMeaningfulText(str) {
        if (!str || str.length < 2) return false;
        let printable = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
                printable++;
            }
        }
        return (printable / str.length) > 0.95; // Stricter threshold
    }

    decode(val) {
        const methods = ['decompressFromUTF16', 'decompressFromBase64', 'decompressFromEncodedURIComponent', 'decompress'];
        for (const m of methods) {
            try {
                const decompressed = LZString[m](val);
                if (decompressed && decompressed !== val) {
                    try {
                        return JSON.stringify(JSON.parse(decompressed), null, 2);
                    } catch (e) {
                        if (this.isMeaningfulText(decompressed)) return decompressed;
                    }
                }
            } catch (e) { }
        }
        return val;
    }

    encode(val) {
        try {
            let toCompress = val;
            try {
                toCompress = JSON.stringify(JSON.parse(val));
            } catch (e) { }
            // Default to UTF16 for internal re-encoding if we can't tell the original format
            return LZString.compressToUTF16(toCompress);
        } catch (e) {
            console.error('LZString encode failed', e);
            throw e;
        }
    }
}

class Base64Codec extends Codec {
    get name() { return 'base64'; }
    get displayName() { return 'Base64'; }

    canDecode(val) {
        if (typeof val !== 'string' || val.length < 4) return 0;
        // Basic Regex Check
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(val)) return 0;

        try {
            const decoded = atob(val);
            // 1. Is it JSON?
            try {
                JSON.parse(decoded);
                return 100; // Strongest signal
            } catch (e) { }

            // 2. Is it Meaningful Text?
            if (this.isMeaningfulText(decoded)) {
                return 80;
            }
            return 0;

        } catch (e) {
            return 0;
        }
    }

    isMeaningfulText(str) {
        if (!str || str.length === 0) return false;
        let printable = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
                printable++;
            }
        }
        return (printable / str.length) > 0.9;
    }

    decode(val) {
        try {
            const decoded = atob(val);
            try { return JSON.stringify(JSON.parse(decoded), null, 2); } catch (e) { return decoded; }
        } catch (e) { return val; }
    }

    encode(val) {
        try {
            let toEncode = val;
            try { toEncode = JSON.stringify(JSON.parse(val)); } catch (e) { }
            return btoa(toEncode);
        } catch (e) { throw e; }
    }
}

class UrlCodec extends Codec {
    get name() { return 'url'; }
    get displayName() { return 'URL Encoded'; }

    canDecode(val) {
        if (typeof val !== 'string' || val.length === 0) return 0;

        // Quick check: must contain '%'
        if (val.indexOf('%') === -1) return 0;

        // Negative check: If it already starts with { or [, it's likely NOT a fully encoded string
        // unless it's double encoded. 
        // User Requirement: "not mistake a large normal json which contains an encoded url"
        // This means: {"url":"http%3A..."} -> Should be detected as JSON (JsonCodec), not UrlCodec.
        // UrlCodec should only apply if the *entire* string is encoded.
        const trimmed = val.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 0;

        try {
            const decoded = decodeURIComponent(val);
            if (decoded === val) return 0;

            // Heuristic 1: Is the decoded version JSON?
            try {
                JSON.parse(decoded);
                return 100; // Strongest signal (It was an encoded JSON object)
            } catch (e) { }

            // Heuristic 2: Is it meaningful text?
            // And does it look like we actually decoded something significant?
            // e.g. "foo%20bar" -> "foo bar" (Good)
            // "foo" -> "foo" (Bad)

            // Check entropy reduction or simply length change?
            // "a%20b" (5 chars) -> "a b" (3 chars).

            if (this.isMeaningfulText(decoded)) {
                return 70;
            }
            return 0;

        } catch (e) {
            return 0;
        }
    }

    isMeaningfulText(str) {
        if (!str || str.length === 0) return false;
        let printable = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
                printable++;
            }
        }
        return (printable / str.length) > 0.9;
    }

    decode(val) {
        try {
            const decoded = decodeURIComponent(val);
            try { return JSON.stringify(JSON.parse(decoded), null, 2); } catch (e) { return decoded; }
        } catch (e) { return val; }
    }

    encode(val) {
        try {
            let toEncode = val;
            try { toEncode = JSON.stringify(JSON.parse(val)); } catch (e) { }
            return encodeURIComponent(toEncode);
        } catch (e) { throw e; }
    }
}

export class CodecManager {
    constructor() {
        this.codecs = [
            new JsonCodec(), // JSON first
            new LZStringCodec(),
            new Base64Codec(),
            new UrlCodec()
        ];
    }

    detect(val) {
        if (!val || typeof val !== 'string' || val.length < 2) return null;

        // Optimized order: JSON is most likely for large sets, LZString is most unique
        for (const codec of this.codecs) {
            const score = codec.canDecode(val);
            if (score >= 90) return codec;
        }

        // Second pass for lower confidence matches
        let bestCodec = null;
        let maxScore = 0;
        for (const codec of this.codecs) {
            const score = codec.canDecode(val);
            if (score > maxScore) {
                maxScore = score;
                bestCodec = codec;
            }
        }

        return maxScore >= 50 ? bestCodec : null;
    }
}
