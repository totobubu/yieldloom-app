# 비교·장부 운영 반영 및 실제 제공 확인

기능 #265/2299dd0 CI42054585348, workd379844 CI42057463487 및 승격 #266 CI42057533017은 각각 application/portfolio-api/browser/registration-browser4개 모두 성공했다. 정확한 기능/work Preview의 커밋과 메타데이터도 확인했다. #258/#260의 원본 인계 헤드는 #265의 병합에 포함되어 MERGED 상태다.

main13fefac3153eaa76a96a0c1902b6dcec6a9fcd28에 병합했고 work와 main 트리는 같았다. Pages42060495908 성공, Vercel Production dpl_Erqb4Jwyonv4pCwYiptaqc6zfD6v READY다. https://yieldloom-app.vercel.app/ 및 https://totobubu.github.io/yieldloom-app/ 의 실제 app-release.json이 정확한13fefac과 공개 메타데이터 해시b54bc1cca63cb303a8b1e982b42a7238e1741013d3ce3908616c5dcd206827b7을 제공했다. 이 해시는 공개3개 메타데이터만 대상으로 하며 전체 시세/배당 이력이나 개인 원장 검증을 대신하지 않는다.

배포된 실제 JS/CSS에서 새 비교 카드/화살표/미지원 조건 안내, 새 장부 표/XIRR 확인 경로 및 기존 업로드·계좌 확인·검토·dark 스타일을 확인했다. 익명 계좌API는401·문서 읽기0·읽기 작업0이다. 서버 API/lib/public/DividendSimulatorView의 이전 운영 대비 변경이 없었고 보안 headers/rewrites/redirects도 그대로다. 문서는 Git에 보존하며 Python 패키지에서만 제외한다.

공개 검색1440/390 및 유사/테마1440/834/390을 두 실제 운영 주소에서 익명으로 렌더링했다. 비교의834/390은 새 반응형 표현이고 Mobile 현재 페이지12개 실제 목록 카드가 표시됐다. 안정된 상태에서 document폭834=viewport834, 가로 넘침0·실행 오류0·쓰기0이었다. 전환250ms 표본에는 Tablet 가로 넘침이 잡혔고, 글꼴 준비 및1200ms 뒤에는 없었다. 단일 원인을 글꼴로 확정하지 않으며 전환 표본을 삭제하거나 모든 순간에 넘침0이라고 표현하지 않는다.

Pages /compare 직접 진입은HTTP404의 SPA fallback이었으나 앱·목록·반응형 표현은 렌더링됐다. Vercel 직접 진입은200이었다. 이 플랫폼/직접주소 한계를 HTTP200 통과로 감추지 않는다. 이 환경에서 앞서 확인한 직접 Chromium TLS 실패 때문에, 이번 익명HTTPS도 Node의 상속된CA 검증으로 읽어 Chromium에 전달했다. TLS 검증은 끄지 않았다.

실제 로그인 계좌/장부 화면·고객PDF의 업로드/저장 종단 검증은 수행하지 않았다. 금융 계산·데이터·권한 보존과 합성 검증을 실제 고객 자료 검증으로 바꾸지 않는다. 원본 PNG/HTML 글꼴·실제 문구/보조 기능/세부 치수, 미제공 비중/섹터/지표·원문 단가·연속성/외부 원금 정의·CSV/재연결 도구는 기존 미완 목록대로다. 전체 픽셀 수용은 미완료다. 시뮬레이터 공개PR 승인 차단은 유지한다.

병합 후 정확한 main13fefac의 CI42060495817도 application/portfolio-api/browser/registration-browser4개 모두 성공했다.
