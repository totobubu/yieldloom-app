export const cancelledRequest = () =>
    new DOMException('조회를 취소했습니다.', 'AbortError');

// Each caller owns its cancellation; the transport lives until the last caller leaves.
export function createSharedRequest(work) {
    const controller = new AbortController();
    const task = { controller, subscribers: 0, settled: false };
    task.promise = Promise.resolve()
        .then(() => {
            if (controller.signal.aborted) throw cancelledRequest();
            return work(controller.signal);
        })
        .finally(() => {
            task.settled = true;
        });
    return task;
}

export function joinSharedRequest(task, signal) {
    if (signal?.aborted) return Promise.reject(cancelledRequest());
    task.subscribers++;
    return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (callback, value) => {
            if (finished) return;
            finished = true;
            signal?.removeEventListener('abort', abort);
            task.subscribers--;
            callback(value);
        };
        const abort = () => {
            finish(reject, cancelledRequest());
            if (!task.subscribers && !task.settled) task.controller.abort();
        };
        signal?.addEventListener('abort', abort, { once: true });
        task.promise.then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error)
        );
    });
}
