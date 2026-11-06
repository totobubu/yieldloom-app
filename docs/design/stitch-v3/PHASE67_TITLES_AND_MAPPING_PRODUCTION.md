# 비교 제목·열 연결 아이콘 운영 반영

2026-11-06 운영 확인. [#269](https://github.com/totobubu/yieldloom-app/pull/269)의 기능 head ab0b2fd414149b35dfaca2ef90474fba3db2a809 → work a026bd623b5b4d7ea85b1743bcb6a67e45180cea → [#270](https://github.com/totobubu/yieldloom-app/pull/270)의 main **67428099d8046bfbb7cb1bf6da47b2a5b1dcf84e**다. 최종 main과 승격 CI 병합 후보67b0c5578832ad6a1777857a1411cc6268809735의 파일 트리가 동일하다. 기존 금융/API/권한/시장 자료는 변경하지 않았다.

기존 비교 페이지의 빈 문서 제목을 현재 비교 종류로 연결했다. 열 연결 파일 아이콘은 기존 원본 공급 SVG와 StitchSymbol을 재사용하고 태블릿 라이트 색상을 맞췄다. [원본 측정·수정 범위](PHASE66_RECOVERY_TITLES_AND_FILE_ICON.md)의 전체 프레임 미일치 판정은 그대로 유지한다.

## CI와 배포

| 단계 | 실행 | 실제 결과 |
| --- | --- | --- |
| 기능 | [42130242244](https://github.com/totobubu/yieldloom-app/actions/runs/42130242244) | application/portfolio-api/browser/registration-browser 4개 성공 |
| work | [42132475529](https://github.com/totobubu/yieldloom-app/actions/runs/42132475529) | 같은 4개 성공 |
| 승격 | [42132573317](https://github.com/totobubu/yieldloom-app/actions/runs/42132573317) | 같은 4개 성공 |
| 최종 main | [42135839187](https://github.com/totobubu/yieldloom-app/actions/runs/42135839187) | 같은 4개 성공 |
| Pages | [42135839197](https://github.com/totobubu/yieldloom-app/actions/runs/42135839197) | 성공 |

기능 Preview dpl_99eX7qJgcR9F59Dqiyk5kfjPeZki, work Preview dpl_BV4RFZUtxNBoentVjryVZeUfXbwH는 각각 정확한 head와 메타데이터를 확인했다. 최종 Vercel Production **dpl_6kR6vfXoagb5L5TCcPZZEGHMuMDJ**는 READY/production/6742809로 확인했다. [Vercel 운영](https://yieldloom-app.vercel.app/)과 [Pages 운영](https://totobubu.github.io/yieldloom-app/)의 app-release.json 모두6742809이며 공개 메타데이터 SHA256은 aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e다. 메타데이터 해시는 공개 JSON 3개 범위이며 전체 시장 이력 검증을 뜻하지 않는다. 현재 버전은 각 사이트 app-release.json으로 다시 확인할 수 있고 이 문서는 당시 고정 기록이다.

## 실제 공개 화면

두 운영 주소×유사/테마4조합에서1440·834·390px의 제목을 확인했다. 일반 직접주소와 실제 새로고침은200, 추가 쿼리는 보존됐다. 접힌 ‘현재 조건 및 지표 조회’를 실제 summary 클릭으로 연 뒤 하위 링크, 기초자산 기본값, 검색 복귀와 브라우저 뒤로가기의 제목을 확인했다. 834px 전환4조합×30=120프레임 넘침0,390px 공개 카드 각12개, 페이지 오류·실패 호스트·차단된 쓰기 요청0이다. 검색도 두 주소1440/390px에서200·오류/넘침/쓰기0이다.

첫 공개 검증 helper는 닫힌 details의 링크가 즉시 보인다고 가정해 실패했다. summary 클릭 단계를 넣어 통과했다. 실패 실행과 수정된 실행을 모두 보존하며 이를 제품 결함 수정으로 세지 않는다. 공개 브라우저는 실제 공개 응답을 Node의 상속 CA HTTPS 검증으로 Chromium에 전달했다. TLS 검증 해제나 합성 공개 값 주입은 없고, 인증 계좌 API와 비GET 쓰기는 차단했다. 분석 전송 호스트 vitals.vercel-analytics.com은 의도적으로 제외했다.

[공개 브라우저 결과](evidence/phase67/public-comparison.txt), [직접주소 검사](evidence/phase67/direct-entry.txt), [검색](evidence/phase67/public-search.txt), [배포 코드·릴리스·익명401](evidence/phase67/public-bundles.txt), [릴리스 확인](evidence/phase67/production-release.txt). 실행 helper와 원본 로그·스크린샷도 같은 evidence 디렉터리에 보존했다. 익명 계좌API는401/문서 읽기0/읽기 작업0이며 인증 상태의 실제 비용이나 저장 흐름 검증은 아니다.

## 추가 원본 대조와 남은 차이

검토 화면은 합성6행·5폭·입력 보존/포커스·처리중·다크·API0을 재검증했다. 원본 HTML 기준1280px의 주열833.75 대829.25(+4.5px), 사이드 시작843.5 대847(-3.5px),390px 요약445 대444(+1px)가 남는다. 장부도5폭·통화 누락/원문0·계좌 범위·로컬 필터·101행 페이지·XIRR/확인창 초기화·다크/API0을 재검증했다. 장부 첫 재캡처 실패는 로컬 Vite 종료로 인한 연결 거부였으며 명시적인 loopback Memory API 연결의 작업 소유 서버를 재시작해 통과했다. 고객 자료나 운영 API로 대체하지 않았다.

이 결과는 합성 화면과 보존 원본 HTML 비교다. 원본 native PNG 글꼴 확정·전체 픽셀 일치, 실제 로그인 계좌·고객PDF 업로드/저장/조회는 수행하지 않았다. 업로드·저장 결과의 신규 전체 캡처도 이 단위에서는 수행하지 않았다. 기존15개 기기 시안의 운영 연결 수는 그대로이며 외부5개와 기존14종을 합산해 완료율을 만들지 않는다. 남은 일반 간격/아이콘·원문/보조도구·지표 계약·없는 원본 상태는 이전 [검증 목록](REMAINING_VERIFICATION_PHASE64.md)을 따른다. 시뮬레이터 파일은 변경하지 않았고 공개PR 승인 차단도 유지한다.

환경은 복구되어 셸/프로젝트 Playwright를 사용할 수 있었다. 별도 Browser Use의 insufficient_credits 요청은 재시도하거나 우회하지 않았다. 현재 운영 배포와 CI에는 차단이 없다. 미완료 시각/실계좌 영역을 완료로 판정하지 않는다.
