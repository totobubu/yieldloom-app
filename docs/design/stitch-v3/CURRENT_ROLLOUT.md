# 최종 시안 적용 현황

2026-11-05 phase53 운영 확인 기준. 최종 선택 고유ID20개/화면군9개를 추적한다. 기존14종과 중복되므로 합산하지 않는다. 운영 연결7개이며 전체 프레임 시각 승인은 별도다.

| 화면군 | 최종 기기 시안 | 상태 | 남은 사항 |
| --- | ---: | --- | --- |
| 열 연결 | PC·Tablet·Mobile3 | #249/#257 운영, #259에서 보존 | 기록된 전체 프레임 차이 |
| 저장 결과 | Tablet·Mobile2 | #251/#257/#259 운영 | 시각 차이·실계좌 흐름 |
| 업로드 | Tablet·Mobile2 | #253/#259/#262 운영90f0673 | 필수 설정·실제 메타데이터/금융 문구 차이·실계좌/PDF |
| 가져오기 검토 | Tablet·Mobile2 | #256 코드 체크포인트e8d9ff3, 초안 | 카드·통화 합계·요약 배치 적용; 태그·필터·편집 높이·본문 차이·실계좌/PDF |
| 장부 분석 | Tablet·Mobile2 | #260 head47a29bf CI4개·Preview 통과, 초안 | 내부 필터·원문 필드·연속성/정합성 정의·도구·시각 차이 |
| 유사 비교 | Tablet·Mobile2 | #258 head70f0f42 CI4개·Preview 통과, 초안 | 실제 문구 높이·필터/체크박스·글꼴 차이 |
| 테마 비교 | Tablet·Mobile2 | #258과 동일 | 동일한 실제 상태/시각 차이 |
| 시뮬레이터 | Tablet·Mobile2 | 병렬 담당, 최종 인계 미확인 | 고정 SHA·검증 결과 인계/통합 |
| 세율 비교 | PC·Tablet·Mobile3 | 병렬 담당, 최종 인계 미확인 | 고정 SHA·검증 결과 인계/통합 |

7개 운영 연결, 8개 초안(검토2·장부2·비교4), 5개 병렬 결과 미확인이다. 새 시안13개가 운영 미반영이며 완료율/ETA로 환산하지 않는다. 기존 기능의 운영 여부와 새 선택 시안 적용 상태는 구분한다.

[운영 근거](PHASE53_DARK_PRODUCTION_RECHECK.md): main90f0673287ab318f524f9e995b33919561da204f, Pages42030090181 성공, Vercel dpl_8MJnZv2Y2xgqYepcDFpmW7vK9mNb READY. 두 도메인의 실제 SHA·공개 메타데이터 해시, 배포 CSS의 자식 선택자, Draft 미포함, 공개 PC/Mobile 화면을 확인했다. #262의 최초 browser 실패 이후 #263에서 분석 준비 상태와 월 반영 검사를 보강했고, 기능/work/승격 CI가 각각4개 작업 모두 통과했다. 병합 후 정확한 main90f0673의 CI42030090218도4개 작업 모두 통과했다. 최초 금액 실패의 직접 원인은 미확정이며 실제 인증 계좌/PDF와 전체 화면 일치는 미완료다.

검토 근거는 PR#256의 PHASE45_REVIEW_CONSENT.md·PHASE50_REVIEW_CARDS_AND_CURRENCIES.md·PHASE52_MOBILE_REVIEW_SUMMARY.md, 장부는 PR#260의 PHASE46_LEDGER_ANALYSIS.md, 비교는 PR#258의 PHASE44_COMPARISON_INTEGRATION.md에 있다. 각 초안의 자체 브랜치에 보존되어 있으며 현재 main에 포함되지 않는다. UnderlyingExplorerView/DividendSimulatorView는 병렬 원본 소유자의 파일을 임의로 수정하지 않았다. 없는 프레임·기능·금융 수치를 만들어 완료 처리하지 않는다.
