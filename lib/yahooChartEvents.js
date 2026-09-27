// chart/v8 uses timestamp-keyed objects, not only arrays.
export const eventValues = (events) => Array.isArray(events) ? events : Object.values(events || {});
