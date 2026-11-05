# Dropbox 확정 배당 보존 준비 (2026-11-05)

기존 저장소의 scripts/lib/tests/workflows 및 문서에서 Dropbox 토큰 갱신·배당 보존
구현은 발견하지 못했다. 현재 관리형 환경의 변수 준비 상태와 앱의 실제 구현은 별개다.
상위 점검에서 refresh token이 invalid_grant로 거부됐다는 상태를 유지했다. 이번 작업은
거부된 인증을 재시도하지 않았고 실제 Dropbox API 요청·쓰기·권한 생성·배포를 하지 않았다.

## 준비된 코드

`scripts/data_pipeline/dropbox_preservation.py`는 네트워크 transport를 명시적으로
주입해야 하는 라이브러리다. 기본 HTTP transport, 환경 변수 로딩, 실행 CLI, 스케줄,
앱/API 연결은 없다. TokenProvider는 enabled=False, DropboxArchive는 allow_writes=False가
기본값이다. 테스트는 메모리 transport와 합성 데이터만 사용한다.

- TokenProvider: refresh token으로 짧은 access token을 메모리에 갱신한다. 만료는 응답
  expires_in과 여유 시간을 따른다. 동일 인스턴스의 동시 8요청은 갱신 1회로 합쳐졌다.
  이미 새 토큰이 생겼으면 오래된 토큰의 401 때문에 다시 갱신하지 않는다.
- invalid_grant/invalid_client를 포함한 토큰 endpoint의 비일시적 거부는 즉시 해당 provider를
  중단한다. 다음 요청도 인증을 반복하지 않는다. 자동 재연결/키 생성은 없다. 설정이
  복구돼 명시적으로 재연결할 때 새 provider를 만들어야 한다.
- 일시적 오류(429/5xx/네트워크)는 최대 3회로 제한한다. 기본 0.25/0.5초 backoff,
  Retry-After가 0~5초이면 존중하고 더 긴 값이면 retry_later로 반환해 자동 반복하지 않는다.
  Content API는 expired_access_token 401일 때만 1회 갱신한다. 그 밖의 401 및 반복 401은
  중단한다. upload의 네트워크/5xx 응답 유실은 무작정 재전송하지 않고 결과를 읽어 확인한다.
- 외부 응답 본문·헤더·예외 텍스트나 자격증명을 로그/예외 메시지에 넣지 않는다. 토큰과
  refresh 자격증명은 해당 process 메모리에만 있고 파일 저장은 하지 않는다. Response의
  repr에도 body/headers는 없다. 알 수 없는 transport 예외는 고정 오류 코드로 바꾼다.

