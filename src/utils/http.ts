/**
 * HTTP Client with Retry Logic & Error Handling
 *
 * 기능:
 * - 자동 재시도 (exponential backoff)
 * - 에러 처리 및 사용자 친화적 메시지
 * - 요청/응답 인터셉터
 * - 타임아웃 설정
 */

import axios, { type InternalAxiosRequestConfig, type AxiosError, type AxiosResponse } from 'axios';
import { reportError } from './sentry';

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
  __startTime?: number;
  __maxRetries?: number;
}

/**
 * Axios 인스턴스 생성
 */
const http = axios.create({
  timeout: 30000, // 30초
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Exponential Backoff 계산
 */
function getRetryDelay(retryCount: number) {
  return Math.min(1000 * Math.pow(2, retryCount), 10000); // 최대 10초
}

/**
 * 재시도 가능한 에러인지 확인
 */
function isRetryableError(error: AxiosError) {
  if (!error.response) {
    // 네트워크 에러 (응답 없음)
    return true;
  }

  const status = error.response.status;

  // 5xx 서버 에러 및 일부 4xx 에러는 재시도
  return (
    status >= 500 || // 서버 에러
    status === 408 || // Request Timeout
    status === 429 || // Too Many Requests
    status === 503 || // Service Unavailable
    status === 504    // Gateway Timeout
  );
}

/**
 * 사용자 친화적 에러 메시지 생성
 */
function getUserFriendlyMessage(error: AxiosError) {
  if (!error.response) {
    return {
      title: '네트워크 연결 오류',
      message: '인터넷 연결을 확인해주세요.',
      type: 'network'
    };
  }

  const status = error.response.status;

  switch (status) {
    case 400:
      return {
        title: '잘못된 요청',
        message: '요청 내용을 확인해주세요.',
        type: 'client'
      };
    case 401:
      return {
        title: '인증 필요',
        message: '로그인이 필요합니다.',
        type: 'auth'
      };
    case 403:
      return {
        title: '접근 권한 없음',
        message: '이 기능에 접근할 권한이 없습니다.',
        type: 'permission'
      };
    case 404:
      return {
        title: '데이터를 찾을 수 없음',
        message: '요청한 정보가 존재하지 않습니다.',
        type: 'notfound'
      };
    case 429:
      return {
        title: '요청 제한 초과',
        message: '잠시 후 다시 시도해주세요.',
        type: 'ratelimit'
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        title: '서버 오류',
        message: '일시적인 서버 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
        type: 'server'
      };
    default:
      return {
        title: '오류 발생',
        message: '알 수 없는 오류가 발생했습니다.',
        type: 'unknown'
      };
  }
}

/**
 * Request 인터셉터
 */
http.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const customConfig = config as CustomAxiosRequestConfig;
    // 재시도 카운트 초기화
    customConfig.__retryCount = customConfig.__retryCount || 0;

    // 요청 시작 시간 기록 (성능 모니터링용)
    customConfig.__startTime = Date.now();

    return customConfig;
  },
  (error: any) => {
    return Promise.reject(error);
  }
);

/**
 * Response 인터셉터 (재시도 로직 포함)
 */
http.interceptors.response.use(
  (response) => {
    // 성공 응답 - 성능 로그
    const customConfig = response.config as CustomAxiosRequestConfig;
    const duration = Date.now() - (customConfig.__startTime || 0);
    if (duration > 5000) {
      console.warn(`⚠️ 느린 응답: ${customConfig.url} (${duration}ms)`);
    }

    return response;
  },
  async (error) => {
    const config = error.config as CustomAxiosRequestConfig;

    // 재시도 불가능한 경우
    if (!config || !isRetryableError(error)) {
      // Sentry에 에러 리포트
      reportError(error, {
        url: config?.url,
        method: config?.method,
        status: error.response?.status
      });

      // 사용자 친화적 에러 추가
      (error as any).userMessage = getUserFriendlyMessage(error);

      return Promise.reject(error);
    }

    // 최대 재시도 횟수 확인
    const maxRetries = config.__maxRetries || 3;
    if ((config.__retryCount || 0) >= maxRetries) {
      console.error(`❌ 최대 재시도 횟수 초과: ${config.url}`);

      // Sentry에 에러 리포트
      reportError(error, {
        url: config.url,
        method: config.method,
        retries: config.__retryCount
      });

      (error as any).userMessage = getUserFriendlyMessage(error);
      return Promise.reject(error);
    }

    // 재시도 카운트 증가
    config.__retryCount = (config.__retryCount || 0) + 1;

    // 지연 시간 계산
    const delay = getRetryDelay(config.__retryCount);

    console.log(`🔄 재시도 ${config.__retryCount}/${maxRetries}: ${config.url} (${delay}ms 후)`);

    // 지연 후 재시도
    await new Promise(resolve => setTimeout(resolve, delay));

    return http(config);
  }
);

/**
 * GET 요청 (캐시 옵션 포함)
 */
export async function get<T = any>(url: string, options: any = {}): Promise<import('axios').AxiosResponse<T>> {
  const config = {
    method: 'GET',
    url,
    ...options
  };

  return http(config);
}

/**
 * POST 요청
 */
export async function post<T = any>(url: string, data: any, options: any = {}): Promise<AxiosResponse<T>> {
  const config = {
    method: 'POST',
    url,
    data,
    ...options
  };

  return http(config);
}

/**
 * PUT 요청
 */
export async function put<T = any>(url: string, data: any, options: any = {}): Promise<AxiosResponse<T>> {
  const config = {
    method: 'PUT',
    url,
    data,
    ...options
  };

  return http(config);
}

/**
 * DELETE 요청
 */
export async function del<T = any>(url: string, options: any = {}): Promise<AxiosResponse<T>> {
  const config = {
    method: 'DELETE',
    url,
    ...options
  };

  return http(config);
}

export default http;
