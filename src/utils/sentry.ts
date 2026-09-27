/**
 * Sentry Error Tracking 설정
 *
 * - 프론트엔드 에러 자동 추적
 * - 사용자 피드백 수집
 * - 성능 모니터링
 */

import * as Sentry from '@sentry/vue';
import type { App } from 'vue';
import type { Router } from 'vue-router';

/**
 * Sentry 초기화
 * @param {Object} app - Vue 앱 인스턴스
 * @param {Object} router - Vue Router 인스턴스
 */
export function initSentry(app: App, router: Router) {
  // 개발 환경에서는 Sentry 비활성화
  if (import.meta.env.DEV) {
    console.log('🔧 개발 모드: Sentry 비활성화');
    return;
  }

  // Sentry DSN이 없으면 건너뛰기
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn('⚠️ VITE_SENTRY_DSN이 설정되지 않았습니다.');
    return;
  }

  Sentry.init({
    app,
    dsn,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // 성능 모니터링 샘플 레이트 (10%)
    tracesSampleRate: 0.1,

    // Session Replay 샘플 레이트
    replaysSessionSampleRate: 0.1, // 정상 세션의 10%
    replaysOnErrorSampleRate: 1.0, // 에러 발생 시 100%

    // 환경 설정
    environment: import.meta.env.MODE,

    // 릴리스 버전 (package.json의 version 사용)
    release: `divgrow@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,

    // 무시할 에러 패턴
    ignoreErrors: [
      // 브라우저 확장 프로그램 에러
      'top.GLOBALS',
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      'atomicFindClose',

      // 네트워크 에러 (재시도 로직에서 처리)
      'NetworkError',
      'Failed to fetch',
      'Load failed',

      // ResizeObserver 관련 (무해한 경고)
      'ResizeObserver loop',
    ],

    // PII 데이터 제외
    beforeSend(event, _hint) {
      // 사용자 이메일 마스킹
      if (event.user && event.user.email) {
        event.user.email = event.user.email.replace(/(.{2}).*(@.*)/, '$1***$2');
      }

      // 민감한 쿼리 파라미터 제거
      if (event.request && event.request.url) {
        event.request.url = event.request.url.replace(/([?&])(token|key|password)=[^&]*/gi, '$1$2=***');
      }

      return event;
    },
  });

  console.log('✅ Sentry 초기화 완료');
}

/**
 * 수동으로 에러 리포트
 */
export function reportError(error: any, context: Record<string, any> = {}) {
  Sentry.captureException(error, {
    contexts: {
      custom: context
    }
  });
}

/**
 * 사용자 정보 설정
 */
export function setUser(user: { uid: string; email?: string } | null) {
  if (user) {
    Sentry.setUser({
      id: user.uid,
      email: user.email,
    });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * 커스텀 이벤트 기록
 */
export function logEvent(message: string, level: Sentry.SeverityLevel = 'info', context: Record<string, any> = {}) {
  Sentry.captureMessage(message, {
    level,
    contexts: {
      custom: context
    }
  });
}
