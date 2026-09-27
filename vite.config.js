import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { PrimeVueResolver } from 'unplugin-vue-components/resolvers';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/',
    plugins: [
        vue(),
        // AutoImport 플러그인은 잠시 제거하고, Components 플러그인만 사용합니다.
        // 이것이 PrimeVue 컴포넌트를 자동으로 가져오는 핵심입니다.
        Components({
            resolvers: [PrimeVueResolver()],
            // d.ts 파일 경로를 명시하지 않으면, 기본 경로에 자동으로 생성됩니다.
            // 경로 문제일 수 있으므로 이 옵션을 제거하여 테스트합니다.
            // dts: 'src/components.d.ts',
        }),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    build: {
        // 빌드 최적화
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    // node_modules를 vendor chunk로 분리
                    if (id.includes('node_modules')) {
                        // PrimeVue 관련
                        if (id.includes('primevue') || id.includes('primeicons') || id.includes('primeflex')) {
                            return 'primevue';
                        }
                        // 차트 라이브러리 (ECharts)
                        if (id.includes('echarts') || id.includes('vue-echarts')) {
                            return 'chart';
                        }
                        // FullCalendar
                        if (id.includes('@fullcalendar')) {
                            return 'fullcalendar';
                        }
                        // Firebase
                        if (id.includes('firebase')) {
                            return 'firebase';
                        }
                        // 나머지 vendor
                        return 'vendor';
                    }
                },
            },
        },
        // 청크 크기 경고 한계 증가 (대용량 라이브러리 때문)
        chunkSizeWarningLimit: 1000,
        // gzip 압축은 Vercel이 자동으로 처리하므로 여기서는 설정하지 않음
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true, // 프로덕션에서 console.log 제거
            },
        },
    },
    server: {
        proxy: {
            '/api': {
                // --- Vercel 배포 주소 확인 ---
                target: 'https://totobubu-github-io.vercel.app',
                changeOrigin: true,
                // (선택) 더 복잡한 문제를 해결하기 위해 rewrite 추가
                rewrite: (path) => path.replace(/^\/api/, '/api'),
            },
        },
    },
});
