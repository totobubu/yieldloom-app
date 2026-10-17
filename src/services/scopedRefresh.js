// Share only active refreshes, never completed private responses.
export function createScopedRefresh({ getScope, load }) {
    let active;
    const invalidate = () => {
        active?.controller.abort();
        active = undefined;
    };
    function refresh() {
        const scope = getScope();
        if (
            active &&
            scope.length === active.scope.length &&
            scope.every((value, i) => Object.is(value, active.scope[i]))
        )
            return active.promise;
        invalidate();
        const current = { scope, controller: new AbortController() };
        active = current;
        current.promise = Promise.resolve()
            .then(() =>
                load({
                    scope,
                    signal: current.controller.signal,
                    isCurrent: () =>
                        active === current &&
                        !current.controller.signal.aborted &&
                        getScope().every((value, i) =>
                            Object.is(value, scope[i])
                        ),
                })
            )
            .finally(() => {
                if (active === current) active = undefined;
            });
        return current.promise;
    }
    refresh.invalidate = invalidate;
    return refresh;
}
