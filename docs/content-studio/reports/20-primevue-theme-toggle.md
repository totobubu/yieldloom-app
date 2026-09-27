# 20. PrimeVue 테마 전환

## 완료 범위

- 콘텐츠 스튜디오의 PrimeVue `Button`에 현재 전환 대상인 `라이트 모드` 또는 `다크 모드` 라벨을 표시했다.
- 버튼의 `aria-pressed`, 설명 툴팁, 해·달 아이콘을 현재 테마 상태와 연결했다.
- `useLayout()`의 `p-dark` 상태를 문서 루트와 콘텐츠 스튜디오 루트에 모두 반영했다.
- CSS는 두 위치를 모두 인식하도록 수정해 전역 PrimeVue dark selector와 콘텐츠 스튜디오 자체 색상 토큰이 동시에 전환된다.

## 동작

- 선택은 기존 `layoutConfig` localStorage 설정에 유지된다.
- PrimeVue Lara 기반 `MyPreset`의 `darkModeSelector: '.p-dark'`를 그대로 사용한다.

## 검증

- `npm run type-check` 수행.
