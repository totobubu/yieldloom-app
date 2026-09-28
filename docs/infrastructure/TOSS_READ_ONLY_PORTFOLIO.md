# Toss 읽기 전용 보유수량 연결

Content Studio의 `내 배당` 화면은 `/api/toss-portfolio`를 통해 Toss 증권의 계좌와 보유 주식만 읽습니다. 주문, 주문 가능 금액, 웹소켓 및 자동 동기화는 호출하지 않습니다.

## 배포 설정

Vercel의 서버 환경변수에 다음 두 값을 설정한다. 브라우저 번들에 포함되는 `VITE_` 접두사는 사용하지 않는다.

```text
TOSS_CLIENT_ID=...
TOSS_CLIENT_SECRET=...
```

Toss 증권 WTS Open API 설정에서 Vercel 서버의 egress IP를 허용 IP로 등록한다. 이 값은 로컬 `.env`나 저장소에 커밋하지 않는다.

## 요청 흐름

1. 서버가 `POST /oauth2/token`으로 Client Credentials access token을 발급한다.
2. 서버가 `GET /api/v1/accounts`로 선택 가능한 종합매매 계좌를 반환한다. 전체 계좌번호는 클라이언트에 보내지 않는다.
3. 사용자가 선택한 `accountSeq`로 서버가 `GET /api/v1/holdings`를 호출한다.
4. 서버는 티커, 수량, 시장, 종목명 및 조회 시각만 정규화해 반환한다.
5. 사용자가 `이 스냅샷을 내 배당에 적용`을 눌러야 로컬 포트폴리오에 반영된다.

Toss 스냅샷은 브라우저의 로컬 저장소에만 저장된다. 수동 입력과 같은 티커는 사용자가 스냅샷 적용을 선택할 때만 Toss 수량으로 교체되고, Toss에 없는 직접 입력 종목은 유지된다.

## 점검

- 환경변수가 없으면 API는 `503`과 설정 필요 메시지를 반환한다.
- Toss 인증 또는 허용 IP 오류도 `503`으로 표시하며 토큰·비밀값은 응답이나 로그에 포함하지 않는다.
- 계좌 또는 보유 종목이 없으면 빈 배열을 정상 결과로 처리한다.
- 실제 연동 전후에는 `node --test tests/toss_portfolio.test.mjs`와 `npm run build`를 실행한다.
