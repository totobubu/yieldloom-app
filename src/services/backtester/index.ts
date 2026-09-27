// src/services/backtester/index.ts

export { runBacktest } from './engine';
export { runSimulation } from './simulator';
export { aggregateResults } from './aggregator';
export { processSymbolData } from './dataProcessor';
export { calculateCAGR, addBusinessDays } from './utils';

export type { BacktestOptions, ApiData, ExchangeRate, SymbolBacktestResult } from './engine';
export type { SimulationOptions, SimulationResult, DividendPayout } from './simulator';
export type { AggregatedResult, PortfolioItem, SeriesData, Summary, AggregateOptions, SimulationResultWithMeta } from './aggregator';
export type { SymbolData, ProcessedData } from './dataProcessor';