[Dropbox OAuth 계약](https://docs.dropboxapi.com/dropbox-api/docs/oauth)의 refresh grant를
따르며, 이 코드는 거부된 값이 잘못됐는지·만료/철회됐는지 원인을 새로 판정하지 않는다.
DROPBOX_ACCESS_TOKEN을 refresh token으로 추측하거나 바꿔 쓰지 않는다. 운영 연결 시에는
DROPBOX_APP_KEY, DROPBOX_APP_SECRET 및 별도 DROPBOX_REFRESH_TOKEN의 의미·앱·계정 일치와
승인 범위를 확인해 관리형 환경의 비밀 설정에서 읽는 adapter가 필요하다. VITE 변수,
공개 앱·Git·채팅·명령 인자로 비밀값을 전달하지 않는다.

## 원본과 누적 관측 보존

build_plan(source_dir, preservation_dir)은 기존 extract_amount_fixed.verify로 입력 파일
목록·건수·각 값·출처와 원본 사본을 대조한 후 보존 계획을 만든다. 허용 파일은
manifest.json, dividends.json, verification.json과 originals/{sha}.json뿐이다. 계좌·거래·PDF·
자격증명 파일을 프로젝트 전체에서 찾아 올리는 경로는 없다. 원본은 수정하지 않는다.

Dropbox의 임시 제안 namespace는 /Yieldloom/dividends/v1이다. 실제 계정·App Folder 범위와
최종 목적지, 필요한 디렉터리를 운영 전에 확인해야 하며 지금 생성하지 않았다.

```text
objects/{SHA256}.json       # 파일별 원문 바이트, add + strict_conflict
snapshots/{SHA256}.json     # 파일 해시/크기/Dropbox hash와 previousSnapshotId
current.json               # 마지막 확인한 rev가 맞을 때만 update
```

같은 파일은 해시 객체를 재사용하고 같은 계획이면 upload 0회다. no-op도 기존 객체의
무결성을 읽어 확인하므로 읽기 0회는 아니다. 모든 파일의 업로드 결과를 검증·재조회한
뒤에만 current를 rev 조건으로 교체한다. autorename은 끄고 무조건 overwrite하지 않는다.
두 실행자의 pointer 경합은 실패로 반환하며 어느 쪽의 원본/스냅샷도 삭제하지 않는다.
업로드 응답만 유실된 경우 동일 경로의 실제 바이트를 읽어 확인한다. 확인이 안 되면
불확실한 쓰기로 남기고 현재 버전을 임의로 전진시키거나 작업을 반복하지 않는다.

크기, 일반 SHA-256 및 [Dropbox content_hash](https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/content-hash)를
검증한다. Dropbox hash는 4MiB 블록별 SHA-256을 이어 다시 SHA-256한 값이며 일반
파일 SHA와 구분한다. 정정·출처 차이·같은 날짜의 관측은 기존 snapshot 체인에 남는다.
원래 amountFixed=0, 숫자/문자 구분과 원래 소수 token, amountOriginal·분할 맥락·존재하는
출처와 bucket/key/SHA, 미확인 ISIN/마켓/통화 상태를 유지한다. raw 원본 바이트는 그대로
보존하며 추출 JSON 안 숫자 token의 문자열 표기를 임의 금액 반올림으로 바꾸지 않는다.

read_file(snapshot_id, name)은 지정 snapshot의 바이트를 검증해 반환한다.
load_records()는 최신 snapshot에서 이전 체인을 끝까지 확인하고 관측을 모은다.
동일 recordId와 동일 내용만 재사용하고, 같은 recordId의 내용 충돌은 실패한다.
ISIN·티커·날짜만으로 행을 합치거나 덮어쓰지 않는다. 읽기/인증/해시 오류나 체인 제한
초과를 빈 목록이나 일부 결과로 바꾸지 않는다. 이 결과는 **관측 보존본**이지 바로
합산할 정본 배당 원장이 아니다. source 파일의 개정으로 생긴 여러 관측을 하나의
지급으로 판정하는 검토와 시스템 소비 규칙이 별도로 필요하다.

## 한계와 남은 운영 단계

- 인증 복구가 먼저다. 거부된 refresh token은 다시 요청하지 않는다. 현재 코드에는 실제
  HTTPS adapter가 없으며, adapter는 공식 SDK/HTTPS로 고정 endpoint에 POST하고 TLS·기존
  프록시를 유지하며 헤더/본문을 기록하지 않아야 한다. SDK 자체의 자동 재시도로
  이 라이브러리의 재시도 한도·불확실한 쓰기 확인을 무력화하면 안 된다.
- 원문 읽기는 files.content.read, 보존 쓰기는 files.content.write 범위를 사용하는 코드다.
  지금 scope 변경·새 동의·자격증명 등록은 하지 않았다. 실제 연결 계정·앱·App Folder와
  namespace의 읽기/쓰기 가능성, 폴더 준비 여부를 승인 범위에서 확인해야 한다.
- 한 파일 100,000,000 bytes 초과는 계획 단계에서 upload_session_required로 거부한다.
  대형 파일 upload session/분할 전송은 아직 구현하지 않았다. 실제 데이터 크기를
  확인하기 전 전체 장기 보관이 바로 가능하다고 주장하지 않는다.
- 메모리 token single-flight는 한 provider 인스턴스/프로세스 범위다. 여러 서버 프로세스의
  갱신을 분산 lock으로 합치지는 않는다. 원격 pointer의 rev 조건은 프로세스 간에도 유지한다.
- 누적 읽기는 기본 1,000 snapshot 제한을 넘으면 오류로 알려 누락을 숨기지 않는다.
  대규모 운영 성능, 읽기 캐시/색인, 다운로드 대역폭과 실제 비용은 측정하지 않았다.
  raw 혼합 원본의 시세만 바뀌어도 해시가 달라질 수 있어 새 보존 객체가 생긴다.
  삭제·압축·보존 기간 변경은 별도 승인 사항이며 이 코드에 자동 삭제는 없다.
- 실제 원본 추출 완료/무손실 대조, 인증 복구, 계정·목적지·보안 범위 확인 후 **별도 승인된**
  첫 보존/복구 연습이 필요하다. 그 다음 collector 성공 뒤 archive 호출과 시스템의
  server-only 읽기를 연결한다. 그 전에는 기존 수집·원본 저장·앱 공급 경로를 유지한다.
  이번 작업은 Dropbox 자동 저장의 운영 활성화나 현재 앱이 Dropbox를 읽는다는 증거가 아니다.

## 검증

```sh
python -m unittest tests.test_dropbox_preservation tests.test_extract_amount_fixed tests.test_download_market_originals -v
```

신규 16개와 기존 추출/전송 11개, 합계 27개 통과. 동시/만료/거부된 인증의 latch,
일시 오류/Retry-After, 오류에서 비밀 문자열 제거, revision conflict, 응답 유실 후 readback,
변경 없는 재발행, 이전 관측 누적, 원문·소수값·출처·분할 맥락, 원격/로컬 손상과 읽기 실패를
검증했다. 실제 Dropbox 인증·읽기·쓰기나 운영 배포는 0회다. 프런트 변경이 없어 앱 빌드는
이번 Python 모듈 검증에 필요하지 않다.
