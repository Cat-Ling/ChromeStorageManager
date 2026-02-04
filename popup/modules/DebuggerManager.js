export class DebuggerManager {
    constructor() {
        this.tabId = null;
        this.version = '1.3';
        this.variablesCache = null;
    }

    setTabId(tabId) {
        if (this.tabId !== tabId) {
            this.tabId = tabId;
            this.variablesCache = null;
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
            // Auto-attempt attach if detached?
            if (e.message.includes('not attached')) {
                await this.attach();
                return await chrome.debugger.sendCommand({ tabId: this.tabId }, fullMethod, params);
            }
            throw e;
        }
    }

    // --- Deep Storage Methods ---

    async getAllCookies() {
        // Network.getCookies returns ALL cookies including HttpOnly and Secure
        const result = await this.sendCommand('Network.getCookies');
        return result.cookies;
    }

    async getTrustTokens() {
        // Storage.getTrustTokens
        try {
            const result = await this.sendCommand('Storage.getTrustTokens');
            return result.tokens;
        } catch (e) {
            console.warn('Trust Tokens not available:', e);
            return [];
        }
    }

    async getStorageUsage() {
        // Storage.getUsageAndQuota
        try {
            return await this.sendCommand('Storage.getUsageAndQuota');
        } catch (e) {
            console.warn('Storage Usage not available:', e);
            return null;
        }
    }

    async deleteCookie(cookie) {
        // Network.deleteCookies
        return await this.sendCommand('Network.deleteCookies', {
            name: cookie.name,
            url: this._getCookieUrl(cookie),
            domain: cookie.domain,
            path: cookie.path
        });
    }

    async setCookie(cookie) {
        // Network.setCookie
        const params = {
            name: cookie.name,
            value: cookie.value,
            url: this._getCookieUrl(cookie),
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            expires: cookie.expirationDate
        };
        // Clean undefined
        Object.keys(params).forEach(key => params[key] === undefined && delete params[key]);

        return await this.sendCommand('Network.setCookie', params);
    }



    // --- Runtime Methods (Page Variables) ---

    async getGlobalVariables(force = false) {
        if (!force && this.variablesCache) {
            return this.variablesCache;
        }

        // Script to find user-defined globals by comparing with a clean iframe window
        const expression = `
        (function() {
            try {
                // 1. Identify Built-ins to ignore
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
                const builtins = Object.getOwnPropertyNames(iframe.contentWindow);
                document.body.removeChild(iframe);
                const builtInSet = new Set(builtins);
                
                ['window', 'document', 'location', 'top', 'chrome', 'console', 'caches', 'indexedDB', 'localStorage', 'sessionStorage', 'crypto', 'performance', 'speechSynthesis', 'styleMedia'].forEach(k => builtInSet.add(k));

                const globals = [];

                // --- Helper: Add Variable ---
                const addVar = (key, val, type, details) => {
                    // Serialize complex objects safely
                    let safeVal = 'undefined';
                    if (type === 'object' && val !== null) {
                        try { 
                            if (Array.isArray(val)) type = \`Array(\${val.length})\`;
                            else type = 'Object';
                            safeVal = JSON.stringify(val); 
                        } catch(e) { 
                            safeVal = '[Circular/Unserializable] ' + String(val); 
                        }
                    } else if (type === 'function') {
                        safeVal = val.toString();
                    } else {
                        safeVal = String(val);
                    }
                    
                    globals.push({ key, value: safeVal, type, details });
                };

                // 2. Scan Window Globals (Standard)
                // Define Framework Signatures
                const frameworkMaps = {
                    '__NEXT_DATA__': 'Next.js Data',
                    '__REACT_DEVTOOLS_GLOBAL_HOOK__': 'React DevTools',
                    '_reactRootContainer': 'React Root',
                    '__VUE__': 'Vue.js Global',
                    '__NUXT__': 'Nuxt.js Data',
                    '__SVELTE__': 'Svelte',
                    'webpackChunk_N_E': 'Webpack Chunk',
                    'jQuery': 'jQuery',
                    '$': 'jQuery (Alias)',
                    'SugarCube': 'SugarCube Engine'
                };

                for (const key of Object.getOwnPropertyNames(window)) {
                    if (!builtInSet.has(key)) {
                        const isFramework = frameworkMaps[key];
                        try {
                            const val = window[key];
                            // If it's a generic global, add it
                            addVar(key, val, typeof val, isFramework || null);
                        } catch(e) {}
                    }
                }

                // 3. Deep State Discovery (The "Smart Analyzer")
                
                // A. Vue.js 2/3 Detection
                // Look for Vue instance on common root elements
                const vueRoots = [
                    document.getElementById('app'),
                    document.getElementById('__nuxt'),
                    document.querySelector('[data-v-app]')
                ];
                
                vueRoots.forEach(root => {
                    if (!root) return;
                    
                    // Vue 2: root.__vue__
                    if (root.__vue__) {
                        addVar('[Vue] Root $data', root.__vue__.$data, 'object', 'Vue 2 State');
                        if (root.__vue__.$store) {
                            addVar('[Vue] Vuex Store', root.__vue__.$store.state, 'object', 'Vuex State');
                        }
                    }
                    // Vue 3: root._vnode?.component?.data etc (harder to reach stable state from outside)
                });
                
                // B. SugarCube (Twine)
                if (window.SugarCube && window.SugarCube.State) {
                    addVar('[SugarCube] Variables', window.SugarCube.State.variables, 'object', 'Game State');
                }

                return globals;

            } catch (e) {
                return [{key: 'Error', value: e.message}];
            }
        })()
        `;

        const result = await this.sendCommand('Runtime.evaluate', {
            expression: expression,
            returnByValue: true
        });

        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text);
        }
        this.variablesCache = result.result.value;
        return result.result.value;
    }

    async setGlobalVariable(name, value) {
        this.variablesCache = null; // Invalidate cache on update
        let expression = '';

        // Handle Special Deep State Paths
        if (name.startsWith('[Vue] Root $data')) {
            // We assume the root is #app or we find it dynamically again
            // For safety, we repeat the finding logic or assume a conventional ID
            expression = `
            (function() {
                var root = document.getElementById('app') || document.querySelector('[data-v-app]');
                if (root && root.__vue__) {
                    Object.assign(root.__vue__.$data, ${value});
                    return root.__vue__.$data;
                }
                throw new Error('Vue Root not found for update');
            })()
            `;
        } else if (name.startsWith('[Vue] Vuex Store')) {
            expression = `
            (function() {
                var root = document.getElementById('app') || document.querySelector('[data-v-app]');
                if (root && root.__vue__ && root.__vue__.$store) {
                    root.__vue__.$store.replaceState(${value}); // Vuex specific
                    return root.__vue__.$store.state;
                }
                throw new Error('Vuex Store not found for update');
            })()
            `;
        } else if (name.startsWith('[SugarCube]')) {
            expression = `
             (function() {
                if (window.SugarCube && window.SugarCube.State) {
                    window.SugarCube.State.variables = ${value};
                    // Force display update if possible?
                    // if (window.SugarCube.Engine) window.SugarCube.Engine.show();
                    return window.SugarCube.State.variables;
                }
                throw new Error('SugarCube not found');
             })()
             `;
        } else {
            // Standard Global Variable
            expression = `window['${name}'] = ${value}`;
        }

        const result = await this.sendCommand('Runtime.evaluate', {
            expression: expression
        });

        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text);
        }
        return result.result;
    }

    _getCookieUrl(cookie) {
        // Helper to construct URL for CDP
        if (cookie.url) return cookie.url;
        const protocol = cookie.secure ? 'https:' : 'http:';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        return `${protocol}//${domain}${cookie.path || '/'}`;
    }
}
