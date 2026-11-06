# 배당 차트의 폭 전환 후 기존 포커스 유지

7384e39의 실제 운영 검증에서 남긴 문제를 같은 코드의 loopback 합성 자료로 다시 재현했다.1280→390px에서 마지막 월이 계속 포커스돼 있지만 left592~640px, 차트 clip36~354px·scrollLeft0으로 화면 밖에 남았다. [수정 전](evidence/phase79-focus/before.json).

StockDividendTrend의 기존 차트 DOM ref를 post-watch하고, 그 차트 크기가 바뀔 때 실제 포커스가 월 버튼 안에 있는 경우에만 자신의 scrollLeft를 조정한다. 포커스를 다시 주거나 선택 월/금액을 바꾸지 않는다. 다른 도구에 포커스가 있으면 기존 수평 위치를 유지하며 초기에는 원본처럼1월 위치다. ref가 null이 되거나 컴포넌트가 해제되면 observer를 정리한다. 전역 resize 이벤트·폴링·추가 조회를 넣지 않았다.

같은 포커스·같은 선택을 유지한 수정 후 위치는 left306~354px·scrollLeft286이다. [수정 후](evidence/phase79-focus/after.json).1280·768·390px의 좁힘/넓힘 왕복6회, 선택 명세 불변·추가 API0, 차트 밖 포커스의100px 위치 보존·초기0·빈 이전 연도/탭 전환 해제를 검증했다. [기존 배당·ROC 탐색과 보강 결과](evidence/phase79-focus/navigation.txt).

집계/연도/기간/전년 비교/0·미확인 판정 구간은 기존 코드와 바이트가 같다. [해시·변경하지 않은 데이터 경로](evidence/phase79-focus/finance-preservation.json). 원본bd619d24ceb74c92afad1787a364ab4b에 맞춘 기존 외형도 유지했다. 같은 고정 자료·DPR2·1280/834/768/390px의 앱 수정 전후 idle crop RGB차이0이다. [픽셀 보존](evidence/phase79-focus/idle-preservation.json). 이것은 앱 전후 보존이며 원본 native PNG 전체/글꼴 일치 판정이 아니다.

실제 공개 운영·정확한 CI/배포 버전은 통합 및 후속 운영 기록으로 구분한다. 실제 로그인 계좌·고객PDF·운영 DB 쓰기는 하지 않았으며 시뮬레이터 공개 PR 차단도 유지한다. 기존 추가 도구·원본 없는 상세 프레임·전체14종의 시각 수용은 이 한 문제 해결로 완료하지 않는다.
