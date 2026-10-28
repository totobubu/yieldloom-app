# 한국투자증권 수집기 Git 로컬 전달

이 폴더는 로컬 실행용 코드·합성 테스트·설명만 제공합니다.
원격 `main` 병합이나 앱 배포는 수행하지 않습니다. 개인 거래 표본·원문·키·토큰·
실제 `.env` 파일은 포함하지 않으며 기존 Toss 수집기 및 인증 파일을 변경하지 않습니다.

## 기존 로컬 작업과 분리하여 가져오기

저장소의 기존 로컬 체크아웃에서 다음 명령을 실행하면 코드 전달 브랜치를 별도
worktree에 읽어옵니다. 기존 작업 브랜치나 미커밋 변경을 전환/병합하지 않습니다.
목적지 폴더는 아직 존재하지 않는 경로를 지정합니다.

```powershell
git fetch origin feat/kis-local-history-collector-20261028
git worktree add --detach ..\yieldloom-kis-collector origin/feat/kis-local-history-collector-20261028
Set-Location ..\yieldloom-kis-collector\scripts\kis-history-export
py -3 -m unittest discover -s tests -v
```

## 로컬 설정

이미 본인 PC에 저장한 `.env.kis-orders.local`은 그대로 두고 해당 파일의 절대경로를
`--env-file`로 전달합니다. 내용이나 키를 Git/채팅에 옮기지 않습니다.
프로그램은 `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_CANO`, `KIS_ACNT_PRDT_CD`만 읽습니다.
계좌상품코드는 사용자가 확인한 뒤 2자리이며 추측하지 않습니다.

아래 확인용 명령은 실제 인증과 읽기 전용 계좌 조회를 수행합니다. 코드 전달/테스트
단계에서는 실행하지 않았으며 업무 PC 담당이 사용자 승인 범위에서 실행합니다.

```powershell
py -3 export_history.py --env-file "기존로컬설정파일의절대경로"
```

## 전체 이력의 경계

기본 목표는 계좌 최초 거래부터 현재까지지만, 시작일을 임의 연도로 설정하지 않습니다.
기본 실행은 확인용 월만 조회합니다. `--full`에 `--start`가 없으면 인증 전에 멈춥니다.
계좌 개설/최초 거래 증빙과 API가 제공하는 과거 하한은 별개로 확인해야 합니다.
확인한 요청 시작 경계와 근거를 입력하며 그 날짜가 최초 거래일이라고 단정하지 않습니다.
종료일은 기본적으로 실행일의 한국시간 날짜입니다.

```powershell
py -3 export_history.py --env-file "기존로컬설정파일의절대경로" --full --start YYYY-MM-DD --start-basis "확인한 공식 근거"
```

명시적 기간 수집은 `--goal period --full --start YYYY-MM-DD --end YYYY-MM-DD`로
구분합니다. 재개는 `--resume "기존결과폴더"`, 연속키 만료 시 월 재시작은
`--restart-window`를 추가합니다. 기존 원문과 중복/변경 관측을 삭제하지 않습니다.

`results/`에는 금융 원문이 포함될 수 있으므로 Git에서 제외합니다. 미니스탁·과거 범위의
미확인 및 미완료 구간은 `report.json`의 `coverage`에 남습니다. 응답 종료나 과거의
빈 결과만으로 전체 이력 확보를 판정하지 않습니다. 별도 R2 업로드 기능은 없습니다.
