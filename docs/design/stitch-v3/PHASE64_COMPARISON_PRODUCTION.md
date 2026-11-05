# 비교 직접주소·전환 넘침 실제 운영 검증

PR #267의 기능1c5c97c, worka5844f6 및 승격 #268은 CI42065981896/42069087747/42069150878의 application·portfolio-api·browser·registration-browser4개가 각각 모두 성공했다. 기능/정확한 work Preview 커밋도 확인했다. main의 자동 ETF 기초자산 갱신63fd610을 보존했고, 승격 CI 병합 후보eae12ac와 최종 main0abdcdad7ada8b4fc95ac50a492f51565c134fdb의 파일 트리는 완전히 같았다. API·금융계산·권한·보안 설정·별도 담당 두 페이지는 수정하지 않았다.

Pages42072394353 성공, Vercel Production dpl_6XUeP928nan98UqPWSvag6dCguFY READY다. https://totobubu.github.io/yieldloom-app/ 및 https://yieldloom-app.vercel.app/ 의 실제 app-release.json이0abdcdad7ada8b4fc95ac50a492f51565c134fdb와 공개 메타데이터 SHA256 aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e를 제공했다. 공개3개 메타데이터의 해시이며 전체 시장 이력·개인 원장 검증을 대신하지 않는다.

두 운영 주소의 일반 /compare?view=similar 및 theme와 인코딩된 marker 쿼리 직접 진입·반복 요청은 모두 HTTP200이고 리다이렉트가 없었다. 실제 브라우저 새로고침도200이며 view와 marker=a+b&c를 유지했다. Pages의 모르는 경로는 기존404를 유지한다. 다른 모든 동적 Pages 경로의 HTTP200까지 확장한 수정이 아니다.

두 주소×유사/테마4조합에서 PC1440→Tablet834 직후30프레임씩 총120프레임에 가로 넘침이 없었다. Mobile390은 실제 현재 페이지12개 공개 목록 카드·가로 넘침0, 실행 오류0·실패 호스트0·쓰기0이었다. 별도 공개 검색1440/390도 두 주소에서 오류·넘침·쓰기0이다. 실제 배포 JS/CSS에서 기존 검토/편집/미지원 원문/저장 문구·장부/XIRR 차단·업로드/계좌 확인·dark 스타일을 확인했다. 익명 계좌API401·문서읽기0·읽기작업0도 확인했다. HTTPS는 상속된CA 검증을 사용하는 Node 전송을 Chromium에 연결했고 TLS 검증을 끄지 않았다.

최종20개 시안 ID와 HTML20/PNG20의 실제 바이트·SHA256 및 컴포넌트 존재는 모두 일치했다. 이것과 네 원본 치수 보존은 전체 픽셀 수용이 아니다. [화면별 남은 차이·실제 검증·참조/계약 경계](REMAINING_VERIFICATION_PHASE64.md)에 후속 범위를 기록한다. 실제 로그인 계좌/고객PDF 종단 검증은 수행하지 않았고 시뮬레이터 공개PR 승인 차단을 유지한다.

병합 후 정확한 main0abdcda의 자동 CI42072394324도 application·portfolio-api·browser·registration-browser4개 모두 성공했다. [최종 main CI](evidence/phase64/main-ci.json)와 [Pages 배포](evidence/phase64/pages-deployment.json)를 별도로 기록한다.

[증거 폴더](evidence/phase64/release.txt), [직접주소](evidence/phase64/direct-entry.txt), [실제 비교·전환](evidence/phase64/public-comparison.txt), [원본 무결성](evidence/phase64/reference-integrity.json).

[실행한 공개 브라우저 검사 원문](evidence/phase64/executed-public-comparison.mjs.txt)과 [직접주소 검사](evidence/phase64/executed-direct-entry.mjs.txt)는 실제 실행본을 보존한다. 전자는 당시 작업 공간의 Playwright 경로를 포함한 증거 보관본이며 일반 CI 진입 스크립트는 아니다.

마무리 직전에도 [두 운영 주소의 동일 커밋·메타데이터](evidence/phase64/final-release.txt)를 다시 확인했다.
