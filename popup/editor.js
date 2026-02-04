/**
 * Standalone Editor Logic
 */

let cmInstance = null;
let parentTabId = null;
let returnId = null; // ID to match the save callback

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Parse URL params
    const params = new URLSearchParams(window.location.search);
    parentTabId = parseInt(params.get('parentTabId'), 10);
    returnId = params.get('returnId');
    const initialLang = params.get('lang') || 'javascript';

    // Modal Logic
    document.getElementById('close-modal').onclick = () => {
        document.getElementById('image-modal').style.display = 'none';
        document.getElementById('preview-image').src = '';
    };

    // 2. Init CodeMirror
    const mount = document.getElementById('editor-mount');
    cmInstance = CodeMirror(mount, {
        value: "// Loading content...",
        mode: initialLang === 'json' ? { name: "javascript", json: true } : "javascript",
        theme: "dracula",
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        tabSize: 2
    });

    document.getElementById('lang-mode').textContent = initialLang.toUpperCase();

    // 3. Request Content from Parent
    if (parentTabId) {
        try {
            chrome.tabs.sendMessage(parentTabId, { type: 'EDITOR_READY', returnId }, (response) => {
                if (response && response.content) {
                    cmInstance.setValue(response.content);
                }
            });
        } catch (e) {
            console.error('Failed to contact parent:', e);
        }
    }

    // 4. Bind Events
    setupMenu();
    setupShortcuts();

    // 5. Auto-scan for images
    setupImageScanning();
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Image Widget & Scanning Logic
let imageRanges = []; // Track ranges of collapsed images
let scannedLines = new Set(); // Track which lines we've already processed

function setupImageScanning() {
    // Initial scan of viewport
    cmInstance.on('viewportChange', (cm, from, to) => {
        scanViewportImages(from, to);
    });

    // On change, we might need to re-scan modified lines
    cmInstance.on('change', (cm, changeObj) => {
        // If content changes, clear scanned cache for those lines? 
        // Or just clear everything if it's a big change?
        // For simplicity, specific line invalidation is complex. 
        // Let's just clear cache if it's a significant change or just rely on viewport scan.
        // Actually, easiest is to remove modified lines from `scannedLines`.

        const fromLine = changeObj.from.line;
        const toLine = changeObj.to.line;
        // Invalidate scanned status for touched lines
        for (let i = fromLine; i <= toLine; i++) {
            scannedLines.delete(i);
        }

        // Trigger a scan of the current viewport shortly after
        // (Debounced handled by the event loop usually, but explicit debounce is good)
        // We'll call scanViewportImages for the CURRENT viewport
        const vp = cmInstance.getViewport();
        scanViewportImages(vp.from, vp.to);
    });

    // Initial scan
    setTimeout(() => {
        const vp = cmInstance.getViewport();
        scanViewportImages(vp.from, vp.to);
    }, 500);
}

