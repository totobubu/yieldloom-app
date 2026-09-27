/**
 * HTTP 및 에러 처리 관련 타입 정의
 */

/**
 * 사용자 친화적 에러 메시지
 */
export interface UserMessage {
  title: string;
  message: string;
  type: 'network' | 'client' | 'auth' | 'permission' | 'notfound' | 'ratelimit' | 'server' | 'unknown';
}

/**
 * HTTP 에러 (확장)
 */
export interface HttpError extends Error {
  response?: {
    status: number;
    data?: any;
  };
  config?: {
    url?: string;
    method?: string;
    __retryCount?: number;
    __maxRetries?: number;
    __startTime?: number;
  };
  userMessage?: UserMessage;
}

/**
 * HTTP 요청 옵션
 */
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url?: string;
  data?: any;
  params?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
  __maxRetries?: number;
  __retryCount?: number;
  __startTime?: number;
}

/**
 * HTTP 응답
 */
export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: HttpRequestOptions;
}
