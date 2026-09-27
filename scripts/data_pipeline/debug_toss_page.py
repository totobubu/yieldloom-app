#!/usr/bin/env python3
"""
토스증권 페이지 구조를 확인하는 디버깅 스크립트
"""

import asyncio
from playwright.async_api import async_playwright

async def debug_toss_page():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # headless=False로 브라우저 보기
        page = await browser.new_page()

        # 토스증권 메인 페이지로 이동
        await page.goto("https://tossinvest.com", timeout=30000)

        print("Page loaded. Waiting 5 seconds for content to load...")
        await page.wait_for_timeout(5000)

        # 페이지 HTML 저장
        html = await page.content()
        with open("toss_page_debug.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("HTML saved to toss_page_debug.html")

        # input 태그 찾기
        inputs = await page.query_selector_all("input")
        print(f"\nFound {len(inputs)} input elements:")
        for i, inp in enumerate(inputs[:10]):  # 처음 10개만
            input_type = await inp.get_attribute("type")
            input_placeholder = await inp.get_attribute("placeholder")
            input_name = await inp.get_attribute("name")
            input_class = await inp.get_attribute("class")
            print(f"  {i+1}. type={input_type}, placeholder={input_placeholder}, name={input_name}")
            print(f"     class={input_class}")

        # 페이지 스크린샷
        await page.screenshot(path="toss_page_debug.png")
        print("\nScreenshot saved to toss_page_debug.png")

        print("\nBrowser will stay open for 30 seconds for manual inspection...")
        await page.wait_for_timeout(30000)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(debug_toss_page())
