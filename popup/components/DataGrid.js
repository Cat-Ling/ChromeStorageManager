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

        const table = document.createElement('table');
        table.className = 'data-grid-table';

        // Header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        this.columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.label;
            if (col.width) th.style.width = col.width;
            headerRow.appendChild(th);
        });

        // Remove explicit Actions column header
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = document.createElement('tbody');

        data.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'data-row'; // For hover effects

            // Context Menu Handler
            tr.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, item);
            });

            // Double click to edit value (common file manager behavior)
            tr.addEventListener('dblclick', () => {
                if (this.onEdit) this.onEdit(item);
            });

            this.columns.forEach(col => {
                const td = document.createElement('td');
                const val = item[col.key];

                // Use custom render if provided, else default stringification
                if (col.render) {
                    td.textContent = col.render(val, item);
                } else {
                    td.textContent = typeof val === 'object' ? JSON.stringify(val) : String(val);
                }

                td.title = String(val); // Tooltip
                tr.appendChild(td);
            });

            // No inline actions column
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        this.container.appendChild(table);
    }

    showContextMenu(e, item) {
        // Remove existing context menus
        const old = document.querySelector('.custom-context-menu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.style.top = `${e.clientY}px`;
        menu.style.left = `${e.clientX}px`;

        const ops = [
            { label: 'Edit Value', action: () => this.onEdit(item) },
            { label: 'Copy Value', action: () => navigator.clipboard.writeText(item.value) },
            { label: 'Export Value', action: () => this.exportItemValue(item) },
            { type: 'separator' },
            { label: 'Delete', action: () => this.onDelete(item), danger: true }
        ];

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
            div.textContent = op.label;
            div.onclick = () => {
                op.action();
                menu.remove();
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        // Close on click outside
        const closeHandler = () => {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        };
        // Delay slightly to avoid immediate trigger
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
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

