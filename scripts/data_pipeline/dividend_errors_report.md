# 배당 Amount 오류 검출 리포트

**생성 일시**: 2025-12-20 13:25:03

## 📊 전체 통계

- **총 파일 수**: 3,513
- **배당 데이터 보유 파일**: 2,789
- **Split 이력 보유 파일**: 793
- **amountOriginal 보유 파일**: 703
- **amountFixed 보유 파일**: 160

## 🔍 오류 검출 결과

### Level 1: amountFixed vs amount 불일치 ⚠️ **HIGH PRIORITY**

**검출 건수**: 471건

이 오류는 **가장 확실한 오류**입니다. `amountFixed`는 실제 받은 배당 금액이므로, `amount`와 차이가 나는 경우 `amount`를 수정해야 합니다.

| Symbol | Market | Date | amount | amountFixed | Difference | Relative % | Severity |
|--------|--------|------|--------|-------------|------------|------------|----------|
| MRNY | NYSE | 2025-10-30 | 0.32 | 0.0315 | 0.2885 | 915.87% | HIGH |
| CRSH | NYSE | 2025-11-06 | 0.33 | 0.0326 | 0.2974 | 912.27% | HIGH |
| CONY | NYSE | 2025-11-20 | 0.64 | 0.0635 | 0.5765 | 907.87% | HIGH |
| MRNY | NYSE | 2025-11-13 | 0.26 | 0.0258 | 0.2342 | 907.75% | HIGH |
| FIAT | NYSE | 2025-11-28 | 0.69 | 0.0685 | 0.6215 | 907.3% | HIGH |
| AIYY | NYSE | 2025-10-23 | 0.29 | 0.0288 | 0.2612 | 906.94% | HIGH |
| ULTY | NYSE | 2025-11-12 | 0.63 | 0.0626 | 0.5674 | 906.39% | HIGH |
| CONY | NYSE | 2025-11-28 | 0.66 | 0.0656 | 0.5944 | 906.1% | HIGH |
| FIAT | NYSE | 2025-10-23 | 0.52 | 0.0517 | 0.4683 | 905.8% | HIGH |
| ULTY | NYSE | 2025-06-20 | 0.88 | 0.0875 | 0.7925 | 905.71% | HIGH |
| CRSH | NYSE | 2025-11-13 | 0.56 | 0.0557 | 0.5043 | 905.39% | HIGH |
| ULTY | NYSE | 2025-06-05 | 0.95 | 0.0945 | 0.8555 | 905.29% | HIGH |
| CRSH | NYSE | 2025-10-23 | 0.4 | 0.0398 | 0.3602 | 905.03% | HIGH |
| ULTY | NYSE | 2025-03-13 | 1.03 | 0.1025 | 0.9275 | 904.88% | HIGH |
| ULTY | NYSE | 2025-07-17 | 1.04 | 0.1035 | 0.9365 | 904.83% | HIGH |
| ULTY | NYSE | 2025-04-24 | 0.84 | 0.0836 | 0.7564 | 904.78% | HIGH |
| MRNY | NYSE | 2025-11-06 | 0.22 | 0.0219 | 0.1981 | 904.57% | HIGH |
| FIAT | NYSE | 2025-11-20 | 0.68 | 0.0677 | 0.6123 | 904.43% | HIGH |
| ULTY | NYSE | 2025-04-03 | 0.92 | 0.0916 | 0.8284 | 904.37% | HIGH |
| ULTY | NYSE | 2025-09-18 | 0.93 | 0.0926 | 0.8374 | 904.32% | HIGH |
| DIPS | NYSE | 2025-10-30 | 0.47 | 0.0468 | 0.4232 | 904.27% | HIGH |
| ULTY | NYSE | 2025-05-01 | 0.94 | 0.0936 | 0.8464 | 904.27% | HIGH |
| MRNY | NYSE | 2025-08-14 | 0.95 | 0.0946 | 0.8554 | 904.23% | HIGH |
| MRNY | NYSE | 2025-05-22 | 1.22 | 0.1215 | 1.0985 | 904.12% | HIGH |
| ULTY | NYSE | 2025-03-27 | 0.99 | 0.0986 | 0.8914 | 904.06% | HIGH |
| ULTY | NYSE | 2025-08-14 | 1.01 | 0.1006 | 0.9094 | 903.98% | HIGH |
| MRNY | NYSE | 2025-09-11 | 0.76 | 0.0757 | 0.6843 | 903.96% | HIGH |
| CONY | NYSE | 2025-10-30 | 1.35 | 0.1345 | 1.2155 | 903.72% | HIGH |
| DIPS | NYSE | 2025-11-13 | 0.87 | 0.0867 | 0.7833 | 903.46% | HIGH |
| DIPS | NYSE | 2025-10-16 | 0.59 | 0.0588 | 0.5312 | 903.4% | HIGH |
| CONY | NYSE | 2025-11-06 | 0.89 | 0.0887 | 0.8013 | 903.38% | HIGH |
| CRSH | NYSE | 2025-10-02 | 1.24 | 0.1236 | 1.1164 | 903.24% | HIGH |
| ULTY | NYSE | 2025-03-20 | 0.98 | 0.0977 | 0.8823 | 903.07% | HIGH |
| FIAT | NYSE | 2025-06-26 | 1.54 | 0.1536 | 1.3864 | 902.6% | HIGH |
| AIYY | NYSE | 2025-08-28 | 1.18 | 0.1177 | 1.0623 | 902.55% | HIGH |
| ULTY | NYSE | 2025-11-05 | 0.79 | 0.0788 | 0.7112 | 902.54% | HIGH |
| ULTY | NYSE | 2025-10-29 | 0.85 | 0.0848 | 0.7652 | 902.36% | HIGH |
| DIPS | NYSE | 2025-07-17 | 1.72 | 0.1716 | 1.5484 | 902.33% | HIGH |
| ULTY | NYSE | 2025-10-15 | 0.91 | 0.0908 | 0.8192 | 902.2% | HIGH |
| ULTY | NYSE | 2025-09-11 | 0.93 | 0.0928 | 0.8372 | 902.16% | HIGH |
| ULTY | NYSE | 2025-07-31 | 1.01 | 0.1008 | 0.9092 | 901.98% | HIGH |
| CRSH | NYSE | 2025-07-10 | 2.16 | 0.2156 | 1.9444 | 901.86% | HIGH |
| FIAT | NYSE | 2025-10-16 | 1.12 | 0.1118 | 1.0082 | 901.79% | HIGH |
| DIPS | NYSE | 2025-08-14 | 1.79 | 0.1787 | 1.6113 | 901.68% | HIGH |
| MRNY | NYSE | 2025-03-27 | 1.83 | 0.1827 | 1.6473 | 901.64% | HIGH |
| AIYY | NYSE | 2025-05-08 | 3.25 | 0.3245 | 2.9255 | 901.54% | HIGH |
| FIAT | NYSE | 2025-08-21 | 2.69 | 0.2686 | 2.4214 | 901.49% | HIGH |
| AIYY | NYSE | 2024-05-06 | 4.08 | 0.4075 | 3.6725 | 901.23% | HIGH |
| CRSH | NYSE | 2025-10-16 | 0.88 | 0.0879 | 0.7921 | 901.14% | HIGH |
| FIAT | NYSE | 2025-05-29 | 2.67 | 0.2667 | 2.4033 | 901.12% | HIGH |

