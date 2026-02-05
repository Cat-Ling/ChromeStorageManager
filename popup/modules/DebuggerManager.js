export class DebuggerManager {
    constructor() {
        this.tabId = null;
        this.version = '1.3';
    }

    setTabId(tabId) {
        if (this.tabId !== tabId) {
            this.tabId = tabId;
        }
    }

    async attach() {
        if (!this.tabId) return;
        try {
            await chrome.debugger.attach({ tabId: this.tabId }, this.version);
            console.log('Debugger attached to tab', this.tabId);
        } catch (e) {
            // Ignore if already attached
            if (!e.message.includes('already attached')) {
                console.error('Failed to attach debugger:', e);
                throw e; // Let UI handle it
            }
        }
    }

    async detach() {
        if (!this.tabId) return;
        try {
            await chrome.debugger.detach({ tabId: this.tabId });
        } catch (e) {
            // Ignore
        }
    }

    async sendCommand(fullMethod, params = {}) {
        if (!this.tabId) throw new Error('No target tab');
        try {
            return await chrome.debugger.sendCommand({ tabId: this.tabId }, fullMethod, params);
        } catch (e) {
            if (e.message.includes('not attached')) {
                await this.attach();
                return await chrome.debugger.sendCommand({ tabId: this.tabId }, fullMethod, params);
            }
            throw e;
        }
    }

    // --- Trust Tokens (CDP Only) ---

    async getTrustTokens() {
        try {
            const result = await this.sendCommand('Storage.getTrustTokens');
            return result.tokens;
        } catch (e) {
            console.warn('Trust Tokens not available:', e);
            return [];
        }
    }

    async getStorageUsage(origin) {
        if (!origin) return null;
        try {
            return await this.sendCommand('Storage.getUsageAndQuota', { origin });
        } catch (e) {
            console.warn('Storage Usage not available:', e);
            return null;
        }
    }
}
