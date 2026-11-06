# 파일 변경·누락 제어 5단위의 운영 검증

이 문서는 기능 PR #275의5개 독립 개선과 운영 승격 #276을 추적한다. 새 시안5개가 아니라 기존 화면의 입력 손실·빠진 제어·원본 조립을 고친 범위다. [잔여 목록](REMAINING_USER_SURFACES_PHASE72.md), [원본7개 ID/경로/기기/상태](evidence/phase72/source-route-state-map.json), [구현/검증/정확한 차이](PHASE72_USER_SURFACE_FIXES.md)를 연결한다.

## 구현과 실제 검증을 구분

| 단위 | 닫은 내용 | 남은 검증·차이 |
| --- | --- | --- |
|표준 업로드|CSV/XLSX 파일 변경 chooser가 안 열리고 입력이 지워지던 결함 수정. 취소 보존/새 선택 검증·PDF 추가 보존|실제 OS 취소 버튼·고객PDF 추출/실계좌 저장은 미검증|
|유사/테마 비교|Tablet 조건 카드·필터 복귀 및 테마2열 복원. 실제 조건 반영/추가조회0, Mobile 전후 바이트 동일|카드 치수 일치는 전체 금융 문구/폰트/native PNG 수용이 아님|
|저장 결과|Mobile 요약249.75px·메타데이터83px 일치. PC/Tablet 치수 보존|전체-3.5px는 실제 금융 미제공/서버 안내 차이. 전체 PNG·실계좌 결과는 미검증|
|분석|기존5모듈 이동/키보드·빈 계좌 가드. 중복 마운트/추가조회0·시나리오 지연 계산 유지|PC source/app호스트1232/984px·Mobile366/358px, PC 카드 줄바꿈/높이 차이. 전역 셸/임의 여백으로 숨기지 않음|
|시세|정상 재조회 행과 기존 load(true) 연결·로딩/동일 tick 잠금. cache/signal/늦은응답·오류retry 보존|자동 폭117/117.046875px의 subpixel 차이. 시장 전체 이력/공급자·서버캐시 최신성 검증이 아님|

위 회귀는 합성 파일·실제 Vue 컴포넌트·loopback Memory/합성 공개 응답을 사용했다. 테스트에서 real/native chooser는 실제 브라우저 FileChooser와 native input 경로를 뜻하며 실제 계좌/고객 파일이라는 뜻이 아니다. native PNG 전체 일치는 미수용이다. 실계좌·고객PDF·운영 DB 쓰기는 하지 않았다. 기존 금융 계산/자료·API·서비스·권한·의존성·시뮬레이터 소스를 바꾸지 않았다.

## 고정 코드와 CI

