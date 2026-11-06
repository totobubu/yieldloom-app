# 사용자 화면 누락과 업로드 입력 손실 수정

기준은 운영016fcddda89e0f5285a65446e8859adde247c208이다. [잔여 목록](REMAINING_USER_SURFACES_PHASE72.md)을 먼저 작성하고 업로드·비교·저장 결과와 추가 발견한 분석/시세의5개 독립 단위를 병렬 검증 후 통합했다. 아래는 코드·합성 검증이며 원격 CI/운영 반영은 정확한 최종 SHA에서 별도로 기록한다. [7개 원본ID→경로·기기·컴포넌트·상태](evidence/phase72/source-route-state-map.json)를 별도로 대조했다. 새 시안5개를 생성/추가했다는 뜻이 아니다.

## 실제 기능 결함: 표준 파일 변경

CSV/XLSX를 고른 뒤 파일명의 ‘변경’을 누르면 선택 파일·미리보기·명의 확인을 먼저 지웠다. PrimeVue4.5.3의 limit1 native input은 이미 disabled라 clear 직후 DOM 갱신 전 choose가 무시돼 선택창도 열리지 않았다. 수정 전1280px에서 select→clear/파일0/preview null/chooser0을 실제 재현했다.

선택 파일이 있는 표준 형식만 별도 native picker로 새 선택을 기다린다. 취소는 기존 상태를 보존한다. 실제 새 파일이 있을 때 clear→nextTick→기존 FileUpload native change로 전달해 같은 확장자/2MB/파일수/미리보기/명의 확인 검증을 따른다. busy 잠금, PDF 추가 동작, 기존 API를 유지한다. Vue3.5 useId로 picker 대상 native input을 인스턴스별로 구분한다.

CSV/XLSX8개 viewport/진입 사례에서 FileChooser 빈 선택과 synthetic native cancel이 파일·미리보기1행·명의 확인을 보존하고, 새 파일은 clear/select 각1번·정확히1파일·이전 확인/미리보기 초기화였다. 확장자/2MB 제한과 PDF2개 추가 사례도 통과/API0이다. 실제 OS 취소 버튼, 고객 PDF 추출/실계좌 저장을 시험한 것은 아니다. 기존 업로드5폭 상태/geometry는 같은 환경에서 전후 동일했다. [독립 인계](evidence/phase72/upload-replacement/HANDOFF.md), [검증 범위](evidence/phase72/upload-replacement/verification.json). 새 회귀를 기존 직렬 CI browser 단계에 연결했다.

## 원본에 있는데 빠진 비교 조건 카드

최종 유사Tablet77fdbd798a3941c68f098120a210c44d의 ‘대조군 필터 조건/조건 변경’, 테마Tablet12bcd42390bb468eb1700a909aec3f5d의4개 조건/변경 카드가 없었다. 현재 실제 conditions/model/theme/결과 통화를 표시하고 기존 전략 Select로 스크롤·키보드 포커스를 복귀시켰다. 조건 변경 버튼은 디렉터리/지표를 추가 조회하지 않는다. 원본의 모달 프레임이 없으므로 새 팝업을 원본처럼 만들지 않았다. 통화는 필터를 새로 만들지 않고 실제 표시 통화임을 명시했다.

테마의 인사이트와 주의사항/조건2열도 복원했다. 같은 viewport에서 유사834px 카드786×70/버튼36,768px720×70/36, 테마834px385×245/44,768px352×245/44는 원본 HTML의 폭/높이/패딩/반경/테두리와 같다. 최종 Mobile 두 원본에는 카드가 없어 추가하지 않았고 두 Mobile before/after PNG는 바이트가 같았다. PC와 기초자산은 기존 렌더 분기를 유지한다. [측정·상태 검증](evidence/phase72/comparison/REPORT.md), [치수](evidence/phase72/comparison/condition-geometry.json).

반응형14 viewport/view 상태·실제 필터 변화/초점·제목/히스토리·조회수, 기존 지표9상태를 검증했다. 기존 정상0/미확인·원문/링크·실제 조회·선택/다크 흐름을 보존한다. 카드 치수 일치를 실제 금융 문구·전체 native PNG 수용으로 확대하지 않는다.

## 저장 결과 Mobile 요약 구조

최종 Mobile f5a2132c4e234e648269220f0e889387의 제목/배지 행과 메타데이터 구분선을 복원했다. Mobile 배지는 제목 옆 그룹에, wide 배지는 기존 위치에 두고 CSS로 한 개만 보이게 한다. 상태/계좌 목록 오류 설명·영수증 건수·실제 CSV 범위는 유지한다. 설명은 원본 HTML의14/21px, 메타데이터는13/18px·Mono와8px 간격으로 맞췄다. 날짜/계좌/파일 값은 원본 예시로 바꾸지 않는다.

| viewport | 요약 카드 전→후/원본 HTML px | 전체 높이 차이 |
| --- | --- | --- |
|834/768|179→179/179|0 유지|
|390|257→249.75/249.75|+3.75→-3.5px|

