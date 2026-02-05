// Web Worker for Codec Operations
// Bundles LZString for decompressions

// Import LZString (we'll need to make sure the path is correct or copy it)
// Since this is a worker, we might need to use importScripts if it's not a module
importScripts('../lib/lz-string.js');

self.onmessage = function (e) {
    const { type, payload, codecName } = e.data;

    if (type === 'DECODE') {
        try {
            let result = payload;

            if (codecName === 'lzstring') {
                result = decodeLZString(payload);
            } else if (codecName === 'base64') {
                result = atob(payload);
                try { result = JSON.stringify(JSON.parse(result), null, 2); } catch (e) { }
            } else if (codecName === 'url') {
                result = decodeURIComponent(payload);
                try { result = JSON.stringify(JSON.parse(result), null, 2); } catch (e) { }
            } else if (codecName === 'json') {
                try { result = JSON.stringify(JSON.parse(payload), null, 2); } catch (e) { }
            }

            self.postMessage({ success: true, result });
        } catch (err) {
            self.postMessage({ success: false, error: err.message });
        }
    }

    if (type === 'ENCODE') {
        // Implementation for encoding if needed
    }
};

function decodeLZString(val) {
    const methods = ['decompressFromUTF16', 'decompressFromBase64', 'decompressFromEncodedURIComponent', 'decompress'];
    for (const m of methods) {
        try {
            const decompressed = LZString[m](val);
            if (decompressed && decompressed !== val) {
                try {
                    return JSON.stringify(JSON.parse(decompressed), null, 2);
                } catch (e) {
                    if (isMeaningfulText(decompressed)) return decompressed;
                }
            }
        } catch (e) { }
    }
    return val;
}

function isMeaningfulText(str) {
    if (!str || str.length < 2) return false;
    let printable = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
            printable++;
        }
    }
    return (printable / str.length) > 0.95;
}
