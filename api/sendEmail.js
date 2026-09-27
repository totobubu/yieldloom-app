// api/sendEmail.js
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    try {
        // Web3Forms API 호출
        const response = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                access_key: process.env.WEB3FORMS_ACCESS_KEY,
                subject: `[DivGrow] ${name} 님의 문의`,
                from_name: 'DivGrow 문의',
                email: 'totobubu.lab@gmail.com', // 받을 이메일
                message: `
보낸 사람: ${name}
회신 이메일: ${email}

내용:
${message}
                `,
                // 추가 옵션
                replyto: email, // 답장 시 사용자 이메일로 바로 회신 가능
            }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            console.error('Web3Forms API Error:', result);
            return res.status(500).json({
                error: '이메일 발송에 실패했습니다.',
                details: result.message || result,
            });
        }

        return res
            .status(200)
            .json({ message: '이메일이 성공적으로 발송되었습니다.' });
    } catch (error) {
        console.error('Server Error:', error);
        return res
            .status(500)
            .json({ error: '서버 오류가 발생했습니다.', details: error.message });
    }
}
