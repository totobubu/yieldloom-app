// Exercise the real Stitch shell navigation instead of the removed duplicate tab bars.
const targets = {
    '한눈에 보기': { label: '요약', tab: 'overview', view: 'summary' },
    요약: { label: '요약', tab: 'overview', view: 'summary' },
    '보유 종목': { label: '보유 종목', tab: 'overview', view: 'holdings' },
    '원금·자금': { label: '원금', tab: 'overview', view: 'capital' },
    '배당 캘린더': { label: '캘린더', tab: 'calendar' },
    '배당 분석': { label: '분석', tab: 'insights' },
    자산관리: { label: '자산 관리', tab: 'assets' },
};
export async function openPortfolioPage(page, name) {
    const target = targets[name];
    if (!target) throw Error(`Unknown portfolio page: ${name}`);
    await page.locator('.family-page').waitFor();
    await page
        .locator('.portfolio-loading-overlay')
        .waitFor({ state: 'hidden' });
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
    const sidebar = page.locator('.shell-submenu');
    if (await sidebar.isVisible())
        await sidebar
            .getByRole('link', { name: target.label, exact: true })
            .click();
    else {
        await page
            .getByRole('button', { name: '계정 및 설정', exact: true })
            .click();
        const drawer = page.locator('#account-drawer');
        await drawer.waitFor();
        await drawer
            .getByRole('link', { name: target.label, exact: true })
            .click();
        await drawer.waitFor({ state: 'hidden' });
    }
    if (!page.url().includes('/.tmp-capital-test.html'))
        await page.waitForURL(
            (url) =>
                (url.searchParams.get('tab') || 'overview') === target.tab &&
                (!target.view ||
                    (url.searchParams.get('view') || 'summary') === target.view)
        );
    await waitForPortfolioPage(page, name);
}
export async function waitForPortfolioPage(page, name) {
    const target = targets[name];
    if (!target) throw Error(`Unknown portfolio page: ${name}`);
    const views =
        name === '한눈에 보기'
            ? ['summary', 'holdings', 'capital']
            : [target.view || target.tab];
    await page.waitForFunction(
        (views) =>
            views.includes(
                document
                    .querySelector('.family-page')
                    ?.getAttribute('data-stitch-view')
            ),
        views
    );
}

export async function selectAssetOwner(page, name) {
    await page
        .getByRole('combobox', { name: '명의자 선택', exact: true })
        .click();
    const list = page.getByRole('listbox').last();
    await list
        .getByRole('option', { name, exact: typeof name === 'string' })
        .click();
    await list.waitFor({ state: 'hidden' });
}