기능 HEAD3267bb12f7018350dd1604d848fd0daf46ca47df의 [42161551696](https://github.com/totobubu/yieldloom-app/actions/runs/42161551696)은 application·portfolio-api·browser·registration-browser4/4 성공이다. [기능 CI](evidence/phase73/feature-ci.json), [완료 브라우저 로그의 PASS 요약](evidence/phase73/feature-browser-passes.txt).

기능 Preview dpl_Cxaqx4TZf9jBLkTbxAz7Jay4q4Mk READY와 실제 app-release3267bb1을 확인했다. 보호된 배포는 기존 연결 인증으로 읽었고 보호/Trusted Sources 설정·토큰 파일을 변경하지 않았다. 새 picker·모듈5타깃·Mobile 배지·비교 조건·가격 재조회 코드/CSS를 실제 자산에서 확인했다. 이는 앱의 인증 계좌 화면을 열었다는 뜻이 아니다. [기능 Preview 증거](evidence/phase73/feature-preview.json).

#275는 work08c611d7d65be67ab62bc6ddd29aed8ab4313ed1로 병합됐다. work의 트리는 기능 HEAD와 같고, #276 합성 병합 c4087f84384b0e7b901dbb9db3ce9ecc9e036be5도 work와 같다. work Preview dpl_45K3yAE8yC1MmCUABvnoA9mYAJxQ READY·실제 app-release08c611d를 확인했다. work[42163425887](https://github.com/totobubu/yieldloom-app/actions/runs/42163425887)·승격[42163518243](https://github.com/totobubu/yieldloom-app/actions/runs/42163518243)도 각각4/4 성공했다.

#276을 main7b8f4bad9af7125fbe252b586a1caa59f74795bb로 정상 병합했다. 최종 트리9fb0870ee71c97605941a104084a7dd256e533e0는 검증한 work/합성 병합과 같다. 최종 main[42165281731](https://github.com/totobubu/yieldloom-app/actions/runs/42165281731)도4/4 성공했다. source/work/승격/main의 서로 다른 SHA와 테스트 checkout을 구분하며 리뷰 승인 버튼이나 보호 우회 옵션은 사용하지 않았다. [최종 main CI](evidence/phase73/main-ci.json).

## 운영 제공 확인

Pages[42165281707](https://github.com/totobubu/yieldloom-app/actions/runs/42165281707) 성공, Vercel Production dpl_DTkjX8x1gVUtJAij4rcU9SEKRjuJ READY를 확인했다. Pages는 deploy-pages 게시 단계가 먼저 끝나지 않아 Vercel과 구분해 대기했고, 완료 후 두 실제 운영 주소에서 main7b8f4ba와 세 공개 메타데이터 결합 해시가 일치함을 확인했다. 모든 금융 이력의 정확성/완전성 검증은 아니다. [실제 릴리스](evidence/phase73/production-release.txt), [최종 응답 시각](evidence/phase73/final-public-release.json).

각 도메인의 실제 JS/CSS에서 새 picker/분석5타깃/모바일 영수증/비교 조건/시세 재조회 마커를 확인했다. 기존 업로드·검토·장부·다크 스타일과 원본 글꼴2파일의 HTTP200/bytes/SHA256도 보존됐다. 인증이 필요한 계좌 화면은 이 정적 확인만으로 실제 실행 완료로 올리지 않는다.

익명 실제 공개 `QQQI` 시세 화면은 두 도메인1280/768/390px에서 실제 API HTTP200·일봉501개로 캔들24개가 렌더됐다. 초기 읽기1/명시 재조회1·크기 변경 추가읽기0,30px·12px/500·radius8·실제 폭117.046875px, 오류/넘침0이었다. [Vercel](evidence/phase73/public-price-vercel.txt), [Pages](evidence/phase73/public-price-pages.txt). 특정 공개 종목1개의 응답/동작이며 시장 전체·공급자/서버 캐시 최신성이나 금융 값의 독립 감사로 확대하지 않는다. 사전 QQQ GET200·501봉과는 별도 관측이다.

최초 실제 시세 검사의 ‘모든 비GET 시도0’ 기대값은 기존 익명 `/api/analytics` POST1건 때문에 실패했다. 실제 추적과 기존 analytics.js/TickerThumbnailView의 card_open 집계를 대조해 UID/계좌자료 없는 기존 집계임을 확인했다. 모든 비GET은 전송 전에 차단해 해당 요청으로 운영 집계·고객자료를 쓰지 않았다. 검사 범위를 정확히 구분하고 **해당 POST/호스트/경로만** 기존 집계로 분류했으며 다른 쓰기 시도는 여전히 엄격히0으로 검사했다. 최종 두 도메인 모두 기존 집계 차단1/다른 쓰기0이다. [초기 실패](evidence/phase73/price-initial-counter-failure.txt), [실제 경로 진단](evidence/phase73/price-write-scope-diagnosis.txt). 제품 실패를 숨기거나 서버 응답을 합성 데이터로 바꾸지 않았다.

공개 비교4조합/1440·834·390px의 직접주소·새로고침·쿼리/제목·보이는 메뉴/히스토리와 전환120프레임 넘침0, 공개 검색2주소1440/390px 오류/넘침/쓰기0을 확인했다. 새 Tablet 조건 카드의 실제 버튼도4조합에서 기존 전략 입력으로 포커스하고 URL불변·추가 데이터 읽기0·쓰기0이었다. [실제 조건 동작](evidence/phase73/public-condition-focus.txt). 익명 계좌API401/문서 읽기0/읽기 작업0은 별도 관측이다. 실제 인증 계좌/고객PDF는 실행하지 않았다.

공개 브라우저는 Node의 상속된 CA로 검증한 실제 HTTPS 응답을 Chromium에 전달했다. TLS 검증을 끄지 않았고 market 응답·UI 데이터를 mock으로 치환하지 않았다. 실제 읽기 전용 검증/합성 테스트/정적 자산 확인의 경계를 유지한다. 서버/공급자 캐시 내부 작업과 실제 청구량은 측정하지 않았다.

최종20개 기기 시안15개 운영 연결/5개 외부 인계·승인 상태와 기존14종의 중복 관계는 그대로다. 해당 연결 수를 전체 시각 완료율로 쓰지 않는다. 행별 원문·파일 보존 계약, 별도 요약 검토 상세, 배당 성장률/미제공 금융 지표·가격/ROC 팝업 원본 부재는 해결됐다고 표시하지 않는다. 시뮬레이터 공개PR 승인 차단도 유지한다.
