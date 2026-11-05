# 통합 후보 Python 번들 한도 수정

#265의39e9b67 Vercel Preview dpl_3LHVzaVHN99FbLtX66qv8YF9B5NC가 LAMBDA_SIZE_EXCEEDED로 실패했다. 실제 응답은228.11MB 대 허용225MB다. 일반 계정 저장 용량 초과라고 단정하지 않는다.

Python용 기존 excludeFiles에 docs만 추가한다. API Python 파일에 docs 경로를 읽는 참조가 없고 로컬 docs54MB 중 디자인 비교 자료가53MB다. 원본 HTML·PNG·검증 기록은 Git에 그대로 보존하며 Python 함수 패키지에서 제외한다. API 코드·lib·Python 의존성과 프런트엔드 빌드/정적 배포는 변경하지 않는다. headers·rewrites·redirects·보안·권한 설정도 그대로다.

공식 Python Runtime 문서의 Controlling what gets bundled의 excludeFiles 방법을 따랐다: https://vercel.com/docs/functions/runtimes/python#controlling-what-gets-bundled

JSON 파싱 및 기존 설정과의 구조 대조에서 Python excludeFiles 한 항목만 변경됨을 확인했다. 실제 원격 빌드가 다시 성공하기 전 원인이 해결됐다고 주장하지 않는다. 변경 후 CI/Preview·익명 API 응답 확인은 후속 실제 증거에 기록한다. 검토만 포함한 #264의 work543748e에는 이 후보를 섞지 않는다.
