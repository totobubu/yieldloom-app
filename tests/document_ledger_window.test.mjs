// Synthetic scroll geometry only: no browser, authentication or ledger writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, nextTick, ref } from 'vue';
import { useDocumentLedgerWindow } from '../src/composables/useDocumentLedgerWindow.js';

class Scroller extends EventTarget {
    scrollTop = 0;
    clientHeight = 600;
    listeners = new Set();
    addEventListener(type, listener, options) {
        if (type === 'scroll') this.listeners.add(listener);
        super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener) {
        if (type === 'scroll') this.listeners.delete(listener);
        super.removeEventListener(type, listener);
    }
    scrollTo({ top }) {
        this.scrollTop = Math.max(0, top);
        this.dispatchEvent(new Event('scroll'));
    }
    getBoundingClientRect() {
        return { top: 80 };
    }
}
const renderer = createRenderer({
    createComment: () => ({}),
    insert() {},
    remove() {},
    parentNode() {},
    nextSibling() {},
});
function setup(t, inDialog) {
    const originals = Object.fromEntries(
        [
            'window',
            'requestAnimationFrame',
            'cancelAnimationFrame',
            'ResizeObserver',
        ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
    );
    const win = new Scroller();
    Object.defineProperty(win, 'scrollY', { get: () => win.scrollTop });
    win.innerHeight = 600;
    const frames = new Map();
    let frameId = 0;
    globalThis.window = win;
    globalThis.requestAnimationFrame = (fn) => {
        frames.set(++frameId, fn);
        return frameId;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
    const observed = new Set();
    globalThis.ResizeObserver = class {
        observe(element) {
            observed.add(element);
            this.element = element;
        }
        disconnect() {
            observed.delete(this.element);
        }
    };
    const root = ref(inDialog ? new Scroller() : null);
    const region = ref({
        getClientRects: () => [1],
        getBoundingClientRect: () => ({
            top: (inDialog ? 80 : 0) + 300 - (root.value || win).scrollTop,
        }),
    });
    const table = ref({ querySelectorAll: () => [] });
    const rows = ref(
        Array.from({ length: 2285 }, (_, i) => ({ id: `synthetic:${i}` }))
    );
    let model;
    const app = renderer.createApp({
        setup() {
            model = useDocumentLedgerWindow(
                rows,
                region,
                table,
                inDialog ? root : null
            );
            return () => null;
        },
    });
    app.mount({});
    t.after(() => {
        app.unmount();
        assert.equal(win.listeners.size, 0);
        assert.equal(observed.size, 0);
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const flush = async () => {
        for (let n = 0; n < 5; n++) {
            await nextTick();
            const callbacks = [...frames.values()];
            frames.clear();
            for (const cb of callbacks) cb();
        }
    };
    return { model, win, root, region, table, rows, flush };
}
test('document scroll remains the default with a bounded row window', async (t) => {
    const s = setup(t, false);
    await s.flush();
    assert.equal(s.model.renderedRows.value.length, 100);
    s.win.scrollTo({ top: 12000 });
    await s.flush();
    assert(s.model.start.value > 0);
    await s.model.jump(true);
    await s.flush();
    assert.equal(s.model.renderedRows.value.at(-1).id, 'synthetic:2284');
});
test('dialog scrolling and jumps never move the background document', async (t) => {
    const s = setup(t, true);
    await s.flush();
    s.root.value.scrollTo({ top: 12000 });
    await s.flush();
    assert(s.model.start.value > 0);
    assert.equal(s.win.scrollTop, 0);
    assert.equal(s.model.renderedRows.value.length, 100);
    await s.model.jump(true);
    await s.flush();
    assert.equal(s.model.renderedRows.value.at(-1).id, 'synthetic:2284');
    assert.equal(s.win.scrollTop, 0);
    await s.model.jump(false);
    await s.flush();
    assert.equal(s.model.start.value, 0);
});
test('reopening a dialog detaches its old scroll listener', async (t) => {
    const s = setup(t, true);
    await s.flush();
    const previous = s.root.value;
    assert.equal(previous.listeners.size, 1);
    s.root.value = new Scroller();
    await s.flush();
    assert.equal(previous.listeners.size, 0);
    assert.equal(s.root.value.listeners.size, 1);
    previous.scrollTo({ top: 12000 });
    await s.flush();
    assert.equal(s.model.start.value, 0);
    s.root.value.scrollTo({ top: 12000 });
    await s.flush();
    assert(s.model.start.value > 0);
});
test('local filtering resets the range without changing source rows', async (t) => {
    const s = setup(t, true);
    await s.flush();
    s.rows.value = s.rows.value.slice(0, 3);
    await s.flush();
    assert.equal(s.model.renderedRows.value.length, 3);
    assert.equal(s.model.start.value, 0);
    assert.equal(s.model.paddingBottom.value, 0);
});