390px 메타데이터는83px로 원본과 같다. 전체-3.5px는 실제 금융 미제공 안내-19.5px와 서버 저장 의미 안내+16px의 합이다. 예시 금융 값·빈 공간으로 상쇄하지 않았다.1280/360px은 추가 검사다. 실제 index 글꼴 링크를 포함한5폭의 오류/ready/replay·필터·101행 페이지·0/소수 정밀도·다크/API0 검사와 화면당 표시 배지1개 검사를 통과했다. [최종 측정](evidence/phase72/receipt-final/measurements.json).

처음 조립에서 flex/Tag CSS 우선순위로 Mobile305px가 된 중간 측정을 보존했고 최종에서 해결했다. 로컬 DOM 진단 중 삭제된 임시 fixture를 조회한 시도는 제품 실패로 세지 않는다. 최종 소스 비교·캡처는 생성→검사→제거하는 격리 fixture에서 수행했다.

## 분석의 기존5모듈 진입 복원

Reviewed 원본2e3c6628d6c74eafa277d9f07d60fc57의 ‘상세 분석 및 관리 연계 모듈’5카드가 없었다. 이미 렌더되는 원장 품질/청산 손익·보유 자금/배당·월간 기록·시나리오·투자 설계로 이동하는 키보드 버튼을 복원했다. 기존 계좌/통화 가드 그대로 disabled를 판정하고 target을 중복 마운트하지 않는다. 시나리오는 닫힌 summary에만 포커스해 기존 지연 계산을 유지한다.

3폭×정상/금액미확인6상태·빈 계좌1상태에서30개 키보드 타깃/단일 마운트·시나리오 닫힘/계산 입력0·추가API0과 기존12개월/취소/미확인/0을 통과했다.5/2/1열·12px gap·14px padding·8px radius·36px 버튼·타입/버튼색은 원본 HTML과 같다. Tablet354×121.8px 카드가 일치했다. PC는 source호스트1232/app984px로 첫 카드236.8×121.8/app187.2×138.6px, Mobile은 source366/app358px의 기존 호스트 차이가 남는다. 셸을 늘리거나 음수 여백/본문 축소로 숨기지 않았다. [치수·잔여](evidence/phase72/analysis-shortcuts/REPORT.md), [3폭 요약](evidence/phase72/analysis-shortcuts/geometry-summary.json).

## 정상 시세 차트의 재조회 복원

원본87cd200796914464b7613003247de771의 차트·주의문 뒤 재조회 행을 복원했다. 기존 오류 ‘다시 시도’를 유지하며 정상/로딩/빈 상태에서 기존 load(true)로 연결한다. 로딩과 동일 tick 중복 클릭을 잠그고 API/서비스/금융 계산은 바꾸지 않았다. 강제는 브라우저 공개 캐시 reload 의미이며 서버/공급자 캐시 우회나 시장 데이터 최신성을 보장하지 않는다.

1280/768/390px에서 초기조회1·사용자 정상 재조회1, 중복/공유 읽기 추가0, 기간/봉 주기 변경조회0, 종목 전환 signal 취소·늦은 응답 격리·기존 오류/retry·키보드/다크를 통과했다. 버튼30px·12px/500·radius8·좌우10px가 원본 HTML과 같고 자동 폭117/117.046875px의 subpixel 차이는 기록했다. 기존 시세 이벤트3폭·달력4폭/stale/empty·단위6/6도 통과했다. [인계](evidence/phase72/price-refresh/HANDOFF.md), [범위](evidence/phase72/price-refresh/verification.json). 전용 회귀를 직렬 CI browser 단계에 추가했다.

배포 전 익명 실제 공개 API GET1회에서 QQQ·HTTP200·일봉501개 응답을 확인했다. 이는 공개 백엔드 준비 관측이고 신규 운영 버튼/실제 공급자 정확성·전체 금융 이력 확보 검증이 아니다. 서버/공급자 캐시 작업이나 실제 청구량을 측정하지 않았다. [공개 응답 범위](evidence/phase72/public-price-api-before.json).

## 통합 검사와 경계

독립 worktree의 node_modules symlink 때문에 일부 PrimeIcons 폰트가 Vite fs 허용 경계 밖이었다. 마지막 통합용 loopback Vite는 해당 작업 트리와 node_modules 실제 경로만 개발 런처에 허용했다. 앱/운영 서버 설정이나 네트워크 정책을 바꾸지 않았다. 이후 통합 회귀·원본 대조를 다시 실행하며 이전 제한을 전체 글꼴/PNG 수용으로 숨기지 않는다.

5단위 최종 타입 포함 build와 시세3폭·분석6상태/빈계좌, 앞선 업로드 교체10사례·업로드/영수증 각각5폭·비교14+9상태, 전체lint 오류0/기존경고54를 통과했다. 개발 PrimeIcons WOFF2도 HTTP200/wOF2를 확인했다. [통합 증거](evidence/phase72/). 루프백 합성 검사와 운영 자산/익명 화면, 실제 인증 계좌·고객 PDF·운영 DB 쓰기를 구분한다. 마지막 세 항목은 미검증이다. 전체14종/최종20개 native PNG 완전 일치는 미수용이며, 시뮬레이터 공개 PR 승인 차단은 유지한다. 새 프레임·가짜 금융값·권한 확대를 하지 않았다.
