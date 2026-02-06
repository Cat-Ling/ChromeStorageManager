/**
 * DataGrid Component
 * Renders a table-like view for storage items.
 */
export class DataGrid {
    constructor(container, options = {}) {
        this.container = container;
        this.columns = options.columns || [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }];
        this.onEdit = options.onEdit || (() => { });
        this.onDelete = options.onDelete || (() => { });
        this.onUpdate = options.onUpdate || null;
        this.onDuplicate = options.onDuplicate || null;
        this.onAdd = options.onAdd || null;
        this.extraContextItems = options.extraContextItems || []; // [{ label, action }]
        this.enableGlobalContextMenu = options.enableGlobalContextMenu !== false;
        this.sortCol = options.defaultSortCol || null;
        this.sortDir = options.defaultSortDir || 'asc';

        // Global Context Menu for container/empty space
        // Prevent duplicate listeners if container is reused
        if (this.container._hasDataGridListener) {
            this.container.removeEventListener('contextmenu', this.container._hasDataGridListener);
            delete this.container._hasDataGridListener;
        }

        if (this.enableGlobalContextMenu) {
            const contextHandler = (e) => {
                // If we're not clicking a row, it's empty space
                if (!e.target.closest('.data-row')) {
                    e.preventDefault();
                    this.showContextMenu(e, null);
                }
            };

            this.container.addEventListener('contextmenu', contextHandler);
            this.container._hasDataGridListener = contextHandler;
        }
    }

    render(data) {
        this.container.innerHTML = '';
        this.data = data; // Keep reference

        if (!data || data.length === 0) {
            this.container.innerHTML = `
        <div class="empty-state">
          <span>No items found</span>
        </div>
      `;
            return;
        }

        // Sorting
        let displayData = [...data];
        if (this.sortCol) {
            displayData.sort((a, b) => {
                let valA = a[this.sortCol];
                let valB = b[this.sortCol];

                // Handle nulls/undefined
                if (valA === null || valA === undefined) valA = '';
                if (valB === null || valB === undefined) valB = '';

                // Case-insensitive string comparison
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();

                if (valA < valB) return this.sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return this.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }

        const table = document.createElement('table');
        table.className = 'data-grid-table';

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        this.columns.forEach((col, index) => {
            const th = document.createElement('th');
            const isActive = this.sortCol === col.key;
            const arrow = this.sortDir === 'asc' ? '▲' : '▼';

            th.innerHTML = `
                <span class="header-text">
                    ${col.label}
                    <span class="sort-indicator ${isActive ? 'active' : ''}">${isActive ? arrow : '▲'}</span>
                </span>
            `;

            th.onclick = () => {
                if (this.sortCol === col.key) {
                    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortCol = col.key;
                    this.sortDir = 'asc';
                }
                this.render(this.data);
            };

            // Set initial width if provided, otherwise default to a constrained size
            th.style.width = col.width || '150px';

            // Resizer handle
            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            this.setupResizer(resizer, th);
            th.appendChild(resizer);

            headerRow.appendChild(th);
        });

        // Remove explicit Actions column header
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');

        displayData.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'data-row'; // For hover effects

            // Context Menu Handler
            tr.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, item);
            });

            // Double click to edit value
            tr.addEventListener('dblclick', () => {
                if (this.onEdit) this.onEdit(item);
            });

            this.columns.forEach(col => {
                const td = document.createElement('td');
                const val = item[col.key];

                const wrapper = document.createElement('div');
                wrapper.className = 'cell-content';

                // Use custom render if provided, else default stringification
                if (col.render) {
                    wrapper.innerHTML = col.render(val, item);
                } else {
                    let displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    // Truncate for performance if very large
                    if (displayVal.length > 500) {
                        displayVal = displayVal.substring(0, 500) + '...';
                    }
                    wrapper.textContent = displayVal;
                }

                td.appendChild(wrapper);

                // Tooltip truncation
                let titleVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                if (titleVal.length > 1000) {
                    titleVal = titleVal.substring(0, 1000) + '... (truncated)';
                }
                td.title = titleVal;
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        this.container.appendChild(table);
    }

    setupResizer(resizer, th) {
        let startX = 0;
        let startWidth = 0;
        let animationFrame = null;

        const mouseMoveHandler = (e) => {
            if (animationFrame) cancelAnimationFrame(animationFrame);

            animationFrame = requestAnimationFrame(() => {
                const dx = e.clientX - startX;
                th.style.width = `${startWidth + dx}px`;
            });
        };

        const mouseUpHandler = () => {
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            if (animationFrame) cancelAnimationFrame(animationFrame);

            document.body.classList.remove('resizing');
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            startX = e.clientX;

            // Use getBoundingClientRect for sub-pixel precision
            const rect = th.getBoundingClientRect();
            startWidth = rect.width;

            const table = th.closest('table');
            if (table) {
                // 1. Lock total table width so it doesn't fight min-width: 100%
                const tableRect = table.getBoundingClientRect();
                table.style.width = `${tableRect.width}px`;
                table.style.minWidth = '0'; // Allow it to be smaller than 100% if needed, or just lock it

                // 2. Lock all headers to their current sub-pixel widths
                const headCells = table.querySelectorAll('thead th');
                headCells.forEach(cell => {
                    cell.style.width = `${cell.getBoundingClientRect().width}px`;
                });
            }

            document.body.classList.add('resizing');
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        resizer.addEventListener('click', e => e.stopPropagation());
    }

    showContextMenu(e, item) {
        const old = document.querySelector('.custom-context-menu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.style.top = `${e.clientY}px`;
        menu.style.left = `${e.clientX}px`;

        const ops = [];

        if (item) {
            ops.push({ label: 'Edit Value', action: () => this.onEdit(item) });
            ops.push({ label: 'Properties...', action: () => this.showProperties(item) });
            if (this.onDuplicate) {
                ops.push({ label: 'Duplicate', action: () => this.onDuplicate(item) });
            }
            ops.push({ type: 'separator' });
            ops.push({ label: 'Copy Value', action: () => navigator.clipboard.writeText(typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)) });
            ops.push({ label: 'Export as File...', action: () => this.exportItemValue(item) });
            ops.push({ type: 'separator' });
            ops.push({ label: 'Delete', action: () => this.onDelete(item), danger: true });
        } else if (this.onAdd || this.extraContextItems.length > 0) {
            if (this.onAdd) {
                const label = (typeof this.onAdd === 'object') ? (this.onAdd.label || 'Add New Item') : 'Add New Item';
                const action = (typeof this.onAdd === 'object') ? this.onAdd.action : this.onAdd;
                ops.push({ label: label, action: () => action() });
            }

            if (this.extraContextItems.length > 0) {
                if (this.onAdd) ops.push({ type: 'separator' });
                this.extraContextItems.forEach(item => {
                    ops.push({ label: item.label, action: item.action });
                });
            }
        } else {
            // Minimum menu for empty space if no onAdd
            ops.push({ label: 'Empty Storage', enabled: false });
        }

        ops.forEach(op => {
            if (op.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                menu.appendChild(sep);
                return;
            }

            const div = document.createElement('div');
            div.className = 'context-menu-item';
            if (op.danger) div.classList.add('danger');
            if (op.enabled === false) div.style.opacity = '0.5';
            div.textContent = op.label;
            div.onclick = () => {
                if (op.enabled !== false) {
                    op.action();
                    menu.remove();
                }
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        const closeHandler = () => {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    showProperties(item) {
        // Simple Modal Implementation
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 2000;
            display: flex; justify-content: center; align-items: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: var(--bg-secondary); border: 1px solid var(--border-color);
            border-radius: 8px; width: 400px; max-width: 90%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            display: flex; flex-direction: column;
        `;

        // Calculate Size
        const keySize = item.name ? item.name.length : (item.key ? item.key.length : 0);
        const valSize = item.value ? String(item.value).length : 0;
        const totalSize = keySize + valSize;
        const sizeStr = totalSize > 1024 ? `${(totalSize / 1024).toFixed(2)} KB` : `${totalSize} Bytes`;

        // Content
        let rows = '';

        if (item.domain !== undefined) {
            const domainInputId = 'prop-domain-input';
            rows += `
                <tr>
                    <td style="color:var(--text-secondary);">Domain</td>
                    <td><input id="${domainInputId}" type="text" value="${item.domain}" style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:4px; border-radius:4px; width:100%;"></td>
                </tr>
            `;
            item._domainInputId = domainInputId;
        }

        if (item.path !== undefined) {
            const pathInputId = 'prop-path-input';
            rows += `
                <tr>
                    <td style="color:var(--text-secondary);">Path</td>
                    <td><input id="${pathInputId}" type="text" value="${item.path}" style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:4px; border-radius:4px; width:100%;"></td>
                </tr>
            `;
            item._pathInputId = pathInputId;
        }

        // Protocol/Secure Toggle (for cookies)
        let secureInputId = null;
        if (item.secure !== undefined) {
            secureInputId = 'prop-secure-check';
            rows += `
                <tr>
                    <td style="color:var(--text-secondary);">Secure (HTTPS)</td>
                    <td><input id="${secureInputId}" type="checkbox" ${item.secure ? 'checked' : ''}> <span style="font-size:11px; color:var(--text-secondary);">(Secure cookies only sent over HTTPS)</span></td>
                </tr>
            `;
        }

        // Date Handling
        let dateInputId = null;
        if (item.expirationDate !== undefined) {
            // Cookie Date is in Seconds usually, sometimes ms. Cookies API uses seconds.
            // item.expirationDate is what we get from chrome.cookies.
            // If missing/null -> Session cookie.

            if (item.expirationDate) {
                const d = new Date(item.expirationDate * 1000);
                // Format for datetime-local: YYYY-MM-DDThh:mm
                // Note: toISOString is UTC, we want local generally or handle TS offset.
                // let's use a small helper for local ISO
                const localIso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

                dateInputId = 'prop-exp-date';
                rows += `
                    <tr>
                        <td style="color:var(--text-secondary);">Expires</td>
                        <td>
                            <input id="${dateInputId}" type="datetime-local" value="${localIso}" 
                                style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:4px; border-radius:4px; width:100%;">
                        </td>
                    </tr>
                 `;
            } else {
                rows += `<tr><td style="color:var(--text-secondary);">Expires</td><td>Session (On Close)</td></tr>`;
            }
        }

        modal.innerHTML = `
            <div style="padding: 16px; border-bottom: 1px solid var(--border-color); font-weight: 600;">Item Properties</div>
            <div style="padding: 16px; overflow: hidden;">
                <table style="width:100%; border-collapse: separate; border-spacing: 0 8px; font-size:13px; table-layout: fixed;">
                    <colgroup>
                        <col style="width: 100px;">
                        <col style="width: auto;">
                    </colgroup>
                    <style>
                        .prop-val-cell {
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        }
                    </style>
                    <tbody>
                        <tr>
                            <td style="color:var(--text-secondary);">Key/Name</td>
                            <td>
                                <input id="prop-name-input" type="text" value="${(item.name || item.key).replace(/"/g, '&quot;')}" 
                                    style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:4px; border-radius:4px; width:100%;">
                            </td>
                        </tr>
                        <tr><td style="color:var(--text-secondary);">Size</td><td>${sizeStr}</td></tr>
                        ${rows}
                    </tbody>
                </table>
            </div>
            <div style="padding: 16px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 8px;">
                <button id="prop-cancel" style="padding: 6px 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="prop-save" style="display: none; padding: 6px 12px; border: 1px solid transparent; background: var(--accent-primary); color: #fff; border-radius: 4px; cursor: pointer;">Save</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Handlers
        overlay.querySelector('#prop-cancel').onclick = () => overlay.remove();

        const saveBtn = overlay.querySelector('#prop-save');
        if (saveBtn && this.onUpdate) {
            const showSave = () => { saveBtn.style.display = 'block'; };
            overlay.querySelectorAll('input').forEach(input => {
                input.oninput = showSave;
                input.onchange = showSave;
            });

            saveBtn.onclick = () => {
                let newItem = { ...item };
                let valid = true;

                // Handle Name/Key change
                const nameInput = overlay.querySelector('#prop-name-input');
                if (nameInput) {
                    const newName = nameInput.value;
                    if (item.name !== undefined) newItem.name = newName;
                    else if (item.key !== undefined) newItem.key = newName;
                }

                // Handle Date
                if (dateInputId) {
                    const input = overlay.querySelector(`#${dateInputId}`);
                    const newVal = new Date(input.value).getTime() / 1000;
                    if (!isNaN(newVal)) {
                        newItem.expirationDate = newVal;
                    } else {
                        valid = false;
                        alert('Invalid Date');
                    }
                }

                // Handle Secure
                if (secureInputId) {
                    newItem.secure = overlay.querySelector(`#${secureInputId}`).checked;
                }

                // Handle Editable Domain/Path
                if (item._domainInputId) {
                    newItem.domain = overlay.querySelector(`#${item._domainInputId}`).value;
                }
                if (item._pathInputId) {
                    newItem.path = overlay.querySelector(`#${item._pathInputId}`).value;
                }

                if (valid) {
                    this.onUpdate(newItem, item);
                    overlay.remove();
                }
            };
        }
    }

    async exportItemValue(item) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: (item.name || item.key || 'export') + '.txt',
                types: [{
                    description: 'Text/JSON File',
                    accept: { 'text/plain': ['.txt', '.json', '.js'] }
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value));
            await writable.close();
        } catch (e) {
            // Fallback for browsers without File System Access API
            if (e.name !== 'AbortError') {
                console.error('Export failed:', e);
                const blob = new Blob([typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value)], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (item.name || item.key || 'export') + '.txt';
                a.click();
                URL.revokeObjectURL(url);
            }
        }
    }
}

