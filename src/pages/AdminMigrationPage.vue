<!-- src/pages/AdminMigrationPage.vue -->
<template>
    <div class="p-4">
        <Card>
            <template #title>
                <div class="flex align-items-center gap-2">
                    <i class="pi pi-cog"></i>
                    <span>자산 Symbol 마이그레이션</span>
                </div>
            </template>
            <template #content>
                <div class="flex flex-column gap-4">
                    <Message severity="info">
                        Firebase의 userAssets 컬렉션에서 symbol 필드가 ISIN으로
                        잘못 저장된 데이터를 실제 symbol로 변환합니다.
                    </Message>

                    <div class="flex flex-column gap-3">
                        <div class="flex align-items-center gap-2">
                            <Checkbox
                                v-model="dryRun"
                                inputId="dryRun"
                                :binary="true" />
                            <label for="dryRun" class="font-semibold">
                                Dry Run 모드 (실제 변경하지 않고 확인만)
                            </label>
                        </div>

                        <div class="flex gap-2">
                            <Button
                                label="현재 사용자 마이그레이션"
                                icon="pi pi-user"
                                @click="migrateCurrentUser"
                                :loading="loading"
                                :disabled="loading" />
                            <Button
                                label="모든 사용자 마이그레이션"
                                icon="pi pi-users"
                                severity="danger"
                                @click="migrateAllUsers"
                                :loading="loading"
                                :disabled="loading" />
                        </div>
                    </div>

                    <Divider />

                    <div v-if="results" class="flex flex-column gap-3">
                        <h3>마이그레이션 결과</h3>

                        <div class="grid">
                            <div class="col-12 md:col-3">
                                <div
                                    class="surface-card p-3 border-round shadow-2">
                                    <div class="text-500 font-medium mb-2">
                                        총 자산 수
                                    </div>
                                    <div class="text-900 text-xl font-bold">
                                        {{ results.total || 0 }}
                                    </div>
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div
                                    class="surface-card p-3 border-round shadow-2">
                                    <div class="text-500 font-medium mb-2">
                                        마이그레이션 필요
                                    </div>
                                    <div
                                        class="text-orange-500 text-xl font-bold">
                                        {{ results.needsMigration || 0 }}
                                    </div>
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div
                                    class="surface-card p-3 border-round shadow-2">
                                    <div class="text-500 font-medium mb-2">
                                        성공
                                    </div>
                                    <div
                                        class="text-green-500 text-xl font-bold">
                                        {{ results.migrated || 0 }}
                                    </div>
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div
                                    class="surface-card p-3 border-round shadow-2">
                                    <div class="text-500 font-medium mb-2">
                                        실패
                                    </div>
                                    <div class="text-red-500 text-xl font-bold">
                                        {{ results.failed || 0 }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <DataTable
                            v-if="results.details && results.details.length > 0"
                            :value="results.details"
                            stripedRows
                            class="p-datatable-sm"
                            :paginator="true"
                            :rows="50">
                            <Column
                                field="assetId"
                                header="Asset ID"
                                style="width: 150px" />
                            <Column field="name" header="종목명" />
                            <Column
                                field="oldSymbol"
                                header="이전 Symbol (ISIN)">
                                <template #body="slotProps">
                                    <Tag
                                        :value="slotProps.data.oldSymbol"
                                        severity="warning" />
                                </template>
                            </Column>
                            <Column field="newSymbol" header="새 Symbol">
                                <template #body="slotProps">
                                    <Tag
                                        v-if="slotProps.data.newSymbol"
                                        :value="slotProps.data.newSymbol"
                                        severity="success" />
                                    <Tag
                                        v-else
                                        value="매핑 없음"
                                        severity="danger" />
                                </template>
                            </Column>
                            <Column field="status" header="상태">
                                <template #body="slotProps">
                                    <Tag
                                        v-if="
                                            slotProps.data.status === 'migrated'
                                        "
                                        value="업데이트 완료"
                                        severity="success" />
                                    <Tag
                                        v-else-if="
                                            slotProps.data.status === 'dry-run'
                                        "
                                        value="DRY RUN"
                                        severity="info" />
                                    <Tag
                                        v-else-if="
                                            slotProps.data.status ===
                                            'no-mapping'
                                        "
                                        value="매핑 없음"
                                        severity="danger" />
                                    <Tag
                                        v-else-if="
                                            slotProps.data.status === 'failed'
                                        "
                                        value="실패"
                                        severity="danger" />
                                    <Tag
                                        v-else
                                        :value="slotProps.data.status" />
                                </template>
                            </Column>
                        </DataTable>
                    </div>

                    <div v-if="logs.length > 0" class="flex flex-column gap-2">
                        <h4>실행 로그</h4>
                        <div
                            class="surface-ground p-3 border-round"
                            style="
                                max-height: 400px;
                                overflow-y: auto;
                                font-family: monospace;
                                font-size: 0.875rem;
                            ">
                            <div
                                v-for="(log, index) in logs"
                                :key="index"
                                :class="{
                                    'text-green-500': log.includes('✅'),
                                    'text-red-500': log.includes('❌'),
                                    'text-orange-500': log.includes('⚠️'),
                                    'text-blue-500': log.includes('🔍'),
                                }">
                                {{ log }}
                            </div>
                        </div>
                    </div>
                </div>
            </template>
        </Card>
    </div>
