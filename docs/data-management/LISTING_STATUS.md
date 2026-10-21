# 상장폐지 종목 관리

`data-v2/security-status.json`이 앱의 상장 상태 관리 원본이다. 외부 카탈로그·발견 목록을 병합한 뒤 적용하므로 오래된 `active: true`가 확정 상태를 되돌리지 않는다. 목록에 종목이 없어도 관리 파일의 기본 정보로 과거 이력 상세 주소를 유지한다. 기존 `active: false`만으로는 상장폐지라고 판단하지 않는다.

## 등록과 확인

1. `securities`에 기존 카탈로그와 같은 `symbol`, `market`, `isin`, `currency`, 종목명·운용사를 등록한다. 현재 지원하는 상태는 `delisted`다.
2. `reason`, `checkedOn`(YYYY-MM-DD), `source.type`, `source.reference`, `source.url`, `officialVerified`를 기록한다. 미확인 `delistedOn`·`lastTradingOn`은 `null`로 두며 청산일로 대체하지 않는다.
3. 사용자 확인은 `source.type: "user_report"`, `officialVerified: false`로 기록한다. 공식 공시 확인 후 `source.type: "official"`, `officialVerified: true`, 공식 HTTPS URL과 공시명을 기록한다.
4. `npm run data:validate-status`로 중복 종목·상태·날짜·근거를 검사한다. 파일은 변경하지 않는다.
5. `npm run core:catalog:seed`로 카탈로그를 재생성하고 diff를 검토한다. 기존 메타데이터 갱신이 함께 생길 수 있으므로 무관한 변경은 포함하지 않는다. 앱 빌드·배포로 관리 파일을 프런트엔드와 API에 함께 반영한다. 원격 데이터 공급 저장소에도 상태 반영이 필요한 경우 그 저장소를 별도로 갱신한다.

COII는 사용자 확인으로 등록했으며 공식 상폐일·최종 거래일은 아직 확인되지 않았다. 공식 검증 완료로 표시하지 않는다. 오류 정정은 관리 파일과 생성 카탈로그의 해당 항목을 함께 수정하고 재배포한다.

## 앱 동작과 자료 보존

- 기본 검색에서는 제외한다. `상장폐지 포함` 체크박스 또는 `?delisted=1`로 조회한다. 필터 변경은 로컬 계산이며 네트워크 요청을 추가하지 않는다.
- 기존 `/stock/COII` 주소를 유지한다. 상세 API는 이력이 없어도 종목 정보·근거와 `listingStatus`, `dataStatus: "archived"`를 반환한다.
- 과거 가격·배당은 보존한다. 마지막 보관 가격과 기준일을 표시하며 결측 가격은 `null`이다. `regularMarketPrice`는 `null`, `sourceStatus.freshness`는 `archived`다. `stock-prices`의 상폐 응답은 보관 종가 이력을 반환하며 OHLC 값을 만들어내지 않는다. 상세에서는 종가 표를 사용한다.
- 카드·게시 패키지·다음 배당 추정·라이벌 비교를 제공하지 않는다. OG 카드 API는 상폐 종목에 410을 반환한다. 과거 스냅샷의 예측 행은 표시하지 않으며 기존 스냅샷을 빈 자료로 덮어쓰지 않는다.
- 보유 수량, 매매·배당 거래, 청산금은 자동 수정하지 않는다. 포트폴리오의 기존 가격 기준일·평가 가능 여부 검증을 유지한다. 추가 Firestore 조회나 쓰기는 없다.

## 정기 수집과 과거 자료 보완

정기 썸네일 projection 갱신, 미국 정보 수집, 미국·한국 과거 가격 갱신에서 상폐 종목을 제외한다. 기존 객체와 이력은 삭제하지 않는다. 미래 배당 projection 생성에서도 제외한다.

검토한 과거 자료를 보완할 때만 명시적으로 포함한다.

```sh
node scripts/thumbnail_pipeline/refresh.mjs --symbols COII --include-delisted --dry-run
node tasks/updateHistoricalUsData.js COII --include-delisted
```

첫 명령은 네트워크 조회·검증만 수행하며 R2를 변경하지 않는다. 검토 후 `--dry-run`을 제거하면 기존 수집기의 설정에 따라 R2를 갱신한다. 이 옵션은 상폐 상태나 카드·추정 차단을 해제하지 않는다. 외부 공급 저장소의 수집 작업은 해당 저장소에서 별도 관리한다.

`classify_failed_symbols.py`의 모든 조회 실패는 `needs_review`로 분류한다. 가격 조회 실패, HTTP 오류, 접미사 미발견만으로 이 관리 파일을 갱신하거나 상폐를 확정하지 않는다.
