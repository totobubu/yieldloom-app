# 업로드 운영 반영 검증

#253 기능 head791525a의 CI42013193576, work4b78ccc의 CI42015382239, #259 승격 CI42015516737은 각각4개 작업이 모두 통과했다. work Preview dpl_2WeEUZ3CPKm5airzNWztpCUoYC6X의 실제 app-release.json도4b78ccc와 메타데이터 해시가 일치했다. 기존 main75bc164의 공개 데이터 변경을 보존한 예상 병합 tree2c513be20d85d1e2f6f81a3994bb2db15b70f88c와 실제 main8a95a0219665dd81851d6790620f41b8b31fb0e4의 tree가 같다.

#259는2026-11-05 11:18:01UTC에 병합됐다. Pages42017853716 성공, Vercel dpl_6TFZLHgFwsSPJbqeC5isucVGBSjS READY. 두 공개 도메인의 실제 제공 SHA8a95a02와 metadataSha256 b54bc1cca63cb303a8b1e982b42a7238e1741013d3ce3908616c5dcd206827b7을 확인했다. 메타데이터 해시는 공개3개 메타데이터 파일의 식별이며 비공개 장부나 전체 시장 이력 검증을 대신하지 않는다.

[릴리스 확인](evidence/phase47/release.txt), [실제 배포 번들](evidence/phase47/bundles.txt), [PC/Mobile 공개 화면 렌더](evidence/phase47/render.txt). 새 업로드 미리보기·Mobile 파일 선택·계좌 확인 코드가 있고 검토 동의/장부 분석 초안은 포함되지 않았음을 실제 공개 번들로 확인했다. 익명 계좌 API401·문서 읽기/조회 작업0. 두 사이트의 검색 화면1440/390에서 오류·가로 넘침0, 공개HTTPS 조회만 수행했다. 직접 Chromium TLS는 환경 인증서 문제로 미검증이며, 검증된 Node CA 전송으로 공개 자산을 렌더링했다. TLS 검증을 비활성화하지 않았다.

실제 로그인 계좌/PDF 추출·저장과 운영 원장 쓰기는 수행하지 않았다. 운영 반영은 전체 픽셀 일치 승인이 아니다. 검토#256, 비교#258, 장부#260은 별도 초안이다. 병합 후 main CI42017853765는 별도 기록하며 전수 상태가 완료되기 전 성공으로 표시하지 않는다.