function scanViewportImages(from, to) {
    const doc = cmInstance.getDoc();

    // We iterate line by line in the viewport
    for (let i = from; i < to; i++) {
        if (scannedLines.has(i)) continue; // Skip already processed lines

        const lineText = doc.getLine(i);
        if (!lineText || lineText.length < 50) { // optimization: skip short lines
            scannedLines.add(i);
            continue;
        }

        // Fast check: does it even contain "data:image"?
        if (lineText.indexOf('data:image') === -1) {
            scannedLines.add(i);
            continue;
        }

        // Regex for header: quote + data:image/...;base64,
        // Reset regex state just in case, though we create new one or use exec correctly
        const headerRegex = /(['"])data:image\/[a-zA-Z0-9.\-+]+;base64,/g;

        let match;
        while ((match = headerRegex.exec(lineText)) !== null) {
            const quote = match[1];
            const header = match[0];
            const startCh = match.index;
            const payloadStartCh = startCh + header.length;

            // Find closing quote starting from payload
            const endCh = lineText.indexOf(quote, payloadStartCh);
            if (endCh === -1) continue;

            // Range checks
            if (payloadStartCh >= endCh) continue;

            // Check if this range is already marked?
            // cm.findMarksAt({line: i, ch: payloadStartCh}) 
            // optimization: we just blindly mark, simpler for now, CodeMirror handles overlaps mostly ok 
            // or we check scannedLines.

            const fromPos = { line: i, ch: payloadStartCh };
            const toPos = { line: i, ch: endCh };

            // Check existing marks to avoid duplication (Crucial for performance/memory)
            const existingMarks = cmInstance.findMarks(fromPos, toPos);
            const alreadyMarked = existingMarks.some(m => m.className === 'image-preview-mark');
            if (alreadyMarked) continue;

            // Full src for preview. CAREFUL with memory on massive strings.
            // But we need it for the click handler.
            // Maybe we extract it only ON CLICK?
            // Optimization: Don't store `src` in closure if possible?
            // Actually, for user experience, `src` is needed. 
            // But if line is 10MB, this substring is 10MB.
            // If we have 100 images, that's 1GB RAM.
            // Better: Store the coordinates and extract on click.

            createImageMark(fromPos, toPos);

            imageRanges.push({ from: fromPos, to: toPos });
        }
        scannedLines.add(i);
    }
}

function createImageMark(from, to) {
    const btn = document.createElement('span');
    btn.textContent = ' 📷 [Image Content] ';
    btn.className = 'cm-image-widget';
    btn.style.backgroundColor = 'var(--accent-color, #007bff)';
    btn.style.color = '#fff';
    btn.style.padding = '2px 6px';
    btn.style.borderRadius = '4px';
    btn.style.fontSize = '11px';
    btn.style.cursor = 'pointer';
    btn.style.marginLeft = '4px';
    btn.style.verticalAlign = 'middle';
    btn.title = 'Content Hidden. Click to preview.';

    btn.onclick = (e) => {
        e.stopPropagation();
        // Extract src on demand to save memory
        const doc = cmInstance.getDoc();
        // The header is BEFORE `from`. We need to visually exclude quotes.
        // `from` is start of payload. `to` is end of payload.
        // We need the full data URI? Usually "data:..." is needed.
        // The header is roughly `data:image...base64,` which is just before `from`.
        // We can just grab the line text again or range.

        // Wait, the previous logic extracted `startIdx + 1` to `endIdx`.
        // That included "data:image...".
        // Here `from` is AFTER header.
        // We need to seek back to find the "data:..." start? 
        // Or just grab the whole thing including header?

        // Let's grab the range surrounding it.
        // We know it's on `from.line`.
        const lineText = doc.getLine(from.line);
        // Find the start of the string (quote) before `from.ch`
        // This is a bit disjointed. 
        // Optimization: Let's just grab the whole line substring?

        // Re-find the match quickly?
        // Or just store the header length?
        // Let's store the header length in the button dataset?
        // Or just simplistic search backwards for "data:"?

        const textUpToPayload = lineText.substring(0, from.ch);
        const headerStart = textUpToPayload.lastIndexOf('data:image');
        if (headerStart !== -1) {
            const fullSrc = lineText.substring(headerStart, to.ch);
            showImagePreview(fullSrc);
        }
    };

    cmInstance.markText(from, to, {
        replacedWith: btn,
        atomic: true,
        className: 'image-preview-mark',
        clearOnEnter: false
    });
}

function showImagePreview(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('preview-image');
    img.src = src;
    modal.style.display = 'flex';
}

function setupMenu() {
    document.getElementById('menu-save').onclick = saveToParent;
    document.getElementById('menu-format').onclick = prettyPrint;
    document.getElementById('menu-load').onclick = loadFromFile;
    document.getElementById('menu-export').onclick = exportToFile;
}

function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveToParent();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            loadFromFile();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            toggleFind();
        }
        // Select All Instances (Ctrl+Shift+L)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            selectAllInstances();
        }
    });

    setupFindEvents();
    setupContextMenu();
}

function setupContextMenu() {
    const menu = document.getElementById('context-menu');
    const editorEl = document.querySelector('.CodeMirror');

    editorEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Only show if text is selected? Or allow selecting word under cursor?
        // VSCode style: if selection exists, use it. If not, maybe select word?
        // For now: require selection or select word under cursor
        if (!cmInstance.somethingSelected()) {
            const cursor = cmInstance.getCursor();
            const word = cmInstance.findWordAt(cursor);
            cmInstance.setSelection(word.anchor, word.head);
        }

        const sel = cmInstance.getSelection();
        if (!sel) return; // Should have selection now

        // Position menu
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    document.getElementById('ctx-select-all').onclick = () => {
        selectAllInstances();
        menu.style.display = 'none';
    };
}