... 외 421건 더 있음


### Level 2: Split 조정 오류 ⚠️ **MEDIUM PRIORITY**

**검출 건수**: 19639건

`amountOriginal`과 split 비율로 계산한 예상 `amount`와 실제 `amount`가 5% 이상 차이나는 경우입니다.

| Symbol | Market | Date | amount | Expected | amountOriginal | Split Ratio | Diff % | Severity |
|--------|--------|------|--------|----------|----------------|-------------|--------|----------|
| 001440 | KOSDAQ | 2006-12-27 | 119063 | 0.0008 | 0.001556 | 2.0 | 15303727406.43% | HIGH |
| 001440 | KOSDAQ | 2007-12-27 | 119063 | 0.0008 | 0.001556 | 2.0 | 15303727406.43% | HIGH |
| 001440 | KOSDAQ | 2008-12-29 | 119063 | 0.0008 | 0.001556 | 2.0 | 15303727406.43% | HIGH |
| AIG | NYSE | 2000-08-30 | 0.74 | 0.0 | 0.00185 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2000-11-29 | 0.74 | 0.0 | 0.00185 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2001-02-28 | 0.74 | 0.0 | 0.00185 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2001-05-30 | 0.74 | 0.0 | 0.00185 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2001-08-07 | 0.84 | 0.0 | 0.0021 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2001-12-05 | 0.84 | 0.0 | 0.0021 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2002-02-27 | 0.84 | 0.0 | 0.0021 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2002-06-05 | 0.86 | 0.0 | 0.00215 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2002-09-04 | 0.94 | 0.0 | 0.00235 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2002-12-04 | 0.96 | 0.0 | 0.0024 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2003-03-05 | 0.94 | 0.0 | 0.00235 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2003-06-04 | 0.94 | 0.0 | 0.00235 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2003-09-03 | 1.3 | 0.0 | 0.00325 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2003-12-03 | 1.3 | 0.0 | 0.00325 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2004-03-03 | 1.3 | 0.0 | 0.00325 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2004-06-02 | 1.5 | 0.0001 | 0.00375 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2004-09-01 | 1.5 | 0.0001 | 0.00375 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2004-12-01 | 1.5 | 0.0001 | 0.00375 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2005-03-02 | 2.5 | 0.0001 | 0.00625 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2005-06-01 | 2.5 | 0.0001 | 0.00625 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2005-08-31 | 3 | 0.0001 | 0.0075 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2005-11-30 | 3 | 0.0001 | 0.0075 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2006-03-01 | 3 | 0.0001 | 0.0075 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2006-05-31 | 3 | 0.0001 | 0.0075 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2006-08-30 | 3.3 | 0.0001 | 0.00825 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2006-11-29 | 3.3 | 0.0001 | 0.00825 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2007-02-28 | 3.3 | 0.0001 | 0.00825 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2007-05-30 | 3.3 | 0.0001 | 0.00825 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2007-09-05 | 4 | 0.0001 | 0.01 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2007-12-05 | 4 | 0.0001 | 0.01 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2008-03-05 | 4 | 0.0001 | 0.01 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2008-06-04 | 4 | 0.0001 | 0.01 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 2008-09-03 | 4.4 | 0.0002 | 0.011 | 69.52 | 2780814.31% | HIGH |
| AIG | NYSE | 1999-09-01 | 0.666667 | 0.0001 | 0.00375 | 46.35 | 823875.02% | HIGH |
| AIG | NYSE | 1999-11-30 | 0.666667 | 0.0001 | 0.00375 | 46.35 | 823875.02% | HIGH |
| AIG | NYSE | 2000-03-01 | 0.666667 | 0.0001 | 0.00375 | 46.35 | 823875.02% | HIGH |
| AIG | NYSE | 2000-05-31 | 0.666667 | 0.0001 | 0.00375 | 46.35 | 823875.02% | HIGH |
| AIG | NYSE | 1999-03-03 | 0.597333 | 0.0001 | 0.00525 | 37.08 | 421774.76% | HIGH |
| AIG | NYSE | 1999-06-02 | 0.597333 | 0.0001 | 0.00525 | 37.08 | 421774.76% | HIGH |
| AIG | NYSE | 1998-09-02 | 0.618667 | 0.0001 | 0.005438 | 37.08 | 421736.44% | HIGH |
| AIG | NYSE | 1998-12-02 | 0.618667 | 0.0001 | 0.005438 | 37.08 | 421736.44% | HIGH |
| MSI | NYSE | 2004-12-13 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |
| MSI | NYSE | 2005-03-11 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |
| MSI | NYSE | 2005-06-13 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |
| MSI | NYSE | 2005-09-13 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |
| MSI | NYSE | 2005-12-13 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |
| MSI | NYSE | 2006-03-13 | 0.1617 | 0.0 | 0.009895 | 241.34 | 394289.13% | HIGH |

