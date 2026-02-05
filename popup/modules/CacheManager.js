export class CacheManager {
    constructor() {
        this.tabId = null;
    }

    async connect(tabId) {
        this.tabId = tabId;
        await chrome.scripting.executeScript({
            target: { tabId: this.tabId },
            files: ['content/inspector.js']
        });
    }

    async getCaches() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getCacheList' }, response => {
                if (chrome.runtime.lastError) {
                    console.warn('CacheManager: getCaches failed:', chrome.runtime.lastError.message);
                    resolve([]);
                    return;
                }
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async getCacheItems(cacheName) {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getCacheItems', cacheName }, response => {
                if (chrome.runtime.lastError) {
                    console.warn('CacheManager: getCacheItems failed:', chrome.runtime.lastError.message);
                    resolve([]);
                    return;
                }
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async addItem(cacheName, url) {
        if (!this.tabId) return;
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(this.tabId, { type: 'addCacheItem', cacheName, url }, response => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        });
    }
}
