// tasks\_utils.js
import fs from 'fs/promises';
import path from 'path';

// --- 공통 경로 상수 ---
export const ROOT_DIR = process.cwd();
export const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
export const DATA_DIR = path.join(PUBLIC_DIR, 'data');
export const NAV_DIR = path.join(PUBLIC_DIR, 'nav');
export const NAV_FILE_PATH = path.join(PUBLIC_DIR, 'nav.json');

// --- 공통 유틸리티 함수 ---

/**
 * JSON 파일을 비동기적으로 읽고 파싱합니다.
 * @param {string} filePath - 읽을 파일의 전체 경로
 * @returns {Promise<object>} 파싱된 JSON 객체
 */
export async function readJsonFile(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error(
            `Error reading or parsing JSON file at ${filePath}:`,
            error
        );
        throw error; // 오류를 다시 던져 호출자가 처리하도록 함
    }
}

/**
 * 데이터를 JSON 형식으로 비동기적으로 파일에 씁니다.
 * @param {string} filePath - 쓸 파일의 전체 경로
 * @param {object} data - 파일에 쓸 JavaScript 객체
 */
export async function writeJsonFile(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf-8');
    } catch (error) {
        console.error(`Error writing JSON file to ${filePath}:`, error);
        throw error;
    }
}

/**
 * 주어진 시간(ms)만큼 실행을 지연시킵니다.
 * @param {number} ms - 지연시킬 밀리초
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
