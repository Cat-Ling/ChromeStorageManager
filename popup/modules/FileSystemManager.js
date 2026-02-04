export class FileSystemManager {
    constructor() {
        this.tabId = null;
    }

    setTabId(tabId) {
        this.tabId = tabId;
    }

    async getQuota() {
        if (!this.tabId) return null;
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getQuota' }, response => {
                resolve(response && response.data ? response.data : null);
            });
        });
    }

    async getFileSystem() {
        if (!this.tabId) return [];
        return new Promise(resolve => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getFileSystem' }, response => {
                resolve(response && response.data ? response.data : []);
            });
        });
    }
}
