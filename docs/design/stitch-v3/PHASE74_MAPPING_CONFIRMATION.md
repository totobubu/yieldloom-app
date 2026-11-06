# 열 연결 미리보기의 필수 확인

최종 원본 프로젝트17382728461495959991의PC9ae2f0f1253a41b1839e792d36996900·Tablet0bb2ab1d8197472f910b73ed175c4448·Mobilee0fb1368a1684edaa56c1a506e806530에는 열 연결·기본통화 필수 확인이 있다. [원본무결성](evidence/phase74-mapping/reference-integrity.json).

PHASE33에서는 수동 연결은 확인 없이 미리보기를 허용하고 불러온 preset만 재확인하는 예외를 의도적으로 유지했다. 이번 사용자 요청에 따라 기존 확인 UI를 수동·불러온 설정 모두에 일관 적용한다. 과거 서버 권한 결함으로 재분류하거나 새로운 최종 저장 승인을 만들지 않는다. parent canEdit,서버 권한,금융값,FormData/API,최종저장·파일검증은 그대로다.

CTA와native required 확인 및preview 핸들러에서준비/확인/로딩을 검증한다. mapping/currency·broker/kind/account 무효화를동기화해 같은 tick의예전확인 재사용을 막고preset재선택도확인을 초기화한다. 기존 file/sheet/header/encoding 초기화는 보존한다. 수동과preset의상황별실제안내를유지한다.

전용검사1280/834/390와root통합재검증이모두통과했다. 미완료/중복열,Enter/Space/native requestSubmit/directsubmit,busy,같은tick의통화/매핑변경,preset·sheet·header·encoding·broker·file·account·kind전환을검증했다. 기기별9회명시적합성inspect조회만했고확인조작/설정/제출차단은추가API0,previewemit3개의실제FormData필드·파일metadata가유지됐다.([통합결과](evidence/phase74-mapping/integrated/results.json), [단위인계](evidence/phase74-mapping/agent-handoff.md)).

기존broker-spreadsheet의보유/거래CSV미리보기직전2곳에확인절차를추가했다. 원본캡처의수동미확인활성기대도‘미확인비활성확인→체크→활성/기존미리보기’로갱신했고실제금융assertions는유지한다.

엄격원본캡처는root통합Vite의symlink실제의존성read허용으로1280/768/834/390전부통과했다. 원본CDN실패0·아이콘실패0·JS오류0,missing-type/ready/duplicate/busy와3원문행/명시inspect1회보존을확인했다. [strict측정](evidence/phase74-mapping/strict/measurements.json), [실행로그](evidence/phase74-mapping/strict.txt). child기존환경의PrimeIcons ERR_ABORTED진단은실패참고자료였으며수용판정에쓰지않았다. 검사기준완화나운영보안변경은없다.

원본HTML과일부치수대조통과를nativePNG전체일치로판정하지않는다. 제목글꼴폭차이(PC711.6875/715.078125px·Tablet396.484375/393.140625px),Mobile제목아래4pxmargin등이남는다. 수동ready미확인상태의별도native프레임도없다. 실제인증계좌·고객PDF·운영DB쓰기종단검증은미수행이며,메모리API·전체CI/배포는통합보고에서별도로구분한다.
