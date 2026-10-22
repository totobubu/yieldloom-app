# 기존 ISIN 누락 18건 검토

2026-10-22 검토한 18건은 모두 ISIN 누락이었다. 검토 전 활성은 TSYW 1건,
비활성은 17건이다. 비활성은 앱 제공 상태이며 상장폐지의 증거로 해석하지 않는다.
개별 근거·원래 시장/통화/활성 상태·판정은 `data-v2/identity-review.json`에 남겼다.

## 확정한 식별자

| 종목 | ISIN | 적용 |
| --- | --- | --- |
| TSYW | US77926X3952 | ISIN 보충, 활성 유지 |
| BRK.A | US0846701086 | ISIN 보충, 기존 비활성 유지 |

TSYW의 [공식 운용사 페이지](https://www.roundhillinvestments.com/etf/tsyw/)는
ISIN·CUSIP 77926X395와 Cboe BZX를 명시한다. Nasdaq의 Other Listed 원문도
TSYW의 Exchange=Z를 제공하며 [공식 필드 정의](https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs)는
Z를 BATS로 정의한다. 기존 BATS/USD를 유지한다.

BRK.A는 [거래소 ISIN](https://www.boerse-stuttgart.de/de-de/produkte/aktien/stuttgart/854075-berkshire-hathaway),
[SEC Class A 공시와 CUSIP 084670108](https://www.sec.gov/Archives/edgar/data/315090/000119312526304838/xslSCHEDULE_13D_X02/primary_doc.xml),
Nasdaq Other Listed의 BRK.A/NYSE 식별자를 대조했다. 독일 거래소의 EUR 가격이나
거래소 코드를 미국 종목에 복사하지 않는다.

두 정정은 기존 `identity-corrections.json`의 정확한 이전 값·시장·통화 조건을 재사용한다.
구 자료에서 ISIN이 비어 있어도 빌더가 보충하며, 활성 상태·개인 거래·별칭은 변경하지 않는다.

## 비활성 상태로 유지한 16건

| 종목 | 판정 |
| --- | --- |
| ABNW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| ASMW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| LMTW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| RDDW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| SHOW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| TSMW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| XOMW | 운용사 문서의 기호 확인, 현재 상장·ISIN 미확정 |
| CRWW | 운용사 문서는 CRWD, 구 이름은 CoreWeave 레버리지로 충돌 |
| DKNW | 운용사 문서는 Roundhill, 구 이름은 Defiance로 충돌 |
| IREM | IREN과 이름이 유사하나 시장·기호 불일치, 별칭 확정 불가 |
| QMZP | AMZP와 이름이 유사하나 기호 불일치, 별칭 확정 불가 |
| QRDO | CRDO와 이름이 유사하나 시장·기호 불일치, 별칭 확정 불가 |
| AS _ | 공백·코드 조각을 포함한 잘못된 기호 |
| FROM DJANGO.UTILS.TRANSLATION IMPORT DPSTTMF | 잘못된 기호, 두 종목으로 임의 분해하지 않음 |
| FROM DJANGO.UTILS.TRANSLATION IMPORT UGETTEXT_LAZY AS _NFLP | 잘못된 기호, 접미어를 별칭으로 추정하지 않음 |
| FROM DJANGO.UTILS.TRANSLATION IMPORT UGETTEXT_LAZY AS _SLV | 잘못된 기호, 접미어를 별칭으로 추정하지 않음 |

Roundhill 9건은 [2025-05-16 운용사 투자설명서](https://www.roundhillinvestments.com/assets/pdfs/roundhill_weeklypay_etfs_prospectus_2.pdf)와
[SAI](https://www.roundhillinvestments.com/assets/pdfs/roundhill_weeklypay_etfs_sai_2.pdf)의 기호·기초종목을 확인했다.
문서의 Cboe 설명은 기존 NASDAQ 값과 다르며 현재 상장 확인을 대체하지 않는다.
개별 페이지 접근 실패나 현재 디렉터리의 부재만으로 상장폐지를 선언하지 않는다.

검토 후 ISIN 누락은 **활성 0건·비활성 16건**이다. 품질 보고서에 두 수치를 별도로 제공한다.
16건을 확정된 투자 대상에 자동 편입하거나 개인 거래를 유사 종목으로 재연결하지 않는다.
