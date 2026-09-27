# 신규 심볼 온보딩 스크립트 가이드 (`add_new_symbols.py`)

`python scripts/utils/add_new_symbols.py --symbol {{심볼}}` 명령 하나로 신규 티커를 빠르게 추가하는 방법을 정리했습니다. 이 스크립트는 기존 수동 단계(시장 판별 → ISIN 입력 → IPO 날짜 확인 → nav/data 업데이트 → info 파이프라인)를 자동화하여 **한 티커 기준 몇 분 내**에 준비가 끝나도록 설계되었습니다.

---

## 1. 사전 준비

- Node.js / Python 의존성이 설치되어 있어야 합니다. (`npm install`, `pip install -r requirements-workflow.txt`)
- PowerShell/터미널에서 **프로젝트 루트(`totobubu.github.io`)** 위치로 이동합니다.
- Git 워크트리가 깨끗한지 확인하면 추후 변경 사항 추적이 편합니다.

---

## 2. 빠른 시작

```bash
python -m pip install -r requirements-workflow.txt

python scripts/utils/add_new_symbols.py --symbol YMAX
```

- 여러 심볼을 한 번에 처리하고 싶다면 `--symbol` 옵션을 반복해서 넘깁니다.
    ```bash
    python scripts/utils/add_new_symbols.py --symbol TPAY --symbol GIF
    ```

### 인터랙티브 입력 없이 실행하기 (CLI 미리 전달)

ISIN, 시장, ETF 여부 등을 커맨드라인에서 미리 전달하면 터미널 입력 없이 자동으로 실행됩니다.

```bash
python scripts/utils/add_new_symbols.py `
    --symbol MINY --symbol GIF `
    --isin TPAY:US1234567890AB --isin GIF:US9876543210AB `
    --market TPAY:NASDAQ --market GIF:NYSE `
    --etf TPAY `
    --company "TPAY:YieldMax" `
    --underlying TPAY:TSLA `
    --ko-name "TPAY:트리플포인트" --ko-name "GIF:GIF"
```

> 심볼이 하나일 때는 `SYMBOL:` 접두사를 생략할 수 있습니다.
>
> ```bash
> python scripts/utils/add_new_symbols.py --symbol XEY --isin US38747T6588 --market BATS --etf XEY --ko-name "그래닛셰어즈 일드부스트 이더리움 ETF" --underlying Ether --company GraniteShares
> ```
>
> TMYY MUYY
> | 옵션 | 형식 | 설명 |
> | -------------- | --------------- | -------------------------------------------------------------- |
> | `--isin` | `SYMBOL:ISIN` | 12자리 ISIN (예: `TPAY:US1234567890AB`) |
> | `--market` | `SYMBOL:MARKET` | 시장 (NASDAQ / NYSE / NYSEARCA / BATS / AMEX / KOSPI / KOSDAQ) |
> | `--etf` | `SYMBOL` | ETF로 표시 (예: `--etf TPAY`) |
> | `--company` | `SYMBOL:NAME` | 운용사명 (예: `TPAY:YieldMax`) |
> | `--underlying` | `SYMBOL:TICKER` | 기초자산 심볼 (예: `TPAY:TSLA`) |
> | `--ko-name` | `SYMBOL:NAME` | 한국어 종목명 (예: `"GIF:글로벌 X"`) |

- 주요 옵션
    - `--skip-workflow`: nav/data 갱신까지만 수행하고 통합 워크플로우는 건너뜁니다.
    - `--skip-format`: 마지막 포맷팅 단계만 생략합니다.
    - `--dry-run`: 실제 파일 수정 없이 실행 계획만 출력합니다.

---

## 3. 단계별 동작

| 순서 | 설명                 | 상세                                                                                                                                           |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | ISIN/심볼 정규화     | `fetch_missing_isin.py` 로직을 그대로 호출. 자동 조회 실패 시 터미널에서 심볼/ISIN을 직접 입력 가능                                            |
| 2    | IPO 날짜 확인        | Yahoo Finance chart API (`firstTradeDate`) 활용. 값이 없으면 YYYY-MM-DD 형식으로 수동 입력                                                     |
| 3    | nav 소스 업데이트    | `public/nav/{market}/{첫글자}.json`에 `symbol`, `ipoDate` upsert                                                                               |
| 4    | data 파일 생성       | `public/data/{symbol}.json`이 없으면 기본 스켈레톤 생성 후 `tickerInfo`에 market/currency/ISIN/업데이트 시간 저장                              |
| 5    | 로컬 워크플로우 실행 | `update_info_data_v2.yml`과 동일한 순서로 Node/Python 스크립트 일괄 실행 (환율 → IPO sync → nav 생성 → info 파이프라인 → 배당 → 캘린더 → 포맷) |

> ⚠️ 일부 단계(시장 선택, ISIN/IPO 수동 입력)는 **인터랙티브**하게 이뤄집니다. 터미널 입력이 가능한 환경에서 실행하세요.

---

## 4. 실행 로그 예시

```
============================================================
신규 티커 처리: YMAX
============================================================
[WARN] 자동 ISIN 조회 실패: ...
수동으로 입력할 심볼 (엔터 시 기존 심볼 유지):
YMAX ISIN (예: US0000000001): US1234567890
[UPDATE] nav entry 저장: public/nav/NASDAQ/y.json
[UPDATE] data 파일 저장: public/data/ymax.json

