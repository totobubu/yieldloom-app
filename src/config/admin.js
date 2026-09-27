// src/config/admin.js
// 관리자 관련 고정 설정을 한 곳에서 관리합니다.

export const ADMIN_EMAILS = ['totobubu.lab@gmail.com'];

export const isAdminEmail = (email) => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email);
};
