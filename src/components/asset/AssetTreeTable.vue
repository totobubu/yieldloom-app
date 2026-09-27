<!-- src/components/asset/AssetTreeTable.vue -->
<script setup>
    import { computed } from 'vue';
    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import TreeTable from 'primevue/treetable';
    import Column from 'primevue/column';

    const props = defineProps({
        memberName: {
            type: String,
            required: true,
        },
        memberId: {
            type: String,
            required: true,
        },
        treeData: {
            type: Array,
            default: () => [],
        },
        onAddBrokerage: {
            type: Function,
            required: true,
        },
    });

    const emit = defineEmits(['upload', 'addChild', 'edit', 'delete']);

    const formatCurrency = (amount, currency) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: currency || 'KRW',
        }).format(amount);
    };

    const handleUpload = (node) => {
        emit('upload', node);
    };

    const handleAddChild = (node) => {
        emit('addChild', node);
    };

    const handleEdit = (node) => {
        emit('edit', node);
    };

    const handleDelete = (node) => {
        emit('delete', node);
    };
</script>

<template>
    <Card>
        <template #header>
            <div class="flex justify-content-between align-items-center p-3">
                <h3 class="m-0">{{ memberName }}님의 자산</h3>
                <Button
                    label="증권사 추가"
                    icon="pi pi-plus"
                    @click="onAddBrokerage" />
            </div>
        </template>
        <template #content>
            <TreeTable
                :value="treeData"
                :metaKeySelection="false"
                selectionMode="single">
                <Column field="name" header="자산" expander>
                    <template #body="{ node }">
                        <div class="flex align-items-center gap-2">
                            <i :class="`${node.data.icon}`"></i>
                            <span class="font-semibold">{{
                                node.data.name
                            }}</span>
                        </div>
                    </template>
                </Column>
                <Column field="amount" header="금액">
                    <template #body="{ node }">
                        <span v-if="node.data.type === '자산'">
                            {{
                                formatCurrency(
                                    node.data.amount,
                                    node.data.currency
                                )
                            }}
                        </span>
                    </template>
                </Column>
                <Column header="액션" style="width: 200px">
                    <template #body="{ node }">
                        <div class="flex gap-2">
                            <Button
                                icon="pi pi-upload"
                                size="small"
                                rounded
                                severity="info"
                                @click="handleUpload(node)" />
                            <Button
                                icon="pi pi-plus"
                                size="small"
                                rounded
                                @click="handleAddChild(node)" />
                            <Button
                                icon="pi pi-pencil"
                                size="small"
                                rounded
                                severity="secondary"
                                @click="handleEdit(node)" />
                            <Button
                                icon="pi pi-trash"
                                size="small"
                                rounded
                                severity="danger"
                                @click="handleDelete(node)" />
                        </div>
                    </template>
                </Column>
            </TreeTable>

            <Card v-if="(treeData || []).length === 0">
                <template #content>
                    <div class="flex flex-column align-items-center gap-3 p-4">
                        <i class="pi pi-inbox text-6xl"></i>
                        <p>등록된 자산이 없습니다.</p>
                        <Button
                            label="첫 번째 증권사 추가하기"
                            icon="pi pi-plus"
                            @click="onAddBrokerage" />
                    </div>
                </template>
            </Card>
        </template>
    </Card>
</template>
