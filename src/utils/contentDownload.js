export function downloadContent(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function svgPng(svg, width, height) {
    const url = URL.createObjectURL(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    );
    try {
        const picture = new Image();
        picture.src = url;
        await picture.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error(
                '이미지 출력을 지원하지 않습니다. SVG 저장을 사용하세요.'
            );
        context.drawImage(picture, 0, 0);
        const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, 'image/png')
        );
        if (!blob) throw new Error('이미지를 만들지 못했습니다.');
        return blob;
    } finally {
        URL.revokeObjectURL(url);
    }
}
