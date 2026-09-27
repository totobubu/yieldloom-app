# 📊 토스 증권 거래내역서 자동 등록 시스템

## 🎯 개요

토스 증권 거래내역서 PDF를 업로드하면 자동으로 계좌와 자산을 등록하는 시스템입니다.

## 🔄 전체 플로우

```
1. 사용자가 "거래내역서 업로드" 버튼 클릭
   ↓
2. 증권사 선택 (토스증권, kb자산운용 등)
   ↓
3. PDF 파일 업로드
   ↓
4. Python 스크립트로 PDF 파싱
   ↓
5. 계좌번호 자동 추출 및 계좌 등록
   ↓
6. ISIN 기반 자산 자동 등록
   ↓
7. 완료!
```

## 📁 파일 구조

### 1. 컴포넌트

#### `src/components/asset/BrokerageUploadDialog.vue`

- **역할**: 증권사 선택 및 PDF 업로드
- **3단계 구성**:
    - Step 1: 증권사 선택
    - Step 2: PDF 파일 업로드
    - Step 3: 추출된 계좌 정보 확인

### 2. API

#### `api/parsePdfTransaction.py`

- **역할**: PDF 파일을 받아서 파싱
- **지원 증권사**: 토스증권
- **처리 과정**:
    1. 업로드된 파일을 임시 경로에 저장
    2. Python 파서 호출
    3. JSON 결과 반환

### 3. Python 스크립트

#### `scripts/utils/extract_toss_transactions.py`

- **역할**: 토스 증권 PDF에서 거래 데이터 추출
- **추출 정보**:
    - 계좌번호, 발급번호, 거래 기간
    - 거래 내역 (날짜, 종목명, 수량, 단가 등)
- **모드**:
    - API 모드: JSON 반환
    - 로컬 모드: 통계 및 샘플 출력

### 4. 통합

#### `src/pages/AssetView.vue`

- **추가된 기능**:
    - "거래내역서 업로드" 버튼
    - `handleTransactionUploadComplete()`: 계좌 및 계좌 구조 자동 등록
    - `registerTransactionsByIsin()`: 추출된 ISIN으로 자산 등록 및 메모 기록

## 🔐 Firestore 데이터 구조

### 사용자 계좌 구조

```
userAssets/{userId}/familyMembers/{memberId}/
  brokerages/{brokerageId}/
    - name: "토스증권"
    accounts/{accountId}/
      - name: "미국주식 계좌"
      - accountNumber: "130-01-006341"
      assets/{assetId}/
        - type: "주식"
        - symbol: "US88636J6423"
        - amount: 184
        - currency: "USD"
        - notes: "ISIN: US88636J6423\n원본 종목명: 일드맥스 M7 옵션 인컴 ETF\n토스 거래내역서 기반 자동 등록"
```

## 🚀 사용 방법

### 1. 사전 준비

```bash
# Python 패키지 설치
pip install pdfplumber tabulate

# Node 패키지 설치
npm install
```

### 2. PDF 업로드

1. 자산관리 페이지에서 가족 구성원 선택
2. "거래내역서 업로드" 버튼 클릭
3. "토스증권" 선택
4. PDF 파일 업로드
5. 추출된 계좌 정보 확인 후 "등록하기"

### 3. 완료

- 자산 목록에서 자동 등록된 자산 확인
- TreeTable에서 계층 구조 확인

## 🛠️ 개발자 가이드

### 새로운 증권사 추가하기

1. **파싱 스크립트 작성**

```python
# scripts/extract_{brokerage}_transactions.py
def extract_transactions_from_pdf(pdf_path):
    # PDF 파싱 로직
    return {
        'metadata': {...},
        'transactions': [...]
    }
```

2. **API 핸들러 추가**

```python
# api/parsePdfTransaction.py
if brokerage == "kb":
    result = extract_kb_transactions(temp_file_path)
```

3. **증권사 옵션 추가**

```javascript
// src/components/asset/BrokerageUploadDialog.vue
const brokerageOptions = [
    { label: '토스증권', value: 'toss' },
    { label: 'kb자산운용', value: 'kb' }, // 추가
];
```

## 📊 추출 가능한 데이터

### 토스증권 거래내역서

- ✅ 계좌번호
- ✅ 발급번호
- ✅ 거래 기간
- ✅ 거래 일자
- ✅ 거래 구분 (구매/판매)
- ✅ 종목명 (한글)
- ✅ 종목 코드 (ISIN, US…)
- ✅ 환율
- ✅ 거래 수량
- ✅ 거래 대금 (원화/달러)
- ✅ 단가 (원화/달러)
- ✅ 수수료, 제세금
- ✅ 잔고, 잔액

## 🎨 주요 특징

### 1. 자동 계좌 등록

- PDF에서 추출한 계좌번호로 자동 생성
- 증권사가 없으면 자동으로 추가
- 계좌 이름은 사용자가 수정 가능

### 2. ISIN 기반 자산 자동 분류

- PDF에서 추출한 ISIN(또는 토스 종목 코드)을 바로 활용
- 별도 매핑 작업 없이 자산 심볼과 수량 계산
- 원본 종목명을 메모에 기록하여 추적 가능

### 3. 거래내역 자동 등록

- 종목별로 그룹화하여 자산 등록
- 총 보유 수량 자동 계산 (매도 거래는 음수 반영)
- 처리 결과를 토스트로 안내

### 4. 에러 처리

- 파싱 실패 시 사용자 친화적 메시지
- 부분 실패 시 성공한 항목만 등록
- 로그를 통해 상세 원인 확인 가능

## 🐛 트러블슈팅

### PDF 파싱 실패

- Python이 설치되어 있는지 확인
- pdfplumber 패키지가 설치되어 있는지 확인
- PDF 파일 형식이 올바른지 확인 (스캔 PDF는 지원 안함)

### 자산 등록 실패

- Firestore 권한 확인
- 네트워크 연결 확인
- 브라우저 콘솔에서 에러 메시지 확인

## 📝 향후 개선 사항

- [ ] 다른 증권사 지원 (KB, 미래에셋, 삼성 등)
- [ ] 배당 내역 자동 등록
- [ ] 매도 거래 처리 고도화 (거래 히스토리 보관)
- [ ] Excel/CSV 파일 지원
- [ ] ISIN 미존재 거래 처리 로직 고도화

## 🙏 감사의 말

이 기능은 사용자의 자산 관리 편의성을 높이기 위해 만들어졌습니다.
피드백과 개선 제안은 언제든 환영합니다!
