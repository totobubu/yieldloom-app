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

## 공식 목록 재대조와 다음 확인 조건

같은 날 공식 Nasdaq 두 디렉터리를 다시 받아 **16개 원래 기호의 정확한 일치 0건**을
확인했다. 두 파일 모두 생성 표시는 `1022202610:01`이다. 이는 해당 파일의 관측이며,
상장폐지나 영구적인 기호 부재의 증거는 아니다. 검토 시각·원문 SHA-256·파일 크기와
종목별 결과는 [재대조 기록](../../data-v2/identity-directory-review.json)에 남겼다.

IREN·AMZP·CRDO의 공식 목록 존재는 확인했다. 이들이 IREM·QMZP·QRDO의 별칭이라는
근거는 확보하지 못했다. 각 후보의 공식 이름·거래소 코드를 검토 기록에만 남기고 매핑하지 않았다.
Roundhill 투자설명서와 SAI도 재확보했지만 ISIN/CUSIP을 제공하지 않아 정정은 추가하지 않았다.

| 재확보 문서 | SHA-256 |
| --- | --- |
| 위 투자설명서 | `0f2e528cd8fb7c6a1198704bdd539a5e29853ff5aea4eb5d56ae2d211822f6fd` |
| 위 SAI | `f719c22138cd7d7a59af9ba2e4e854e46ebcc6c5d4684de4bb59bb0b9504ea7c` |

`identity-review.json`의 미확정 건마다 `requiredEvidence`를 추가했다. 예정 펀드는 공식
현재 상장과 식별자, 이름 충돌은 원본 자료의 상품 식별자, 오타 후보와 코드 조각은
원래 증권사·공급자 행이 필요하다. 이 근거를 확보하기 전까지 비활성과 기존 이력을 유지한다.

다음 재점검은 이미 수집한 공식 파일을 재사용하며 추가 외부 요청 없이 실행할 수 있다.

```sh
python scripts/data_v2/review_identity_directory.py \
  --nasdaq-listed var/identity-review/nasdaqlisted.txt \
  --other-listed var/identity-review/otherlisted.txt \
  --output var/identity-review/result.json
```

공용 Nasdaq 파서를 재사용하고 두 디렉터리가 모두 완전한지 확인한다. 새 정확 일치가
발견돼도 수동 검토 대상으로만 표시하며 ISIN·별칭·활성 상태를 자동 변경하지 않는다.
이 명령은 수집기·스케줄을 추가하지 않는다. 원문 전체를 Git이나 공개 앱에 배포하지 않는다.
