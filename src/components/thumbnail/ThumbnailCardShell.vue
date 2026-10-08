<template>
    <section class="thumbnail-card-shell">
        <header class="thumbnail-card-header"><slot name="header" /></header>
        <main class="thumbnail-card-content"><slot /></main>
        <footer class="thumbnail-card-footer"><slot name="footer" /></footer>
    </section>
</template>

<style scoped>
.thumbnail-card-shell{box-sizing:border-box;width:720px;height:720px;display:flex;flex-direction:column;overflow:hidden}.thumbnail-card-header{display:flex;align-items:flex-start;justify-content:space-between;flex:0 0 auto}.thumbnail-card-footer{flex:0 0 auto}.thumbnail-card-content{min-height:0;flex:1;display:flex;flex-direction:column}
</style>