function selectAllInstances() {
    const query = cmInstance.getSelection();
    if (!query) return;

    // Use current search state case sensitivity? Or default?
    // VSCode "Select All Occurrences" usually respects the Find widget settings if open,
    // or defaults to Case Sensitive usually (actually it depends). 
    // Let's use the toggle state if Find is open, else Case Sensitive? 
    // The user asked "make search case insensitive by default... select all instances ... like vscode".
    // VSCode's Ctrl+Shift+L is case sensitive by default unless Find Widget overrides.
    // Let's stick to the explicit toggle in our Find bar.

    const matches = findAllMatches(query, searchState.caseSensitive);
    if (matches.length === 0) return;

    // Convert to CM ranges {anchor, head}
    const ranges = matches.map(m => ({
        anchor: { line: m.line, ch: m.ch },
        head: { line: m.line, ch: m.endCh }
    }));

    cmInstance.setSelections(ranges);
    cmInstance.focus();
}

async function saveToParent() {
    if (!parentTabId) return;

    const content = cmInstance.getValue();
    setStatus('Saving...');

    chrome.tabs.sendMessage(parentTabId, {
        type: 'EDITOR_SAVE',
        returnId,
        content
    }, (response) => {
        if (response && response.success) {
            setStatus('Saved!');
            setTimeout(() => setStatus('Ready'), 2000);
            // Optional: Close window? User might want to keep editing.
            // window.close();
        } else {
            setStatus('Error saving');
        }
    });
}

async function loadFromFile() {
    try {
        const [handle] = await window.showOpenFilePicker();
        const file = await handle.getFile();
        const text = await file.text();
        cmInstance.setValue(text);
        setStatus(`Loaded: ${file.name}`);
    } catch (e) {
        // User cancelled or error
        console.log(e);
    }
}

