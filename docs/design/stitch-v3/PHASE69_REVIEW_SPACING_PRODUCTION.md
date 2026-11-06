# 검토 표·예시 코드 간격 운영 반영

2026-11-06. [기능 #271](https://github.com/totobubu/yieldloom-app/pull/271)의 af9eb7f13ba8d50ba25455318496b520418b0d8d → work7a9227ffca114f00c37956f2ff20d7f60f90c3a3 → [운영 승격 #272](https://github.com/totobubu/yieldloom-app/pull/272)의 **main fae1ce41961509eb21e71af64e28f143592b2e16**다. 최종 main, 승격 CI 병합 후보7cec1a3471371667080da079ebd1f803d8f9ab09, work와 기능 head의 파일 트리가 같다. 실제 소스 변경은 검토 표의 중복 바닥 테두리와 예시 코드 flex/화살표이며, API·금융 값/계산·권한·시장 자료·시뮬레이터는 변경하지 않았다.

[원본 대조와 수정 전후](PHASE68_REVIEW_TABLE_AND_CODE_SPACING.md): Tablet 원본5aa7a573854a46db9b106f89c09c4f23/Mobile6bd9777b8bea43b98aea8397a29f809a. 표 높이는1280/834/768px에서 원본427.5/420.5/427.5px로 맞고, Mobile390의1238px은 유지한다. 원본 예시 코드 설명/본문의 줄바꿈 배분도 맞춰 설명 너비 차이를40.61→0.047px로 줄였다. 실제 안내/검증 대기를 가짜 정상100%나 원본 예시 수치로 치환하지 않는다. 전체 PNG 픽셀 일치는 아직 승인하지 않았다.

## CI와 실제 배포

| 단계 | 실행 | 확인 결과 |
| --- | --- | --- |
| 기능 | [42138681643](https://github.com/totobubu/yieldloom-app/actions/runs/42138681643) | application/portfolio-api/browser/registration-browser 4개 성공 |
| work | [42141456150](https://github.com/totobubu/yieldloom-app/actions/runs/42141456150) | 같은 4개 성공 |
| 승격 | [42141590951](https://github.com/totobubu/yieldloom-app/actions/runs/42141590951) | 같은 4개 성공 |
| 최종 main | [42143592035](https://github.com/totobubu/yieldloom-app/actions/runs/42143592035) | 같은 4개 성공 |
| Pages | [42143592046](https://github.com/totobubu/yieldloom-app/actions/runs/42143592046) | 성공 |

기능 Preview dpl_BxJz79hRhbUzQ9vMepAe4MLFdKwD의 실제 app-release는af9eb7f이고 새 CSS도 확인했다. work Preview dpl_JAJ3wqHfn4SAieM3MucYGVydW7Kg의 실제 app-release는7a9227f다. Vercel Production **dpl_FV7yRpWShWdE7qb6Bix2bwbvQmtU**는 READY/production/fae1ce4다. [Vercel](https://yieldloom-app.vercel.app/)과 [Pages](https://totobubu.github.io/yieldloom-app/)의 실제 app-release.json은 모두fae1ce4와 공개 메타데이터 SHA256 aba948fd05cec02755347f8437f769b394802ecc4fef37e24f9127e85e083e7e를 제공한다. 이 해시는 공개 JSON3개 범위이고 전체 금융 이력·개인 원장 검증이 아니다. 이 문서는 날짜별 고정 기록이며 현재 버전은 각 사이트 app-release.json과 CI 링크로 확인한다.

두 실제 배포 CSS에서 표의 중복 테두리 제거와 예시 코드 flex를 확인했다. 이는 익명 공개 배포 산출물 검사이며 인증된 검토 창의 실제 사용자 흐름 검사가 아니다. 두 운영 주소×유사/테마4조합의1440/834/390px 제목·일반 직접주소/새로고침200·쿼리 보존·실제 펼침/하위 링크·검색 복귀·뒤로 가기를 통과했다. 전환120프레임 넘침0, Mobile 공개 카드12개씩, 오류/실패 호스트/쓰기0이다. 공개 검색도 두 주소1440/390px에서200·오류/넘침/쓰기0이다. 익명 계좌API는401·문서 읽기0·읽기 작업0이며 인증 계좌 접근을 시험한 결과가 아니다.

[배포 메타데이터](evidence/phase69/deployments.json), [실제 릴리스](evidence/phase69/production-release.txt), [실제 CSS와 보존 산출물](evidence/phase69/public-bundles.txt), [공개 비교](evidence/phase69/public-comparison.txt), [검색](evidence/phase69/public-search.txt), [기능 브라우저 통과 로그 발췌](evidence/phase69/feature-browser-pass.txt). 공개 브라우저는 실제 공개 응답을 상속 CA로 HTTPS 검증해 전달했다. TLS 검증 해제·합성 공개 값 주입·개인 API/쓰기 허용은 없고, 분석 전송 호스트는 의도적으로 제외했다.

## 독립 화면 점검과 정확한 잔여

업로드는 합성 파일5폭에서 선택/삭제·명의 확인·유형/형식·암호·처리중·다크·수기 진입·API0을 통과했다. Tablet834/768의 헤더159.5/179px은 원본과 같다. Mobile은 원본 웹폰트 요청 실패로 전체 시각 수용이 막혀 있다. 실제 파일 메타데이터와 필수 형식/기준일·소유권 안내를 예시로 바꾸지 않았다.

저장 결과도 합성 영수증5폭·오류/완료/replay·필터·101행 페이지·0/정밀도·다크/API0을 통과했다. 표준 Tablet 합성 화면의 전체 높이는 원본보다32px 높다. 그중 갱신 안내170 대164.5(+5.5px), 후속 작업314.5 대288(+26.5px)로 위치를 좁혔다. Mobile 전체 높이 차이는14.875px다. 실제 갱신/후속 안내·잠금/다운로드 기능을 유지하며 다음에 비교할 대상으로 남긴다. 새 미지원 합계나0원·정상 상태를 만들지 않는다.

검토 화면의 폭은 원본과 같으며 이전833.75/829.25·843.5/847 수치는 열 **높이**다. 수정 후 주열 잔여 높이 차이는3.5px, Mobile 요약1px 등이 남는다. 업로드·저장 결과·검토/장부의 합성 검증을 실제 로그인 계좌나 고객PDF 종단 검증으로 표시하지 않는다.

글꼴 원본 URL을 직접 재확인했다. 업로드의 Pretendard 요청은HTTP400(해당 요청의 글꼴 없음), 검토의 여러 family명을 한 family로 요청한 URL은HTTP400(잘못된 selector), 같은 검토 원본의 Material Symbols 요청은HTTP200이다. [요청/응답](evidence/phase69/source-font-responses.json), [오류 분류](evidence/phase69/font-error-headings.json). 원본 PNG의 실제 렌더 글꼴 파일·정상 URL 또는 렌더 설정이 없어 정확한 대조가 막혀 있다. 임의 대체 글꼴/패딩으로 완전 일치를 주장하지 않는다. 원본 HTML/PNG 자체는 변경하지 않았다.

최종20개 기기ID/9개 화면군 중15개 운영 연결·외부5개 상태는 그대로이며 기존14종과 합산하지 않는다. 전체 native PNG 수용·미지원 지표 정의/자료·없는 상세 원본·실제 인증 계좌/고객PDF 검증은 남는다. 시뮬레이터 공개PR 승인 차단도 유지한다. 새29종을 만들거나 완료로 표시하지 않았다.

최종 main42143592035도4개 모두 성공했다. 검토 Tablet/Mobile·업로드 Mobile의 native PNG3개는 등록부 SHA256과 일치하며 PNG 메타데이터 키가 모두 비어 있어 파일 자체에서 렌더 글꼴 이름을 얻지 못했다. [PNG 확인](evidence/phase69/native-png-metadata.json). 원본 목록을 새로 생성하거나 수정한 것은 아니다.
