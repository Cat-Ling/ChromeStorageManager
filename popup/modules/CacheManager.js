export class CacheManager {
    constructor() {
        this.tabId = null;
    }

    setTabId(tabId) {
        this.tabId = tabId;
    }

    async getCaches() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getCacheList' }, response => {
                if (chrome.runtime.lastError) {
                    console.warn(chrome.runtime.lastError);
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
                resolve(response && response.data ? response.data : []);
            });
        });
    }
}