async function exportToFile() {
    try {
        const content = cmInstance.getValue();
        const handle = await window.showSaveFilePicker({
            types: [{
                description: 'Text Files',
                accept: { 'text/plain': ['.txt', '.js', '.json'] }
            }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setStatus('Exported successfully');
    } catch (e) {
        console.log(e);
    }
}

async function prettyPrint() {
    const content = cmInstance.getValue();
    if (!content) return;

    try {
        // 1. Try JSON
        const json = JSON.parse(content);
        cmInstance.setValue(JSON.stringify(json, null, 2));
        cmInstance.setOption('mode', { name: "javascript", json: true });
        setStatus('Formatted JSON');
        return;
    } catch (e) {
        // Not simple JSON
    }

    try {
        // 2. Try URL Decoded JSON (common in cookies)
        const decoded = decodeURIComponent(content);
        if (decoded !== content) {
            try {
                const json = JSON.parse(decoded);
                cmInstance.setValue(JSON.stringify(json, null, 2));
                cmInstance.setOption('mode', { name: "javascript", json: true });
                setStatus('Decoded & Formatted JSON');
                return;
            } catch (e) { }
        }
    } catch (e) { }

    // 3. Simple JS/CSS generic formatter fallback
    // Very basic: indent on { [ ( and newline on ;
    // This is better than one long line
    try {
        let formatted = content
            .replace(/{/g, '{\n')
            .replace(/}/g, '\n}')
            .replace(/;/g, ';\n')
            .replace(/,/g, ',\n');

        // Simple heuristic to fix indentation? 
        // Using CodeMirror's autoFormatRange if available? 
        // Note: autoFormatRange is an addon, we probably don't have it loaded.
        // We will just set the new values and let the user rely on editor's existing indent capability

        // Actually, just breaking lines is better than nothing for minified code.
        cmInstance.setValue(formatted);

        // Select all and auto-indent logic if native CM supports it easily?
        // cmInstance.execCommand('selectAll');
        // cmInstance.indentSelection('smart'); // might not be exact method name

        setStatus('Simple formatting applied');
    } catch (e) {
        setStatus('Formatting failed');
    }
}



// --- Find Logic ---
let searchState = {
    query: '',
    results: [], // { line, ch, endCh }
    currentIndex: -1,
    caseSensitive: false
};

function toggleFind() {
    const bar = document.getElementById('find-bar');
    const input = document.getElementById('find-input');

    if (bar.style.display === 'none') {
        bar.style.display = 'flex';
        input.focus();
        input.select();
        // If there's a selection in editor, prefills it
        const sel = cmInstance.getSelection();
        if (sel) {
            input.value = sel;
            performFind();
        }
    } else {
        bar.style.display = 'none';
        cmInstance.focus();
    }
}

function toggleCaseSensitivity() {
    searchState.caseSensitive = !searchState.caseSensitive;
    const btn = document.getElementById('find-case');
    if (searchState.caseSensitive) {
        btn.style.backgroundColor = 'var(--bg-active, #444)';
        btn.style.color = 'var(--text-primary)';
        btn.style.borderColor = 'var(--border-color)';
    } else {
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        btn.style.borderColor = 'transparent';
    }
    performFind();
}

function findAllMatches(query, caseSensitive) {
    if (!query) return [];

    const results = [];
    const doc = cmInstance.getDoc();
    const lineCount = doc.lineCount();

    // Validate inputs
    if (typeof query !== 'string') return [];

    const normQuery = caseSensitive ? query : query.toLowerCase();

    for (let i = 0; i < lineCount; i++) {
        const lineText = doc.getLine(i);
        const normLine = caseSensitive ? lineText : lineText.toLowerCase();

        let pos = 0;
        while (pos < lineText.length) {
            const idx = normLine.indexOf(normQuery, pos);
            if (idx === -1) break;

            const matchStart = { line: i, ch: idx };
            const matchEnd = { line: i, ch: idx + query.length };

            // Check overlap with hidden images
            const isInsideImage = imageRanges.some(img => {
                if (img.from.line !== i) return false;
                return (matchStart.ch >= img.from.ch && matchEnd.ch <= img.to.ch);
            });

            if (!isInsideImage) {
                results.push({
                    line: i,
                    ch: idx,
                    endCh: idx + query.length
                });
            }
            pos = idx + 1;
        }
    }
    return results;
}

function performFind() {
    const query = document.getElementById('find-input').value;

    const results = findAllMatches(query, searchState.caseSensitive);

    searchState = { ...searchState, query, results, currentIndex: -1 };

    if (results.length > 0) {
        findNext(); // Go to first
    } else {
        document.getElementById('find-count').textContent = '0/0';
    }
}

function findNext() {
    if (searchState.results.length === 0) return;

    searchState.currentIndex++;
    if (searchState.currentIndex >= searchState.results.length) {
        searchState.currentIndex = 0; // wrap
    }

    highlightResult(searchState.currentIndex);
}

function findPrev() {
    if (searchState.results.length === 0) return;

    searchState.currentIndex--;
    if (searchState.currentIndex < 0) {
        searchState.currentIndex = searchState.results.length - 1; // wrap
    }

    highlightResult(searchState.currentIndex);
}

function highlightResult(index) {
    const match = searchState.results[index];
    document.getElementById('find-count').textContent = `${index + 1}/${searchState.results.length}`;

    cmInstance.setSelection(
        { line: match.line, ch: match.ch },
        { line: match.line, ch: match.endCh }
    );
    cmInstance.scrollIntoView({
        from: { line: match.line, ch: match.ch },
        to: { line: match.line, ch: match.endCh }
    }, 200);
}

function setupFindEvents() {
    document.getElementById('find-input').addEventListener('input', performFind);
    document.getElementById('find-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) findPrev();
            else findNext();
        }
        if (e.key === 'Escape') toggleFind();
    });
    document.getElementById('find-next').onclick = findNext;
    document.getElementById('find-prev').onclick = findPrev;
    document.getElementById('find-close').onclick = toggleFind;
    document.getElementById('find-case').onclick = toggleCaseSensitivity;

    // Add menu item
    const menuBar = document.querySelector('.menubar');
    if (menuBar && !document.getElementById('menu-find')) {
        const btn = document.createElement('div');
        btn.className = 'menu-item';
        btn.id = 'menu-find';
        btn.textContent = 'Find (Ctrl+F)';
        btn.onclick = toggleFind;
        menuBar.insertBefore(btn, document.getElementById('menu-load'));
    }
}

function setStatus(msg) {
    document.getElementById('status-msg').textContent = msg;
}
