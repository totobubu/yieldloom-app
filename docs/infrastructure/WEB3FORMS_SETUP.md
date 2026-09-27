# Web3Forms 설정 가이드

## 1. Web3Forms 계정 생성 및 API 키 발급

### 1단계: 회원가입
1. https://web3forms.com 접속
2. 오른쪽 상단 "Get Started" 또는 "Sign Up" 클릭
3. 이메일로 계정 생성 (GitHub 로그인도 가능)

### 2단계: Access Key 발급
1. 로그인 후 Dashboard로 이동
2. "Create New Form" 클릭
3. **Email Address**에 `totobubu.lab@gmail.com` 입력
   - 이 주소로 모든 문의가 전송됩니다
4. "Create Form" 클릭
5. **Access Key** 복사 (예: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## 2. Vercel 환경 변수 설정

### Vercel Dashboard에서 설정
1. https://vercel.com 로그인
2. 프로젝트 선택 (`totobubu.github.io`)
3. Settings → Environment Variables 메뉴
4. 새 변수 추가:
   - **Name**: `WEB3FORMS_ACCESS_KEY`
   - **Value**: 복사한 Access Key
   - **Environment**: Production, Preview, Development 모두 체크
5. "Save" 클릭

### 로컬 개발 환경 설정
프로젝트 루트에 `.env` 파일 생성:
```bash
WEB3FORMS_ACCESS_KEY=your_access_key_here
```

⚠️ **중요**: `.env` 파일은 `.gitignore`에 포함되어 있어야 합니다!

## 3. 설치 및 배포

### 의존성 업데이트
```bash
npm install
```

### 로컬 테스트
```bash
npm run dev
```
- http://localhost:5173/contact 접속
- 문의 폼 테스트

### Vercel 재배포
```bash
git add .
git commit -m "feat: Web3Forms로 이메일 서비스 변경"
git push origin main
```

Vercel이 자동으로 배포하고 환경 변수를 적용합니다.

## 4. 테스트

1. 배포된 사이트의 문의 페이지 접속
2. 테스트 문의 작성 후 전송
3. `totobubu.lab@gmail.com`에서 메일 확인
4. "답장" 클릭 시 사용자의 이메일로 바로 회신 가능 (replyto 기능)

## 5. Resend 탈퇴 (선택사항)

이제 Resend를 사용하지 않으므로:
1. https://resend.com 로그인
2. Settings → Account → Delete Account
3. 탈퇴 진행

## Web3Forms 주요 기능

### 무료 플랜
- ✅ 월 250개 메시지
- ✅ 스팸 방지 (Honeypot)
- ✅ 파일 첨부 (최대 5MB)
- ✅ 자동 응답 이메일
- ✅ Webhook 지원

### 유료 플랜 ($3/월)
- 월 1,000개 메시지
- 파일 첨부 최대 10MB
- 우선 지원

## Web3Forms 대시보드 기능

- 📊 전송된 메시지 통계
- 📧 메시지 히스토리 조회
- 🔔 알림 설정
- 🎨 커스텀 성공/실패 페이지
- 🔗 Webhook 연동 (Slack, Discord 등)

## 문제 해결

### "API key not found" 오류
- Vercel 환경 변수 설정 확인
- 재배포 필요 (환경 변수 변경 시)

### "Email not sent" 오류
- Web3Forms Dashboard에서 Access Key 확인
- 이메일 주소가 올바른지 확인
- 월 할당량 초과 여부 확인

### 메일이 스팸함으로 가는 경우
- Gmail 설정에서 `notifications@web3forms.com`을 안전한 발신자로 추가
- Web3Forms Dashboard에서 "Custom Reply-To" 설정

## 추가 커스터마이징

### 자동 응답 메일 보내기
`api/sendEmail.js`에 다음 필드 추가:
```javascript
autorespond: true,
autorespond_subject: "문의해주셔서 감사합니다",
autorespond_message: "빠른 시일 내에 답변드리겠습니다."
```

### 스팸 방지 강화
```javascript
botcheck: true, // Honeypot 활성화
```

### Webhook 연동 (Slack 알림 등)
Web3Forms Dashboard → Settings → Webhooks에서 설정

## 참고 자료

- 📖 공식 문서: https://docs.web3forms.com
- 💬 지원: https://web3forms.com/support
- 🎮 예제: https://web3forms.com/examples

