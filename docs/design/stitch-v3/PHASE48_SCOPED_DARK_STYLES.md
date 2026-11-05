# 다크 선택자의 문서 전역 누출 수정

PortfolioImportReview, TossPdfImportReview, PortfolioInsights, DividendRocChart의15개 `:global(.p-dark) .child` 선택자를 `.p-dark .child`로 바꿨다. 설치된 Vue scoped CSS 컴파일러에서 이전 표현은 child를 제거해 `.p-dark` 문서 전역 규칙이 됐다. 의도한 색상값·금융 계산·자료/권한/이벤트·레이아웃 값은 바꾸지 않았다. #259 업로드/영수증 수정 후 남아 있던 같은 원인이다.

실제4개 SFC 스타일을 컴파일하고 Chromium DOM에서 전후를 확인했다. [수정 전 재현](evidence/phase48/before.txt): 검토는 root 글자색, PDF 검토는 글자/배경, 분석은 입력 color-scheme, ROC는 문서 border/fill/stroke를 바꿨다. [수정 후 검사](evidence/phase48/after.txt)는 문서 스타일이 유지되고 자식의 기존 다크 색상·SVG·월 입력만 바뀌는 것을 검증했다. 밝은 모드 전환도 root 기준을 유지했다. 이 검사를 CI browser job에 등록했다.

실제 화면 회귀 검사: security-insights의4폭/밝음·어두움 및 정밀도/ROC 결측, 배당 지표6상태, 분석6상태, 전체4716행 검토/필터·편집·저장, Mobile PDF 오류/재시도2상태가 통과했다. lint 오류0/기존경고54, 타입·빌드 통과. 합성/공개 fixture만 사용했고 운영 개인 자료를 읽거나 쓰지 않았다. 기능·금융 수치의 의미 변경은 없다. 금융/시각 전체 프레임 승인을 의미하지 않는다.

이 추가 수정은 별도 PR에서 원격 CI와 실제 화면 검증 후 판단하며 #259 운영 배포에 포함됐다고 주장하지 않는다. 검토#256의 같은 선택자2개 수정은 동일 내용이므로 후속 통합에서 양쪽을 보존한다. 비교/시뮬레이터 병렬 원본 파일은 건드리지 않았다.