... 외 19589건 더 있음


### Level 3: 시계열 이상치 ℹ️ **LOW PRIORITY**

**검출 건수**: 13372건

연속된 배당 간 50% 이상 급격한 변화가 있는 경우입니다. 정상적인 배당 증가/감소일 수도 있으므로 수동 확인이 필요합니다.

| Symbol | Market | Date | Prev Date | amount | Prev amount | Change % | Severity |
|--------|--------|------|-----------|--------|-------------|----------|----------|
| PDBC | NYSE | 2021-12-03 | 2020-12-21 | 5.39 | 0.001 | 538900.0% | MEDIUM |
| EWC | NYSE | 2000-08-24 | 1999-12-21 | 5.057 | 0.004 | 126325.0% | MEDIUM |
| SILJ | NYSE | 2024-12-30 | 2023-12-27 | 0.721 | 0.001 | 72000.0% | MEDIUM |
| WY | NYSE | 2010-07-20 | 2010-04-28 | 26.42 | 0.05 | 52740.0% | MEDIUM |
| PRNT | NASDAQ | 2017-12-27 | 2016-12-28 | 0.527 | 0.001 | 52600.0% | MEDIUM |
| EWG | NYSE | 2024-06-11 | 2023-12-20 | 0.758 | 0.002 | 37800.0% | MEDIUM |
| FTGC | NYSE | 2022-12-15 | 2022-06-24 | 2.528 | 0.007 | 36014.29% | MEDIUM |
| FIS | NYSE | 2008-07-03 | 2008-06-11 | 16.5 | 0.05 | 32900.0% | MEDIUM |
| DFIP | NYSE | 2021-12-16 | 2021-11-23 | 0.279 | 0.001 | 27800.0% | MEDIUM |
| COMB | NYSE | 2021-12-30 | 2020-12-30 | 4.061 | 0.016 | 25281.25% | MEDIUM |
| BITU | NYSE | 2025-02-03 | 2024-12-23 | 1.214 | 0.005 | 24180.0% | MEDIUM |
| PGR | NYSE | 2007-08-29 | 2006-12-06 | 2 | 0.009 | 22122.22% | MEDIUM |
| VNM | NYSE | 2023-12-18 | 2022-12-28 | 0.655 | 0.003 | 21733.33% | MEDIUM |
| DRN | NYSE | 2017-12-19 | 2012-12-18 | 0.209 | 0.001 | 20800.0% | MEDIUM |
| TMO | NYSE | 2001-08-09 | 1996-01-25 | 0.82 | 0.004 | 20400.0% | MEDIUM |
| HTUS | NYSE | 2016-12-20 | 2016-08-03 | 0.773 | 0.004 | 19225.0% | MEDIUM |
| SPXL | NYSE | 2017-12-13 | 2010-09-22 | 1.604 | 0.0085 | 18770.59% | MEDIUM |
| VOE | NYSE | 2012-12-24 | 2012-03-22 | 1.13 | 0.006 | 18733.33% | MEDIUM |
| VB | NYSE | 2014-12-22 | 2014-03-25 | 1.664 | 0.009 | 18388.89% | MEDIUM |
| KDP | NASDAQ | 2018-07-10 | 2018-03-20 | 103.75 | 0.58 | 17787.93% | MEDIUM |
| VBR | NYSE | 2011-12-23 | 2011-03-23 | 1.372 | 0.008 | 17050.0% | MEDIUM |
| WEBL | NYSE | 2021-12-09 | 2019-12-23 | 3.051 | 0.018 | 16850.0% | MEDIUM |
| EFX | NYSE | 2001-07-09 | 2001-05-23 | 15 | 0.093 | 16029.03% | MEDIUM |
| VBR | NYSE | 2005-12-27 | 2005-03-21 | 1.256 | 0.008 | 15600.0% | MEDIUM |
| VB | NYSE | 2011-12-23 | 2011-03-23 | 0.94 | 0.006 | 15566.67% | MEDIUM |
| EMCS | NYSE | 2019-12-18 | 2019-12-06 | 0.768 | 0.005 | 15260.0% | MEDIUM |
| VBK | NYSE | 2012-12-24 | 2012-03-22 | 0.917 | 0.006 | 15183.33% | MEDIUM |
| VO | NYSE | 2012-12-24 | 2012-03-22 | 1.154 | 0.008 | 14325.0% | MEDIUM |
| VOE | NYSE | 2011-12-23 | 2011-03-23 | 1.129 | 0.008 | 14012.5% | MEDIUM |
| ACWX | NYSE | 2009-06-23 | 2008-12-29 | 0.551 | 0.004 | 13675.0% | MEDIUM |

