<script setup>
    import check from '@/assets/icons/material-symbols/check.svg';
    import done_all from '@/assets/icons/material-symbols/done_all.svg';
    import receipt_long from '@/assets/icons/material-symbols/receipt_long.svg';
    import event_available from '@/assets/icons/material-symbols/event_available.svg';
    import account_balance_wallet from '@/assets/icons/material-symbols/account_balance_wallet.svg';
    import description from '@/assets/icons/material-symbols/description.svg';
    import account_balance from '@/assets/icons/material-symbols/account_balance.svg';
    import warning from '@/assets/icons/material-symbols/warning.svg';
    import refresh from '@/assets/icons/material-symbols/refresh.svg';
    import lock from '@/assets/icons/material-symbols/lock.svg';
    import upload_file from '@/assets/icons/material-symbols/upload_file.svg';
    import arrow_forward from '@/assets/icons/material-symbols/arrow_forward.svg';
    import download from '@/assets/icons/material-symbols/download.svg';
    import calendar_month from '@/assets/icons/material-symbols/calendar_month.svg';
    const icons = {
        check,
        done_all,
        receipt_long,
        event_available,
        account_balance_wallet,
        description,
        account_balance,
        warning,
        refresh,
        lock,
        upload_file,
        arrow_forward,
        download,
        calendar_month,
    };
    defineProps({
        name: {
            type: String,
            required: true,
        },
    });
</script>
<template>
    <span
        class="stitch-symbol"
        aria-hidden="true"
        :style="{ '--symbol-url': `url(${JSON.stringify(icons[name])})` }" />
</template>
<style scoped>
    .stitch-symbol {
        display: inline-block;
        width: 1em;
        height: 1em;
        flex-shrink: 0;
        vertical-align: middle;
        background: currentColor;
        mask: var(--symbol-url) center/contain no-repeat;
        -webkit-mask: var(--symbol-url) center/contain no-repeat;
    }
</style>
