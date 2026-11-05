# 저장 영수증 원본 조립과 아이콘 보정

기준은 #250의 `cb8eb525`이다. 원본 HTML/PNG는 최종 Tablet `cf7686fbb620465f93418fde1572a6cc`, Mobile `f5a2132c4e234e648269220f0e889387`이며 변경하지 않았다. API/금융 계산/저장/권한의 추가 변경은 없다. 아래는 검증한 부분과 아직 승인하지 않은 부분을 구분한 기록이다.

## 보정한 원인과 결과

- 원본의 단계별 2행 설명, 완료 표시, 제목/배지 묶음, 날짜 표기와 아이콘을 복원했다. 저장/재처리 상태는 별도 live 안내로 유지한다. 모바일에서는 원본의 요약→금융 카드→갱신/후속 카드→상세 5개 구역과 하단 48px 여백을 복원했다. 종목 설명 영역은 제거하지 않고 실제 명칭을 받지 못한 상태를 `명칭 미제공`으로 표시한다.
- PrimeIcons로 대체했던 모양은 Google Material Symbols Outlined 24px 원본 SVG로 바꿨다. 공식 저장소 commit `10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7`에 고정했으며 Apache-2.0 라이선스는 public/licenses/material-symbols-LICENSE.txt에 포함했다. 외부 아이콘 폰트 요청 없이 현재 색상으로 표시한다. 잘못 인용된 data URL이 사각형으로 보이는 문제를 캡처에서 발견해 고쳤고, 실제 maskImage 적용을 검사한다.
- 금융 카드의 행간/분리선, Tablet 40px·Mobile 44px 후속 버튼 규격과 원본의 별도 CSV 그룹, 표의 외곽/필터 조립을 맞췄다. 캘린더·잔고/거래·CSV·재시도·추가 등록의 기존 기능을 유지한다.
- 확정된 신규 0건과 행별 자료 미제공을 구분한다. 신규 0건은 금융 금액 0으로 바꾸지 않는다. 미제공 합계·기업명·세전/세후·출금 부호를 새로 추정하지 않는다. 기존 계좌 전체 CSV를 영수증 전용 내보내기로 표시하지 않는다.

## 측정과 증거

[전체 측정](evidence/phase35/measurements.json), [Tablet 원본 HTML 렌더링](evidence/phase35/source-834.png) / [구현](evidence/phase35/implementation-834.png), [Mobile 원본 HTML 렌더링](evidence/phase35/source-390.png) / [구현](evidence/phase35/implementation-390.png), [원래 Mobile PNG](evidence/phase35/native-source-mobile.png), [원래 Tablet PNG](evidence/phase35/native-source-tablet.png), [다크](evidence/phase35/implementation-dark-390.png).

원본과 구현 모두 고정 합성 6행·같은 viewport/DPR 2를 썼다. 시안에 있는 DEMO 배지를 캡처 컴포넌트의 slot에 넣고, 실제 서비스에서는 합성 배지를 넣지 않는다. 이전 phase34처럼 화면 밖에 DEMO 안내를 두지 않아 이제 헤더 조립을 직접 대조할 수 있다. 서로 다른 고정 데이터 상태의 전체 높이 숫자를 단순 개선율로 사용하지 않는다.

| 지표 | 원본 | 구현 |
| --- | ---: | ---: |
| 834/768 헤더 높이 | 189.25px | 189.25px |
| 834/768 단계 높이 | 66.5px | 66.5px |
| 390 헤더 높이 | 257.5px | 257.5px |
| 390 단계 높이 | 70px | 70px |
| Tablet 금융 카드 높이 | 376.5px | 376.5px |
| 834/768 전체 높이 | 1074.25px | 1106.25px |
| 390 전체 높이 | 2423.875px | 2438.75px |

콘텐츠 폭은 834/768/390에서 786/720/374px로 일치한다. 1280/360에서는 기능·넘침을 확인하되 대응하는 최종 PC 프레임이 없으므로 해당 기기의 원본 일치로 세지 않는다. Native Tablet PNG의 물리 픽셀을 834 CSS viewport로 간주하지 않는다.

**전체 픽셀 승인은 하지 않았다.** 남은 차이는 실제 저장 값/명칭 미제공/금융 집계 미제공/계좌 전체 CSV 범위·현재 갱신 안내의 문구와 줄바꿈, 일부 카드/필터/표 세부 배치·색상·대체 글꼴이다. Tablet 전체 +32px, Mobile +14.875px다. 고정 높이·음수 여백으로 안내를 숨기지 않았다. 원래 Mobile PNG와 변경 없는 HTML의 렌더링은 모두 780×4912이지만 RGB 평균 절대 차이가 약 8.18–8.87/255로 원본 리소스 두 개 사이에도 차이가 있다([비교 수치](evidence/phase35/native-html-comparison.json)). 이 차이의 원인을 확정하거나 구현의 픽셀 통과로 사용하지 않는다.

## 검증 경계

`capture-import-result.mjs`는 5개 폭·다크·오류/준비/재처리·필터·101행 이동·0/소수 정밀도·SVG 마스크·API 0회를 검사하고, 헤더/단계 치수가 원본과 같은지도 단언한다. API 63개와 Node 814개, lint/타입/프로덕션 빌드와 현재 CI의 등록 경로를 검증한다. 실제 로그인 계좌/PDF를 사용하거나 고객 자료를 쓰지 않는다. 원격 CI·배포 결과는 #250 및 후속 승격 PR의 정확한 SHA로 별도 기록한다.

추가 실행한 비-CI legacy `family-portfolio.browser.mjs`와 `statement-identity.browser.mjs`는 각각 사라진 `내 포트폴리오` 제목과 `/mypage?tab=upload`의 예전 버튼을 기다리다 실패했다. 변경 없는 운영 기준 `f252746`을 서비스하는 5188에서도 같은 첫 위치에서 실패했다. 이 두 시나리오는 통과한 것으로 세지 않고 이번 수정에 섞지 않았다. 현재 CI의 manual-holdings/broker/portfolio-enhancements/portfolio-import-review/asset-management 경로와 구분한다.

## 실제 앱 통합 확인

영수증이 나타나면 Dialog를 전용 모드로 전환한다. 원본 콘텐츠 상한 834px에 좌우 24px 여백을 더한 882px를 사용하고, Mobile은 좌우 8px로 조립한다. 매핑·검토·일반 업로드 모드는 보존했다. 실제 XLSX 저장 후 1440/1280/834/768/390/360 viewport에서 영수증 본문 폭 834/834/786/720/374/344px와 가로 넘침 없음을 확인했으며, 크기 변경으로 추가 API 요청은 없었다. 대표 [실제 모바일 Dialog](evidence/phase35/actual-dialog-390.png) 및 같은 폴더의 6개 캡처를 보존한다.

최종 로컬 검사에서 broker-spreadsheet/manual-holdings/portfolio-enhancements/portfolio-import-review/asset-management 5개 흐름이 통과했다. 합성 PDF, XLSX/CSV, 계좌 등록, 정정/검토/재처리·기존 후속 기능을 확인했으며, 편집/캡처와 순차 실행했다. Node 814개·API 63개 통과, lint 오류 0/기존 경고 54개, Vue 타입 검사·프로덕션 빌드 통과다. 이후 단순 attribute 정렬을 반영해 lint/build를 다시 확인한다.
