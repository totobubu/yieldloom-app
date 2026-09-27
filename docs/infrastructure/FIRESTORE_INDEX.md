# Firestore 인덱스 설정

관리자 페이지에서 koName 승인 대기 목록을 조회하기 위해 Firestore 인덱스가 필요합니다.

## 필요한 인덱스

collectionGroup 쿼리를 사용하여 모든 사용자의 `assets` 서브컬렉션에서 `koNameApprovalStatus`가 `pending`인 문서를 조회합니다.

**중요**: 이 쿼리는 단일 필드에 대한 등호 연산자만 사용하므로 **단일 필드 인덱스**만 필요합니다. 복합 인덱스가 아닙니다.

### 인덱스 생성 방법

#### 방법 1: Firebase 콘솔에서 생성 (권장)

1. Firebase 콘솔에 접속합니다.
2. Firestore Database > Indexes 탭으로 이동합니다.
3. 상단에서 **"단일 필드"** (Single Field) 탭을 선택합니다.
4. "색인 만들기" (Create Index) 버튼을 클릭합니다.
5. 다음 설정으로 인덱스를 생성합니다:
    - **컬렉션 ID**: `assets`
    - **쿼리 범위**: **컬렉션 그룹** (Collection Group) 선택
    - **필드 경로**: `koNameApprovalStatus`
    - **정렬 순서**: 오름차순 (Ascending)

#### 방법 2: 앱에서 쿼리 실행 (자동 생성 링크)

1. 관리자 페이지(`/admin`)에 접속합니다.
2. 브라우저 콘솔에서 쿼리가 실행되면 Firebase가 자동으로 필요한 인덱스 생성 링크를 제공합니다.
3. 해당 링크를 클릭하여 인덱스를 생성합니다.

#### 방법 3: firestore.indexes.json 파일에 추가

프로젝트 루트에 `firestore.indexes.json` 파일을 생성하고 다음 내용을 추가합니다:

```json
{
    "indexes": [
        {
            "collectionGroup": "assets",
            "queryScope": "COLLECTION_GROUP",
            "fields": [
                {
                    "fieldPath": "koNameApprovalStatus",
                    "order": "ASCENDING"
                }
            ]
        }
    ],
    "fieldOverrides": []
}
```

그 후 Firebase CLI로 배포:

```bash
firebase deploy --only firestore:indexes
```

## 참고

- **단일 필드 인덱스**를 사용하세요. 복합 인덱스가 아닙니다.
- 인덱스 생성에는 몇 분이 소요될 수 있습니다.
- 인덱스가 생성되기 전까지는 쿼리가 실패할 수 있습니다.
- 인덱스 생성 후에도 쿼리가 실패하면 브라우저 콘솔의 에러 메시지를 확인하세요.
- Firebase 콘솔에서 "단일 필드" 탭을 사용하여 인덱스를 생성하는 것이 가장 간단합니다.
