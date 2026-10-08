const baseUrl = (import.meta.env.VITE_DATA_RELEASE_BASE_URL || '').replace(/\/$/, '');

const fetchJson = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 404 ? '승인된 data v2 릴리스가 아직 없습니다.' : `data v2 요청 실패 (${response.status})`);
  return response.json();
};

const mapEvent = (event) => ({
  id: event.eventId,
  provider_slug: event.provider,
  ticker: event.ticker,
  distribution_per_share: event.amount.raw,
  previous_amount: null,
  average4: null,
  average12: null,
  declared_date: event.declaredDate,
  ex_date: event.exDate,
  record_date: event.recordDate,
  payable_date: event.payableDate,
  frequency: event.frequency,
  verification_status: event.verificationStatus,
  official_url: event.source.url,
});

export const isDataReleaseConfigured = () => Boolean(baseUrl);

export async function loadDataReleaseIndex() {
  const pointer = await fetchJson(`${baseUrl}/yieldloom/v2/releases/current.json`);
  const manifest = await fetchJson(`${baseUrl}/${pointer.manifestKey}`);
  const index = await fetchJson(`${baseUrl}/${pointer.manifestKey.replace(/manifest\.json$/, manifest.indexPath)}`);
  return {
    releaseId: manifest.releaseId,
    providers: index.providers.map((slug) => ({ slug, displayName: slug })),
    tickers: index.tickers.map((row) => ({
      ticker: row.ticker,
      providerSlug: row.provider,
      latest: mapEvent(row.latest),
      historyUrl: `${baseUrl}/${pointer.manifestKey.replace(/manifest\.json$/, row.historyPath)}`,
      historyCount: row.historyCount,
    })),
  };
}

export async function loadDataReleaseHistory(url) {
  const payload = await fetchJson(url);
  return { ticker: payload.ticker, history: payload.events.map(mapEvent) };
}
