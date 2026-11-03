# 공식 API 조회 범위와 전체 이력의 한계

이 도구는 **해외주식 일별 매수·매도 거래**를 조회합니다. 국내·해외 전 상품,
배당·입출금·환전·출고를 포함한 계좌의 모든 금융사건을 수집하는 도구는 아닙니다.
시장 코드의 의미는 API마다 다를 수 있으므로 다른 API의 설명을 전용하지 않습니다.

| 범위 | 확인한 공식 근거 | 현재 판정 |
| --- | --- | --- |
| CTOS4001R의 NASD | 공식 구형 일별거래 예제의 `OVRS_EXCG_CD` 주석은 NASD를 미국으로 설명 | 미국 대상 코드라는 근거는 있음. 나스닥 전용이라고 단정할 수 없으며, 최신 상세 명세의 NYSE/AMEX 포함 범위는 미확인 |
| TTTS3035R의 NASD | 공식 주문체결 예제는 NASD를 나스닥·뉴욕·아멕스를 포함한 미국시장 전체로 설명 | 주문체결 API의 설명이며, CTOS4001R에 그대로 적용한 보장은 아님 |
| 국내주식 | 공식 샘플에 별도의 `domestic_stock/inquire_daily_ccld` API가 있음 | 이 해외주식 수집기로 수집하지 않음 |
| 미니스탁 | 결제기준잔고 API에 미니스탁 조회 구분이 있음 | 잔고 지원을 CTOS4001R의 과거 미니스탁 거래 전체 지원 증거로 삼을 수 없음 |
| 과거 이력 하한 및 1회 날짜 구간 | 확인한 CTOS4001R 공식 샘플은 시작/종료일과 연속조회를 제공하나 최대 과거 하한을 명시하지 않음 | 미확인. 2020년 또는 첫 반환 거래일을 계좌 최초 거래일로 정하지 않음 |

따라서 NASD 한 번의 실행을 국내·기타 국가·미니스탁 포함 전체 이력이라고 표시하지
않습니다. NYSE/AMEX가 실제로 빠졌다고 확정한 것도 아닙니다. 해당 계좌의 증권사
원장 및 알려진 거래소별 표본을 대조하기 전에는 미확인 범위로 남깁니다.
최신 공식 일별거래 샘플은 거래소 코드를 일반적으로만 설명하며 예시 문자열도
구형 설명과 일치하지 않는 부분이 있어, 이 문서가 그 차이를 추정해 보정하지 않습니다.

## 계좌 최초일 확인의 최소 단계

확인한 공식 계좌 API 목록과 샘플에서는 계좌 개설일 또는 최초 해외주식 매매일을
반환하는 전용 조회 기능을 확인하지 못했습니다. 전체 공식 서비스에 그러한 기능이
없다고 단정하지 않습니다. 최초 API 반환 거래일이나 그 이전 빈 응답도 증명이 아닙니다.

1. 한국투자앱의 `메뉴 → 고객지원 → 거래서비스 신청 → 계좌/증명서 발급 → 계좌확인서`
   경로에서 계좌 증빙을 확인합니다. 공식 FAQ는 이 발급 경로를 안내하지만 계좌확인서에
   개설일이 반드시 표시된다고 명시하지는 않으므로, 표기가 없으면 추측하지 않습니다.
2. HTS의 `인터넷뱅킹 → 자산현황/거래내역 → [7451] 계좌별 거래내역 조회`에서
   설정한 기간의 전체 데이터를 조회한 뒤 엑셀로 저장합니다. 일반 계좌와 미니스탁
   연결 계좌, 매매/환전/입출금의 자료 범위는 각각 확인합니다.
3. 개설일·최초 매매일 또는 API 제공 이전 구간이 확인되지 않으면 고객센터에
   계좌 개설일 및 최초 해외주식/미니스탁 매매일 확인과 누락 기간 거래내역서 발급을
   요청합니다. 이 도구가 대신 문의하거나 임의 시작 연도로 전체 조회하지 않습니다.

계좌 개설일, 실제 최초 매매일, API가 제공하는 최대 과거 하한은 각각 별개입니다.
`--start-basis`는 확인한 요청 경계의 근거 설명이며 증빙 진위나 전체 완전성의 자동
승인이 아닙니다. 공식 지원 범위 밖이거나 미확인인 부분은 coverage gap으로 남깁니다.

## 공식 출처

- CTOS4001R 구형 설명: https://github.com/koreainvestment/open-trading-api/blob/main/legacy/Sample01/kis_ovrseastk.py
- 최신 일별거래 예제: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/inquire_period_trans/inquire_period_trans.py
- 주문체결 코드 의미: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/inquire_ccnl/inquire_ccnl.py
- 국내주식 일별체결: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_ccld/inquire_daily_ccld.py
- 미니스탁 구분이 있는 잔고 조회: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/inquire_paymt_stdr_balance/inquire_paymt_stdr_balance.py
- 거래내역서/계좌확인서 공식 FAQ: https://securities.koreainvestment.com/main/customer/support/_static/TF04fg000000.jsp?mctgr=01&sctgr=08
