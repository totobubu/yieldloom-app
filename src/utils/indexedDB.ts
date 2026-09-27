/**
 * IndexedDB Wrapper for Calendar Data Caching
 *
 * 목적: 대용량 calendar 데이터를 로컬에 캐싱하여 성능 향상
 * - 월별 calendar 데이터 저장
 * - 자동 만료 (30일)
 * - 버전 관리
 */

const DB_NAME = 'DivGrowCache';
const DB_VERSION = 1;
const STORE_NAME = 'calendarData';
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30일

class IndexedDBCache {
    private db: IDBDatabase | null;

    constructor() {
        this.db = null;
    }

    /**
     * DB 초기화
     */
    async init(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB 열기 실패:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // calendarData store 생성
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, {
                        keyPath: 'key',
                    });
                    store.createIndex('timestamp', 'timestamp', {
                        unique: false,
                    });
                    console.log('✓ IndexedDB store 생성:', STORE_NAME);
                }
            };
        });
    }

    /**
     * 데이터 저장
     * @param {string} key - 저장 키 (예: "2024-11")
     * @param {Object} data - 저장할 데이터
     */
    async set(key: string, data: any) {
        await this.init();

        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('DB not initialized');
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const record = {
                key,
                data,
                timestamp: Date.now(),
                version: DB_VERSION,
            };

            const request = store.put(record);

            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.error('IndexedDB 저장 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 데이터 조회
     * @param {string} key - 조회 키
     * @returns {Object|null} - 캐시된 데이터 또는 null
     */
    async get<T = any>(key: string): Promise<T | null> {
        await this.init();

        return new Promise((resolve, reject) => {
            const db = this.db;
            if (!db) {
                reject(new Error('Database not initialized'));
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                const record = request.result;

                if (!record) {
                    resolve(null);
                    return;
                }

                // 만료 체크
                const age = Date.now() - record.timestamp;
                if (age > CACHE_DURATION) {
                    console.log(
                        `캐시 만료: ${key} (${Math.floor(age / 1000 / 60 / 60 / 24)}일 경과)`
                    );
                    this.delete(key); // 만료된 데이터 삭제
                    resolve(null);
                    return;
                }

                resolve(record.data);
            };

            request.onerror = () => {
                console.error('IndexedDB 조회 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 데이터 삭제
     * @param {string} key - 삭제할 키
     */
    async delete(key: string) {
        await this.init();

        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('DB not initialized');
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.error('IndexedDB 삭제 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 모든 데이터 삭제
     */
    async clear() {
        await this.init();

        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('DB not initialized');
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('✓ IndexedDB 캐시 전체 삭제');
                resolve(true);
            };
            request.onerror = () => {
                console.error('IndexedDB 전체 삭제 실패:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 캐시 통계 조회
     */
    async getStats() {
        await this.init();

        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error('DB not initialized');
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result;
                const now = Date.now();

                const stats = {
                    total: records.length,
                    valid: 0,
                    expired: 0,
                    totalSize: 0,
                    oldestEntry: null,
                    newestEntry: null,
                };

                records.forEach((record) => {
                    const age = now - record.timestamp;
                    const sizeKB = JSON.stringify(record.data).length / 1024;

                    stats.totalSize += sizeKB;

                    if (age > CACHE_DURATION) {
                        stats.expired++;
                    } else {
                        stats.valid++;
                    }

                    if (
                        !stats.oldestEntry ||
                        record.timestamp < stats.oldestEntry
                    ) {
                        stats.oldestEntry = record.timestamp;
                    }
                    if (
                        !stats.newestEntry ||
                        record.timestamp > stats.newestEntry
                    ) {
                        stats.newestEntry = record.timestamp;
                    }
                });

                const resultStats = {
                    ...stats,
                    totalSize: stats.totalSize.toFixed(2) + ' KB',
                };

                resolve(resultStats);
            };

            request.onerror = () => {
                console.error('IndexedDB 통계 조회 실패:', request.error);
                reject(request.error);
            };
        });
    }
}

// Singleton 인스턴스
const dbCache = new IndexedDBCache();

export default dbCache;
