export class PageVariablesManager {
    constructor() {
        this.tabId = null;
        this.variablesCache = null;
    }

    setTabId(tabId) {
        if (this.tabId !== tabId) {
            this.tabId = tabId;
            this.variablesCache = null;
        }
    }

    async getVariables(force = false) {
        if (!force && this.variablesCache) {
            return this.variablesCache;
        }

        if (!this.tabId) return [];

        const injection = {
            target: { tabId: this.tabId },
            world: 'MAIN',
            func: () => {
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
                        let safeVal = 'undefined';
                        if (type === 'object' && val !== null) {
                            try {
                                if (Array.isArray(val)) type = `Array(${val.length})`;
                                else type = 'Object';
                                safeVal = JSON.stringify(val);
                            } catch (e) {
                                safeVal = '[Circular/Unserializable] ' + String(val);
                            }
                        } else if (type === 'function') {
                            safeVal = val.toString();
                        } else {
                            safeVal = String(val);
                        }

                        globals.push({ key, value: safeVal, type, details });
                    };

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
                                addVar(key, val, typeof val, isFramework || null);
                            } catch (e) { }
                        }
                    }

                    // Deep State Discovery
                    const vueRoots = [
                        document.getElementById('app'),
                        document.getElementById('__nuxt'),
                        document.querySelector('[data-v-app]')
                    ];

                    vueRoots.forEach(root => {
                        if (!root || !root.__vue__) return;
                        addVar('[Vue] Root $data', root.__vue__.$data, 'object', 'Vue 2 State');
                        if (root.__vue__.$store) {
                            addVar('[Vue] Vuex Store', root.__vue__.$store.state, 'object', 'Vuex State');
                        }
                    });

                    if (window.SugarCube && window.SugarCube.State) {
                        addVar('[SugarCube] Variables', window.SugarCube.State.variables, 'object', 'Game State');
                    }

                    return globals;
                } catch (e) {
                    return [{ key: 'Error', value: e.message }];
                }
            }
        };

        const [response] = await chrome.scripting.executeScript(injection);
        this.variablesCache = response.result;
        return response.result;
    }

    async setVariable(name, value) {
        this.variablesCache = null;

        await chrome.scripting.executeScript({
            target: { tabId: this.tabId },
            world: 'MAIN',
            args: [name, value],
            func: (name, valueStr) => {
                let val;
                try {
                    val = JSON.parse(valueStr);
                } catch (e) {
                    val = valueStr;
                }

                if (name.startsWith('[Vue] Root $data')) {
                    const root = document.getElementById('app') || document.querySelector('[data-v-app]');
                    if (root && root.__vue__) {
                        Object.assign(root.__vue__.$data, val);
                        return;
                    }
                } else if (name.startsWith('[Vue] Vuex Store')) {
                    const root = document.getElementById('app') || document.querySelector('[data-v-app]');
                    if (root && root.__vue__ && root.__vue__.$store) {
                        root.__vue__.$store.replaceState(val);
                        return;
                    }
                } else if (name.startsWith('[SugarCube]')) {
                    if (window.SugarCube && window.SugarCube.State) {
                        window.SugarCube.State.variables = val;
                        return;
                    }
                } else {
                    window[name] = val;
                }
            }
        });
    }
}