================================================================================
로컬 update_info_data 워크플로우 실행
================================================================================
-> 1. 환율 데이터 업데이트
   $ node scripts/exchange/fetch_all_exchange_rates.js
...
✅ 워크플로우 완료
```

---

## 5. 옵션별 사용 시나리오

- **워크플로우 없이 파일만 준비하고 싶을 때**
  `python scripts/utils/add_new_symbols.py --symbol ABC --skip-workflow`

- **형식화 스텝을 직접 하고 싶을 때**
  `python scripts/utils/add_new_symbols.py --symbol ABC --skip-format`

- **변경 없이 계획만 확인**
  `python scripts/utils/add_new_symbols.py --symbol ABC --dry-run`

---

## 6. 완료 후 체크리스트

1. `git status`로 변경 파일 확인 (`public/nav/*`, `public/data/*`, `public/nav.json`, `nav 관련 스크립트 출력물` 등)
2. 필요한 경우 추가 스크립트 실행 (예: 홀딩스 수집 등)
3. UI에서 신규 티커가 정상 노출되는지 로컬 확인
4. 커밋/푸시

---

## 7. 자주 묻는 질문 (FAQ)

- **Q. 자동 ISIN 조회가 계속 실패합니다.**
  A. 스크립트가 수동 입력을 안내합니다. 해당 증권사의 공식 ISIN을 확인 후 직접 입력하세요.

- **Q. 시장 정보가 비어 있다고 나오는데요?**
  A. 심볼 접미사로 판별하지 못한 경우입니다. 안내 메시지에 따라 `NASDAQ`, `NYSE`, `KOSPI`, `KOSDAQ` 중 하나를 입력하면 됩니다.

- **Q. nav/data 파일은 업데이트 되었는데 사이트에 반영이 안 됩니다.**
  A. `npm run generate-nav`를 포함한 통합 워크플로우를 다시 실행하거나, 최소한 nav 생성/배포 단계를 마쳐야 합니다. (스크립트 기본 설정으로는 자동 수행됨)

---

## 8. 참고 자료

- `scripts/utils/add_new_symbols.py`
- `scripts/utils/fetch_missing_isin.py`
- `tasks/addIpoDatesToNav.js`
- `.github/workflows/update_info_data_v2.yml`
- `docs/TICKER_MANAGEMENT_GUIDE.md`

필요한 보완 사항이나 자동화 아이디어가 떠오르면 언제든 공유해주세요! 😉
