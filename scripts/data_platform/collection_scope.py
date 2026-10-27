"""Fixed acceptance scope; expanding it requires reviewed routes, not ticker guessing."""
TARGETS = frozenset({'AAPL','MSFT','NVDA','BAC','SCHD','IVV','TSLY','TOPW'})
# Product URLs already supported by the issuer adapters/catalog fixtures.
FUND_ROUTES = {
    'TSLY': ('yieldmax','https://yieldmaxetfs.com/our-etfs/tsly/'),
    'SCHD': ('schwab','https://www.schwabassetmanagement.com/products/schd'),
    'IVV': ('ishares','https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf'),
    'TOPW': ('roundhill','https://www.roundhillinvestments.com/etf/topw/'),
}
