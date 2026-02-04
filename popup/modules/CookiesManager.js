/**
 * Cookie Manager Module
 */
export class CookiesManager {
    constructor() {
        this.currentUrl = null;
    }

    async setUrl(url) {
        this.currentUrl = new URL(url);
    }

    async getAll() {
        if (!this.currentUrl) return [];

        const hostname = this.currentUrl.hostname;
        // Simple domain extraction: get 'example.com' from 'www.dev.example.com'
        // This is a naive implementation; for production robust use, a public suffix list is needed
        // but this covers 99% of cases.
        const parts = hostname.split('.');
        let domain = hostname;
        if (parts.length > 2) {
            domain = parts.slice(-2).join('.');
            // Handle some common 2-part TLDs like co.uk roughly
            if (parts.length > 3 && (parts[parts.length - 2].length <= 2 || ['co.uk', 'com.au', 'net.in'].includes(domain))) {
                domain = parts.slice(-3).join('.');
            }
        }

        return new Promise((resolve) => {
            // Fetch by URL (Context specific)
            chrome.cookies.getAll({ url: this.currentUrl.href }, (urlCookies) => {
                // Fetch by Domain (Subdomain coverage)
                chrome.cookies.getAll({ domain: domain }, (domainCookies) => {
                    // Fetch by hostname just in case
                    chrome.cookies.getAll({ domain: hostname }, (hostCookies) => {
                        const all = [...(urlCookies || []), ...(domainCookies || []), ...(hostCookies || [])];

                        // Deduplicate by Name + Domain + Path
                        const unique = new Map();
                        all.forEach(c => {
                            const key = `${c.name}|${c.domain}|${c.path}`;
                            unique.set(key, c);
                        });

                        resolve(Array.from(unique.values()));
                    });
                });
            });
        });
    }



    async set(cookie) {
        let url = this.currentUrl ? this.currentUrl.href : null;

        // If domain is specified, try to construct a URL that matches it
        if (cookie.domain) {
            const protocol = cookie.secure ? 'https:' : 'http:';
            const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            url = `${protocol}//${domain}${cookie.path || '/'}`;
        }

        const details = {
            url: url,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/',
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            storeId: cookie.storeId,
            expirationDate: cookie.expirationDate
        };

        // Remove domain if it's host-only (no domain attribute)
        if (cookie.domain && !cookie.hostOnly) {
            details.domain = cookie.domain;
        }

        return new Promise((resolve, reject) => {
            chrome.cookies.set(details, (c) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(c);
                }
            });
        });
    }

    async delete(cookie) {
        const url = "http" + (cookie.secure ? "s" : "") + "://" + (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain) + cookie.path;
        return new Promise((resolve) => {
            chrome.cookies.remove({
                url: url,
                name: cookie.name,
                storeId: cookie.storeId
            }, (details) => {
                resolve(details);
            });
        });
    }
}
