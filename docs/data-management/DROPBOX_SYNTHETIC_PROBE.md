# Dropbox 합성 저장 시험

사용자가 승인한 두 합성 파일의 생성·바이트/revision 대조·충돌·동시 갱신·복구만 시험한다.
원본 `/Dividend`, 실제 ISIN 원장, R2·운영 데이터·백업에는 접근하지 않는다.

```text
/DividendArchive/v1/shadow/verification/gh-<run_id>-<run_attempt>/state.json
/DividendArchive/v1/shadow/verification/gh-<run_id>-<run_attempt>/receipt.json
```

기존 GitHub 저장소의 app key·app secret·refresh token을 동일 러너에서 Dropbox 인증
서버에 전달한다. 갱신된 access token은 메모리에서만 사용한다. 새로운 grant/scope,
환경 간 credential 복사, 인증값 출력, artifact 업로드 단계는 없다.

쓰기 전에 account context와 해당 시험 경로의 상위 폴더 metadata를 읽는다. 계정의
개인 home을 확인할 수 없거나, 기존 공유 폴더/링크를 발견하거나, 필요한 읽기 권한이
없으면 쓰기 전에 중단한다. 계정 ID·이메일·공유 링크 URL은 로그와 영수증에 넣지 않는다.
이 확인은 별도 연결 도구의 계정과 동일하다는 판정을 대신하지 않는다.

`state.json`은 original → updated → 동시 쓰기의 단일 승자 → original로 변경한다.
중복 add와 오래된 revision은 거절되어야 한다. 모든 검사가 통과한 뒤 receipt.json을
생성한다. 실패/불확실한 결과는 자동 재시도하지 않으며 시험 파일은 삭제하지 않고 남긴다.
공유 상태를 바꾸거나, 실패한 요청 때문에 접근 권한을 확대하지 않는다.

`.github/workflows/dividend-archive-smoke.yml`은 승인된 `test/dropbox-synthetic-shadow`
브랜치가 처음 만들어지는 push에서만 자동 시험한다. 이후 push는 쓰기를 반복하지 않는다.
이렇게 default branch에 시험 코드를 병합하여 기존 운영 자동 배포를 유발하지 않는다.
예약은 없다. 별도 수동 실행은 확인 입력과 고유한 run/attempt ID를 사용한다.
main/work 병합과 운영 배포는 이 시험 범위에 포함되지 않는다. 공개 PR은 draft로 유지한다.

소스 및 이 합성 시험의 안전한 단계별 결과만 공개할 수 있다. 기존 원문·개인 검증자료와
소스/비공개 복구 패키지는 별도의 명시적 비공개 목적지 승인 없이 업로드하지 않는다.

```sh
# 기본은 네트워크·credential 접근 없는 계획 출력이다.
python -m scripts.dividend_archive.smoke --run-id offline-review-only
python -m unittest discover -s tests/dividend_archive -v
```
