<!-- src/components/thumbnail/GroupItem.vue -->
<script setup>
    const props = defineProps({
        data: Object,
    });
</script>

<template>
    <div class="thumbnail-item-wrapper">
        <div class="thumbnail-container">
            <div class="thumbnail-container-inner">
                <img :src="data.backgroundImageUrl" class="bg-image" alt="" />
                <div class="header">
                    <img :src="data.logo" alt="Company Logo" class="logo" />
                    <span class="date">{{ data.date }}</span>
                    <p class="copyright">By DivGrow</p>
                </div>
                <div class="main-content group-content">
                    <h1 class="ticker" :style="{ color: data.tickerColor }">
                        {{ data.groupTitle }}
                    </h1>
                    <h2 class="amount" :style="{ color: data.tickerColor }">
                        {{ data.groupSubtitle }}
                    </h2>
                </div>
                <div class="footer">
                    <p class="description">
                        {{ data.descriptionLine1 }}<br />{{
                            data.descriptionLine2
                        }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>
