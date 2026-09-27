// src/utils/dataUrl.js
/**
 * 데이터 URL 생성 헬퍼
 *
 * 로컬 개발 환경에서는 항상 로컬 파일을 사용합니다.
 * 프로덕션 빌드에서만 R2를 사용할 수 있습니다.
 */
import { joinURL } from 'ufo';

const USE_R2 = import.meta.env.VITE_USE_R2 === 'true';
const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || '';
const IS_DEV = import.meta.env.DEV;
const R2_ELIGIBLE_PREFIXES = ['data/', 'logos/'];

const normalizePath = (path) => {
    if (!path) return '';
    return path.startsWith('/') ? path.slice(1) : path;
};

const shouldUseR2 = (normalizedPath) => {
    // 개발 환경이라도 VITE_USE_R2가 true이면 R2 사용 허용
    if (IS_DEV && !USE_R2) return false;

    if (!USE_R2 || !R2_PUBLIC_URL) return false;
    return R2_ELIGIBLE_PREFIXES.some((prefix) =>
        normalizedPath.startsWith(prefix)
    );
};

const buildAssetUrl = (path) => {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
        return joinURL(import.meta.env.BASE_URL, '');
    }

    if (shouldUseR2(normalizedPath)) {
        return joinURL(R2_PUBLIC_URL, normalizedPath);
    }

    return joinURL(import.meta.env.BASE_URL, normalizedPath);
};

/**
 * 데이터/정적 파일 URL 생성
 *
 * - 개발 환경에서는 항상 로컬 파일을 사용합니다.
 * - 프로덕션에서는 `data/` 및 `logos/` 하위 경로만 R2를 사용합니다.
 */
export function getDataUrl(path) {
    return buildAssetUrl(path);
}

/**
 * 로고와 같은 정적 자산 URL 생성
 */
export function getAssetUrl(path) {
    return buildAssetUrl(path);
}

/**
 * R2 사용 여부 확인
 *
 * 개발 환경에서는 항상 false를 반환합니다.
 */
export function isUsingR2() {
    if (IS_DEV) {
        return false;
    }
    return USE_R2 && !!R2_PUBLIC_URL;
}

/**
 * 인자로 받은 path에 대해 강제로 R2 URL을 반환합니다.
 * 폴백(fallback) 용도로 사용됩니다.
 */
export function getR2Url(path) {
    if (!R2_PUBLIC_URL) return '';
    return joinURL(R2_PUBLIC_URL, normalizePath(path));
}
