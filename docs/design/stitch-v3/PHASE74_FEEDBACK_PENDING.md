# 종목 의견 전송 중 입력 보호

종목 기본 원본 `7356929996797649648/d33c8e06e86f4404a4b5388c7aa33e13`의 기존 익명 의견 폼을 유지한다. 공식 MCP로 다시 읽은 HTML19043B/PNG438370B는 기존 보관 해시와 모두 같았고 PNG도 확인했다. [원본 해시](evidence/phase74-feedback/fresh-reference-integrity.json).

기존에는 전송 중 유형·내용을 편집할 수 있어, 이전 요청이 성공하면 새로 쓴 내용까지 지워졌다.1280/768/390에서 합성 응답만으로 재현했다. 기존 busy 상태를 유형·내용·제출 버튼의 disabled와 section의 aria-busy에 연결했다. payload·검증·중복 제출 가드·실패 시 requestId 보존/성공 시 회전·API·스타일은 유지한다.

신규 `stock-feedback.browser.mjs`는 loopback만 허용한다.3폭에서 짧은 입력 검증, 전송 snapshot·잠금, 중복 submit 차단,503 오류 후 전체 내용/유형 보존·입력 재활성화, 같은 requestId 재시도, 성공 초기화·재입력, 다크·넘침0·관측한 개인계좌 endpoint0을 통과했다. 기기별 의견POST2개는 모두 브라우저 mock에서 처리했으며 실제 의견 접수/고객 내용/운영 DB 쓰기는 없다. 타입/lint0오류0경고다.

같은 viewport/DPR2/data·애니메이션 비활성의 **앱 수정 전후** idle 폼은 RGB 픽셀 차이0·동일 치수다([전후 비교](evidence/phase74-feedback/default-preservation.json)). 초기 fade 캡처는 판정에 쓰지 않고 정확한7b8f4ba SFC를 loopback 임시 파일로 재생한 안정 baseline을 사용했다. 임시 source 파일은 제거했고 최종 커밋에 없다.

위 결과는 Stitch native PNG 전체 일치가 아니다. 원본에는 pending/error/success 별도 프레임이 없어 신규 상태 캡처는 구현 검증일 뿐이다. 기본정보 전체 문구·placeholder·개인정보 안내/호스트 레이아웃·글꼴 대조, 실제 의견 서비스·실계좌·고객PDF는 미검증이다. [원본 인계 상세](evidence/phase74-feedback/agent-report.md), [합성 결과](evidence/phase74-feedback/results.json)와 같은 폴더의15상태 PNG를 참조한다. 원격CI·운영 제공 버전은 통합 배포 보고에서 구분한다.
