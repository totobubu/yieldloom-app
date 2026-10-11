import YahooFinance from 'yahoo-finance2';

// v2 exports a ready-to-use client object.  Older revisions instantiated the
// default export, which breaks at module load with current v2 releases.
const yahooFinance = YahooFinance;

export default yahooFinance;
