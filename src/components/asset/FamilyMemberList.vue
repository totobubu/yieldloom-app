<!-- src/components/asset/FamilyMemberList.vue -->
<script setup>
    import { computed } from 'vue';
    import Avatar from 'primevue/avatar';
    import Button from 'primevue/button';

    const props = defineProps({
        members: {
            type: Array,
            required: true,
        },
        selectedMemberId: {
            type: String,
            default: null,
        },
    });

    const emit = defineEmits(['select', 'add']);

    // 가족 멤버 정렬: 본인을 1번으로
    const sortedMembers = computed(() => {
        return [...props.members].sort((a, b) => {
            // 본인이면 맨 앞
            if (a.relationship === '본인') return -1;
            if (b.relationship === '본인') return 1;
            return 0;
        });
    });

    const handleClick = (member) => {
        emit('select', member.id);
    };

    const handleAddClick = () => {
        emit('add');
    };
</script>

<template>
    <div class="border-round">
        <h3 class="hidden">👥 가족 멤버 선택:</h3>
        <div class="flex gap-2 flex-wrap">
            <Button
                v-for="member in sortedMembers"
                :key="member.id"
                @click="handleClick(member)"
                :severity="
                    selectedMemberId === member.id ? 'primary' : 'secondary'
                "
                :label="member.name + ' (' + member.relationship + ')'">
            </Button>
            <Button
                severity="contrast"
                @click="handleAddClick"
                icon="pi pi-plus"
                label="가족 추가">
            </Button>
        </div>
    </div>
</template>
