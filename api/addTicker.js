// api/addTicker.js
import fs from 'fs/promises';
import path from 'path';

// Vercel 환경에서는 쓰기 권한이 없으므로 로컬에서만 동작하도록 체크
if (!process.env.VERCEL) {
    console.log('addTicker API is enabled only for local development.');
}

// market에 따라 저장할 파일 경로 결정
function getFilePath(market, symbol) {
    let fileName;
    const firstChar = symbol.charAt(0).toLowerCase();

    if (market === 'KOSPI' || market === 'KOSDAQ') {
        fileName = `${firstChar}.json`;
    } else {
        // NASDAQ, NYSE 등
        if (/[a-z]/.test(firstChar)) {
            fileName = `${firstChar}.json`;
        } else {
            fileName = 'etc.json'; // 숫자로 시작하거나 기타 문자일 경우
        }
    }
    return path.join(process.cwd(), 'public', 'nav', market, fileName);
}

export default async function handler(req, res) {
    if (process.env.VERCEL) {
        return res
            .status(403)
            .json({ message: 'File system is read-only on this environment.' });
    }
    if (req.method !== 'POST') {
        return res
            .status(405)
            .json({ message: 'Only POST requests are allowed' });
    }

    try {
        const { symbol, market, koName, longName, currency } = req.body;
        if (!symbol || !market) {
            return res
                .status(400)
                .json({ error: 'Symbol and market are required.' });
        }

        const filePath = getFilePath(market, symbol);
        const newTicker = {
            symbol,
            koName,
            longName,
            currency,
            upcoming: true,
        };

        let fileData = [];
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            fileData = JSON.parse(content);
        } catch (error) {
            // 파일이 없으면 새로 생성
            console.log(`File not found: ${filePath}. Creating new one.`);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
        }

        // 중복 체크
        if (fileData.some((t) => t.symbol === symbol)) {
            return res.status(200).json({ message: 'Ticker already exists.' });
        }

        fileData.push(newTicker);
        fileData.sort((a, b) => a.symbol.localeCompare(b.symbol));

        await fs.writeFile(
            filePath,
            JSON.stringify(fileData, null, 4),
            'utf-8'
        );

        console.log(`Added new ticker ${symbol} to ${filePath}`);
        return res.status(201).json({ message: 'Ticker added successfully.' });
    } catch (error) {
        console.error('[API/addTicker] Error:', error);
        return res.status(500).json({ error: 'Failed to add ticker.' });
    }
}
