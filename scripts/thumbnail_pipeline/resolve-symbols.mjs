export const DEFAULT_SYMBOLS = 'AMDY,TSLY,TOPW,AAPL,TSLA';

function normalizeSymbolList(value) {
    return String(value ?? '')
        .split(',')
        .map((symbol) => symbol.replace(/\s/g, '').toUpperCase())
        .filter(Boolean);
}

function isAllSelection(symbols) {
    return symbols.length === 1 && symbols[0] === 'ALL';
}

export function resolveSymbols({
    inputSymbols = '',
    configuredSymbols = '',
    eventName = '',
}) {
    const explicit = eventName === 'workflow_dispatch'
        ? normalizeSymbolList(inputSymbols)
        : [];
    if (isAllSelection(explicit)) return 'ALL';
    if (explicit.length) return explicit.join(',');

    const configured = normalizeSymbolList(configuredSymbols);
    if (!configured.length || isAllSelection(configured)) return DEFAULT_SYMBOLS;
    return configured.join(',');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    console.log(resolveSymbols({
        inputSymbols: process.argv[2],
        configuredSymbols: process.argv[3],
        eventName: process.argv[4],
    }));
}
