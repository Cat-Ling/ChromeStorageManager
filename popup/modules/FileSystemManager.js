export class FileSystemManager {
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

    async getQuota() {
        if (!this.tabId) return null;
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getQuota' }, response => {
                if (chrome.runtime.lastError) {
                    console.warn('FileSystemManager: getQuota failed:', chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                resolve(response && response.data ? response.data : null);
            });
        });
    }

    async getFileSystem() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getFileSystem' }, response => {
                if (chrome.runtime.lastError) {
                    console.warn('FileSystemManager: getFileSystem failed:', chrome.runtime.lastError.message);
                    resolve([]);
                    return;
                }
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async getServiceWorkers() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getServiceWorkers' }, response => {
                if (chrome.runtime.lastError) {
                    console.warn('FileSystemManager: getServiceWorkers failed:', chrome.runtime.lastError.message);
                    resolve([]);
                    return;
                }
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async downloadFile(path) {
        if (!this.tabId) return null;
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(this.tabId, { type: 'downloadFile', path }, response => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        });
    }

    async getBuckets() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getStorageBuckets' }, response => {
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async getSharedStorage() {
        if (!this.tabId) return { available: false };
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getSharedStorage' }, response => {
                resolve(response && response.data ? response.data : { available: false });
            });
        });
    }
}
