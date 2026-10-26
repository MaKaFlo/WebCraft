"""Opens the game in headless Chromium, logs in and saves a screenshot.

Usage: python3 screenshot.py <page url> <name> <out.png> [wait ms]
  e.g. python3 screenshot.py "http://localhost:8080/" Micha shot.png
       python3 screenshot.py "file:///.../webcraft-web/dist/index.html?server=ws://127.0.0.1:25007" Micha shot.png

Needs: pip install playwright && playwright install chromium
WebGL runs in software (swiftshader), about 10 fps, so give the world time to load.
The page exposes window.wc (player, world, entities, renderer, scene, camera, ...) for checks.
"""
import asyncio
import sys

from playwright.async_api import async_playwright


async def main(url, name, out, wait):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = await browser.new_page(viewport={"width": 800, "height": 500})
        page.on("pageerror", lambda e: print("PAGE ERROR", e))
        await page.goto(url)
        await page.fill("#name", name)
        await page.click("#play")
        await page.wait_for_timeout(wait)
        print(await page.evaluate("JSON.stringify({x: wc.player.x, y: wc.player.y, z: wc.player.z, entities: wc.entities.map.size})"))
        await page.screenshot(path=out, timeout=120000)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 10000))
