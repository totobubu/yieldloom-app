// Development review entry only. Vite's application build does not include it.
import inventory from '../docs/design/stitch-v2/mapping.json';
const originals = import.meta.glob(
    '../docs/design/stitch-v2/originals/**/*.html',
    {
        query: '?raw',
        import: 'default',
    }
);
const select = document.querySelector('#screen');
const viewport = document.querySelector('#viewport');
const frame = document.querySelector('#reference');
const status = document.querySelector('#status');
for (const screen of inventory.screens) {
    const option = document.createElement('option');
    option.value = screen.screenId;
    option.textContent = `${screen.title} · ${screen.screenId}`;
    select.append(option);
}
let version = 0;
async function show() {
    const current = ++version;
    const screen = inventory.screens.find(
        (item) => item.screenId === select.value
    );
    const loader = originals[`../docs/design/stitch-v2/${screen.originalHtml}`];
    const html = await loader();
    if (current !== version) return;
    frame.width = viewport.value;
    frame.srcdoc = html;
    status.textContent = `${screen.screenId} · ${screen.implementationStatus} · 원본의 미완성 상태와 더미 동작 포함`;
    history.replaceState(null, '', `#${screen.screenId}/${viewport.value}`);
}
select.addEventListener('change', show);
viewport.addEventListener('change', show);
const [initial, width] = location.hash.slice(1).split('/');
if (inventory.screens.some((screen) => screen.screenId === initial))
    select.value = initial;
if (['1280', '768', '390'].includes(width)) viewport.value = width;
await show();
