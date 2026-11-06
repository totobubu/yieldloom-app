# 익명 의견 수정 재시도의 본문 유실 방지

원본 d33c8e06e86f4404a4b5388c7aa33e13(프로젝트7356929996797649648)의 HTML/PNG를 MCP로 새로 읽어 기존 해시와 일치함을 확인하고 native PNG를 검토했다. [무결성](evidence/phase80-feedback/source-integrity.json). 대상은 `/stock/:ticker`의 StockFeedbackForm이며 기존14종 중 종목 상세/보조 의견 폼의 동작 개선이다. 새 시안·페이지가 아니다. 기존 원본의 폼과 실패/성공 안내를 유지하며 금융 예시 값과 실제 데이터를 치환하지 않았다.

## 실제 유실 경로와 수정

기존 서버는 requestId가 이미 있으면 기존 접수의 중복 성공을 반환한다. 접수 뒤 응답이 유실됐을 때 사용자가 내용을 고쳐 제출해도 폼은 같은 requestId를 보냈다. 따라서 화면은 성공·입력 초기화됐지만 수정한 본문은 저장되지 않는 경로를 합성 저장소로 재현했다. [수정 전 실패](evidence/phase80-feedback/before-failure.txt). 실제 의견이나 개인정보를 서버에 보내지 않았다.

종목/유형/본문/기존 honeypot 입력의 제출 시점 스냅샷을 컴포넌트 메모리에서 비교한다. 같은 본문의 재시도와 수정 후 원복은 같은 ID를 유지한다. 실제 제출 내용이 달라졌을 때만 새 ID를 만들고, 성공하면 기존처럼 입력과 재시도 기준을 초기화한다. URL의 탭/쿼리는 서버가 정규화하는 출처 문맥이므로 콘텐츠 비교 키에 넣지 않는다. 비교 값은 로그·URL·저장소에 남기지 않는다. 입력 변경에 따른 자동 요청이나 자동 재시도도 추가하지 않았다.

서버 저장·중복 판단·origin 검증·횟수 제한과 클라이언트 서비스는 수정하지 않았다. [해시와 경계](evidence/phase80-feedback/api-preservation.json). 원래 성공 후 새 요청/처리 중 잠금·동일 submit 중복 방지·오류 메시지/기존 입력 보존을 유지한다. 이 수정은 기존 접수를 덮어쓰지 않고 사용자가 수정해 명시적으로 보낸 새 의견을 별도 접수할 수 있게 한다.

## 검증과 한계

1280/768/390px의 기존 전체 앱 폼에서 화면 폭마다8건의 완전 차단된 합성 POST를 검사했다. 정상 재시도/동일 ID·중복 클릭 방지, 접수 뒤503응답 유실→수정 원복→같은 ID, 본문 변경/유형 변경→새 ID와 실제 합성 저장 본문 일치, 이전 접수 불변, 성공 초기화·다크·오류/넘침/개인 API0을 확인했다. [상태](evidence/phase80-feedback/results.json). 모든 요청은 loopback Playwright route에서 끝나 실제 서버 접수/DB 쓰기는 없다.

같은 입력·포커스·마우스 위치·완료된 유한 전환을 맞춘 idle/pending/error/success/dark ×3폭의15개 앱 전후 RGB crop은 모두 같다. [보존 측정](evidence/phase80-feedback/visual-preservation.json). 최초 비교의4개 불일치는 [촬영 상태 정규화 기록](evidence/phase80-feedback/capture-normalization.json)에 남겼고, 원본 PNG 전체/글꼴 일치로 승격하지 않았다.

타입 포함 build·lint오류0(기존경고54)·Node819개를 통과했다. [빌드](evidence/phase80-feedback/build.txt), [lint](evidence/phase80-feedback/lint.txt), [Node](evidence/phase80-feedback/node-summary.txt). 마지막 촬영 조건 보정은 검증기만 바뀌었으며 앱 소스가 같아819/build 결과를 재사용했다. 최종 검사 코드의 별도 scoped lint도 통과했다. 원격 CI·Preview·운영 제공은 이 구현 시점 문서의 범위가 아니며 해당 PR의 최종 본문과 후속 운영 기록을 따른다.

전체14종/20기기 시안 원본 일치·PC 셸 폭·미정 금융 지표·원문 보관/권한 계약·없는 상세 프레임과 실제 인증 계좌/고객PDF 검증은 여전히 남는다. 시뮬레이터 공개 PR 승인 차단을 유지한다. 이전 [운영 검증 기록](PHASE79_PRODUCTION.md)은 원격 문서 체크포인트의 내용을 그대로 통합했으며 이번에 다시 수행한 검증으로 세지 않는다.