</template>

<script setup>
    import { ref } from 'vue';
    import { user } from '@/store/auth';
    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import Checkbox from 'primevue/checkbox';
    import Message from 'primevue/message';
    import Divider from 'primevue/divider';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Tag from 'primevue/tag';
    import {
        migrateUserAssets,
        migrateAllUsersAssets,
    } from '@/utils/migrateAssetSymbols';

    const dryRun = ref(true);
    const loading = ref(false);
    const results = ref(null);
    const logs = ref([]);

    // console.log를 캡처하는 함수
    const captureConsoleLog = (originalConsoleLog) => {
        return (...args) => {
            const message = args.join(' ');
            logs.value.push(message);
            originalConsoleLog(...args);
        };
    };

    const migrateCurrentUser = async () => {
        if (!user.value?.uid) {
            alert('로그인된 사용자가 없습니다.');
            return;
        }

        loading.value = true;
        results.value = null;
        logs.value = [];

        // console.log 캡처
        const originalLog = console.log;
        console.log = captureConsoleLog(originalLog);

        try {
            const result = await migrateUserAssets(
                user.value.uid,
                dryRun.value
            );
            results.value = result;

            alert(
                `${dryRun.value ? 'Dry Run 완료' : '마이그레이션 완료'}\n${result.needsMigration}개 항목 중 ${result.migrated}개 ${dryRun.value ? '확인됨' : '업데이트됨'}`
            );
        } catch (error) {
            console.error('마이그레이션 오류:', error);
            alert(`오류: ${error.message}`);
        } finally {
            // console.log 복원
            console.log = originalLog;
            loading.value = false;
        }
    };

    const migrateAllUsers = async () => {
        if (
            !confirm(
                `모든 사용자의 자산을 마이그레이션합니다. ${dryRun.value ? '(Dry Run 모드)' : '실제로 데이터가 변경됩니다!'} 계속하시겠습니까?`
            )
        ) {
            return;
        }

        loading.value = true;
        results.value = null;
        logs.value = [];

        // console.log 캡처
        const originalLog = console.log;
        console.log = captureConsoleLog(originalLog);

        try {
            const allResults = await migrateAllUsersAssets(dryRun.value);

            // 전체 결과 집계
            const aggregated = {
                total: 0,
                needsMigration: 0,
                migrated: 0,
                failed: 0,
                details: [],
            };

            allResults.userResults.forEach((userResult) => {
                aggregated.total += userResult.total;
                aggregated.needsMigration += userResult.needsMigration;
                aggregated.migrated += userResult.migrated;
                aggregated.failed += userResult.failed;
                aggregated.details.push(...userResult.details);
            });

            results.value = aggregated;

            alert(
                `${dryRun.value ? 'Dry Run 완료' : '마이그레이션 완료'}\n${allResults.totalUsers}명의 사용자, ${aggregated.needsMigration}개 항목 중 ${aggregated.migrated}개 ${dryRun.value ? '확인됨' : '업데이트됨'}`
            );
        } catch (error) {
            console.error('마이그레이션 오류:', error);
            alert(`오류: ${error.message}`);
        } finally {
            // console.log 복원
            console.log = originalLog;
            loading.value = false;
        }
    };
</script>
