// src/utils/uiHelpers.js
const splitWeekdayTokens = (value) =>
    value
        .split(/[/,\s·]+/)
        .map((part) => part.trim())
        .filter(Boolean);

const normalizeGroupValue = (group) => {
    if (!group) return null;
    if (typeof group === 'string') {
        const tokens = splitWeekdayTokens(group);
        return tokens.length > 0 ? tokens[0] : null;
    }
    if (Array.isArray(group)) {
        const values = group
            .flatMap((value) =>
                typeof value === 'string' ? splitWeekdayTokens(value) : []
            )
            .filter(Boolean);
        if (values.length > 0) return values[0];
    } else if (typeof group === 'object') {
        const values = Object.values(group)
            .flatMap((value) =>
                typeof value === 'string' ? splitWeekdayTokens(value) : []
            )
            .filter(Boolean);
        if (values.length > 0) return values[0];
    }
    return null;
};

export const getGroupSeverity = (group) => {
    const primaryGroup = normalizeGroupValue(group);
    if (!primaryGroup) return 'secondary';
    switch (primaryGroup) {
        case '월':
            return 'mon';
        case '화':
            return 'tue';
        case '수':
            return 'wed';
        case '목':
            return 'thu';
        case '금':
            return 'fri';
        default:
            return 'secondary';
    }
};

export const extractWeekdayLabels = (group, group2) => {
    const labels = [];

    if (group2 && typeof group2 === 'object') {
        Object.values(group2).forEach((value) => {
            const label = typeof value === 'string' ? value.trim() : '';
            if (label) labels.push(label);
        });
    }

    if (Array.isArray(group)) {
        group.forEach((value) => {
            if (typeof value !== 'string') return;
            splitWeekdayTokens(value).forEach((token) => {
                if (!labels.includes(token)) labels.push(token);
            });
        });
    } else if (group && typeof group === 'object') {
        Object.values(group).forEach((value) => {
            if (typeof value !== 'string') return;
            splitWeekdayTokens(value).forEach((token) => {
                if (!labels.includes(token)) labels.push(token);
            });
        });
    } else if (group && typeof group === 'string') {
        splitWeekdayTokens(group).forEach((token) => {
            if (!labels.includes(token)) labels.push(token);
        });
    }

    return labels;
};