... 외 13342건 더 있음


### Level 4: amountFixed 누락 ℹ️ **INFO**

**검출 건수**: 698건

`amountOriginal`은 있지만 `amountFixed`가 없는 종목입니다. Split 이후 실제 받은 배당 금액이 기록되지 않았습니다.

| Symbol | Market | Splits | Dividends | File |
|--------|--------|--------|-----------|------|
| ADM | NYSE | 26 | 171 | `C:\workspace\divgrow\public\data\nyse\adm.json` |
| 008930 | KOSDAQ | 16 | 15 | `C:\workspace\divgrow\public\data\kosdaq\008930.json` |
| 006730 | KOSDAQ | 16 | 8 | `C:\workspace\divgrow\public\data\kosdaq\006730.json` |
| 000100 | KOSDAQ | 15 | 15 | `C:\workspace\divgrow\public\data\kosdaq\000100.json` |
| 068270 | KOSDAQ | 15 | 9 | `C:\workspace\divgrow\public\data\kosdaq\068270.json` |
| 128940 | KOSDAQ | 14 | 10 | `C:\workspace\divgrow\public\data\kosdaq\128940.json` |
| HBAN | NASDAQ | 13 | 162 | `C:\workspace\divgrow\public\data\nasdaq\hban.json` |
| HD | NYSE | 13 | 153 | `C:\workspace\divgrow\public\data\nyse\hd.json` |
| AIG | NYSE | 13 | 148 | `C:\workspace\divgrow\public\data\nyse\aig.json` |
| 084370 | KOSDAQ | 13 | 18 | `C:\workspace\divgrow\public\data\kosdaq\084370.json` |
| 060250 | KOSDAQ | 13 | 14 | `C:\workspace\divgrow\public\data\kosdaq\060250.json` |
| CMCSA | NASDAQ | 12 | 118 | `C:\workspace\divgrow\public\data\nasdaq\cmcsa.json` |
| LUV | NYSE | 11 | 173 | `C:\workspace\divgrow\public\data\nyse\luv.json` |
| 023160 | KOSDAQ | 11 | 18 | `C:\workspace\divgrow\public\data\kosdaq\023160.json` |
| HON | NASDAQ | 10 | 255 | `C:\workspace\divgrow\public\data\nasdaq\hon.json` |
| GE | NYSE | 10 | 255 | `C:\workspace\divgrow\public\data\nyse\ge.json` |
| WMT | NYSE | 10 | 206 | `C:\workspace\divgrow\public\data\nyse\wmt.json` |
| AFL | NYSE | 10 | 166 | `C:\workspace\divgrow\public\data\nyse\afl.json` |
| WRB | NYSE | 10 | 163 | `C:\workspace\divgrow\public\data\nyse\wrb.json` |
| BEN | NYSE | 10 | 158 | `C:\workspace\divgrow\public\data\nyse\ben.json` |
| FITB | NASDAQ | 10 | 157 | `C:\workspace\divgrow\public\data\nasdaq\fitb.json` |
| ROL | NYSE | 10 | 155 | `C:\workspace\divgrow\public\data\nyse\rol.json` |
| PAYX | NASDAQ | 10 | 148 | `C:\workspace\divgrow\public\data\nasdaq\payx.json` |
| C | NYSE | 10 | 148 | `C:\workspace\divgrow\public\data\nyse\c.json` |
| DHI | NYSE | 10 | 114 | `C:\workspace\divgrow\public\data\nyse\dhi.json` |
| TSM | NYSE | 10 | 42 | `C:\workspace\divgrow\public\data\nyse\tsm.json` |
| 068760 | KOSDAQ | 10 | 1 | `C:\workspace\divgrow\public\data\kosdaq\068760.json` |
| MSI | NYSE | 9 | 246 | `C:\workspace\divgrow\public\data\nyse\msi.json` |
| PCAR | NASDAQ | 9 | 186 | `C:\workspace\divgrow\public\data\nasdaq\pcar.json` |
| MCD | NYSE | 9 | 176 | `C:\workspace\divgrow\public\data\nyse\mcd.json` |

... 외 668건 더 있음


## 📋 다음 단계

### 1. Level 1 오류 수정 (우선순위 높음)
- `amount`를 `amountFixed` 값으로 교체
- `amountOriginal`이 없다면 기존 `amount`를 백업

### 2. Level 2 오류 검토
- Split 비율이 정확한지 확인
- 필요시 `amount` 재계산

### 3. Level 3 이상치 수동 확인
- 실제 배당 변화인지 데이터 오류인지 확인

### 4. Level 4 정보성
- 향후 `amountFixed` 데이터 수집 필요

## 🔧 수정 스크립트 실행

Level 1 오류를 자동으로 수정하려면:
```bash
python scripts/data_pipeline/fix_dividend_errors.py --level1
```

---

*본 리포트는 자동으로 생성되었습니다. 수정 전 반드시 수동 확인이 필요합니다.*
