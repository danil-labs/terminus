"""Run against pnpm dev with Python Playwright and its WebKit browser installed."""
import argparse
import json
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://localhost:5174")
parser.add_argument("--browser", choices=["webkit", "chromium"], default="webkit")
parser.add_argument("--fixture", help="Optional HTML URL served by the same Vite instance")
args = parser.parse_args()
url = args.url.rstrip("/") + "/tests/helpers/inline-visual-resize.html"
if args.fixture:
    url += "?" + urlencode({"fixture": args.fixture})

with sync_playwright() as playwright:
    browser = getattr(playwright, args.browser).launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1000, "height": 720})
        page.goto(url)
        page.wait_for_selector("#scroller")
        page.evaluate("probe.sticky.soltar();document.querySelector('#scroller').scrollTop=750")
        page.wait_for_selector("iframe")
        frame = page.frames[1]
        node = page.locator("iframe").element_handle()
        results = []

        def settled(label, fits=True):
            page.wait_for_timeout(300)
            count = page.evaluate("probe.samples.length")
            page.wait_for_timeout(200)
            assert page.evaluate("probe.samples.length") == count, (label, "height feedback loop")
            geometry = frame.evaluate("""() => ({
                height: innerHeight, content: document.documentElement.scrollHeight,
                width: innerWidth, clientWidth: document.documentElement.clientWidth,
                overflow: document.documentElement.style.getPropertyValue("overflow-y")
            })""")
            if fits:
                assert geometry["content"] <= geometry["height"], (label, geometry)
                assert geometry["clientWidth"] == geometry["width"], (label, "unexpected inner scrollbar", geometry)
            assert geometry["overflow"] == "", (label, "scrolling policy was changed")
            assert node.evaluate("node => node === document.querySelector('iframe')"), "iframe remounted"
            assert page.evaluate("probe.reads()") == 1, "visual reloaded"
            results.append({"case": label, **geometry})

        for width in [964, 680, 530, 460, 360, 320, 600]:
            page.evaluate("w => document.querySelector('#scroller').style.width=w+'px'", width)
            settled("width " + str(width))
        page.evaluate("probe.setTail('Mensaje posterior');probe.sticky.bajar({animacion:'instantanea'})")
        page.evaluate("document.querySelector('#scroller').style.width='320px'")
        settled("reading at bottom")
        positions = page.evaluate("""async () => {
            const positions=[];
            for(let i=0;i<20;i++) {
                await new Promise(requestAnimationFrame);
                positions.push(document.querySelector("#tail").getBoundingClientRect().top);
            }
            return positions;
        }""")
        assert max(positions)-min(positions) <= 1, ("visible chat text jumped", positions)
        page.evaluate("probe.sticky.soltar();document.querySelector('#scroller').style.width='600px';document.querySelector('#scroller').scrollTop=750")
        settled("reading near visual")
        for metric in ["leads", "views"]:
            frame.locator("[data-metric=" + metric + "]").evaluate("button => button.click()")
            settled(metric)
        for index in [0, 14]:
            frame.locator(".column").nth(index).evaluate("button => button.focus({preventScroll:true})")
            settled("focused chart column " + str(index))
        frame.locator(".column").last.evaluate("button => button.blur()")
        settled("chart blur")
        for opened in [True, False]:
            frame.locator("details").evaluate("(details, open) => details.open=open", opened)
            settled("details " + str(opened))
        for theme in ["dark", "light"]:
            page.evaluate("theme => document.documentElement.dataset.theme=theme", theme)
            settled("theme " + theme)
        for expanded in [True, False]:
            before = page.locator("#scroller").evaluate("element => element.scrollTop")
            page.locator("[aria-expanded]").evaluate("button => button.click()")
            settled("expanded " + str(expanded), fits=not expanded)
            after = page.locator("#scroller").evaluate("element => element.scrollTop")
            assert abs(after - before) <= 1, ("modal moved chat", before, after)
        page.evaluate("probe.setRunning(true);probe.sticky.bajar({animacion:'instantanea'})")
        for i in range(10):
            page.evaluate("i => probe.setTail('Mensaje nuevo. '.repeat(100+i*10))", i)
            page.wait_for_timeout(20)
        page.evaluate("probe.setRunning(false)")
        settled("streaming")
        page.evaluate("probe.sticky.soltar();document.querySelector('#scroller').scrollTop=750")
        frame.evaluate("() => {const long=document.createElement('div');long.style.height='6000px';document.body.append(long)}")
        settled("capped content", fits=False)
        assert frame.evaluate("innerHeight") == 4096
        frame.evaluate("scrollTo(0,500)")
        page.wait_for_timeout(100)
        page.evaluate("document.documentElement.dataset.theme='dark'")
        settled("capped content scroll preserved", fits=False)
        assert frame.evaluate("scrollY") >= 499, "measurement reset the inner scroll"
        print(json.dumps({"browser": args.browser, "cases": results, "samples": page.evaluate("probe.samples")}, indent=2))
    finally:
        browser.close()
