from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "fixtures" / "policy-documents" / "walking-skeleton-policy-evaluation.pdf"
FONT_NAME = "HeiseiKakuGo-W5"
PAGE_WIDTH, PAGE_HEIGHT = A4


def draw_header(canvas: Canvas, page_number: int) -> None:
    canvas.setFillColor(colors.HexColor("#0B6B4F"))
    canvas.rect(0, PAGE_HEIGHT - 54, PAGE_WIDTH, 54, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont(FONT_NAME, 12)
    canvas.drawString(42, PAGE_HEIGHT - 34, "サンプル市 政策評価書")
    canvas.setFont(FONT_NAME, 9)
    canvas.drawRightString(PAGE_WIDTH - 42, PAGE_HEIGHT - 34, f"{page_number} / 2")


def draw_label(canvas: Canvas, label: str, value: str, y: float) -> float:
    canvas.setFillColor(colors.HexColor("#68736D"))
    canvas.setFont(FONT_NAME, 9)
    canvas.drawString(48, y, label)
    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 12)
    canvas.drawString(150, y, value)
    return y - 29


def create_fixture() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))
    canvas = Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    canvas.setTitle("サンプル市 地域移動支援事業 政策評価書")
    canvas.setAuthor("PolicyGOS Next fixture")

    draw_header(canvas, 1)
    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 22)
    canvas.drawString(48, PAGE_HEIGHT - 105, "地域移動支援事業")
    canvas.setFont(FONT_NAME, 10)
    canvas.setFillColor(colors.HexColor("#68736D"))
    canvas.drawString(48, PAGE_HEIGHT - 128, "令和7年度 事業評価")

    y = PAGE_HEIGHT - 176
    y = draw_label(canvas, "担当部局", "交通政策課", y)
    y = draw_label(canvas, "対象地域", "サンプル市全域", y)
    y = draw_label(canvas, "事業目的", "住民の移動手段を確保する", y)

    canvas.setFillColor(colors.HexColor("#E8F2ED"))
    canvas.roundRect(42, y - 116, PAGE_WIDTH - 84, 104, 12, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#0B6B4F"))
    canvas.setFont(FONT_NAME, 10)
    canvas.drawString(60, y - 38, "成果指標")
    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 16)
    canvas.drawString(60, y - 65, "公共交通利用者満足度")
    canvas.setFont(FONT_NAME, 12)
    canvas.drawString(60, y - 91, "令和7年度の目標値は80%とする。")

    canvas.setFillColor(colors.HexColor("#68736D"))
    canvas.setFont(FONT_NAME, 9)
    canvas.drawString(48, 48, "このPDFはPolicyGOS NextのE2E試験用fixtureです。")
    canvas.showPage()

    draw_header(canvas, 2)
    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 22)
    canvas.drawString(48, PAGE_HEIGHT - 105, "実績と評価")
    canvas.setFont(FONT_NAME, 11)
    canvas.drawString(48, PAGE_HEIGHT - 150, "地域移動支援事業の年度終了後評価")

    canvas.setFillColor(colors.HexColor("#F3F5F1"))
    canvas.roundRect(42, PAGE_HEIGHT - 326, PAGE_WIDTH - 84, 130, 12, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#0B6B4F"))
    canvas.setFont(FONT_NAME, 10)
    canvas.drawString(60, PAGE_HEIGHT - 225, "成果指標")
    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 16)
    canvas.drawString(60, PAGE_HEIGHT - 254, "公共交通利用者満足度")
    canvas.setFont(FONT_NAME, 12)
    canvas.drawString(60, PAGE_HEIGHT - 283, "令和7年度の実績値は76%であった。")
    canvas.setFillColor(colors.HexColor("#68736D"))
    canvas.setFont(FONT_NAME, 10)
    canvas.drawString(60, PAGE_HEIGHT - 306, "目標との差は4ポイントである。")

    canvas.setFillColor(colors.HexColor("#17211D"))
    canvas.setFont(FONT_NAME, 12)
    canvas.drawString(48, PAGE_HEIGHT - 382, "評価: 目標未達のため、運行時間帯の見直しを行う。")
    canvas.setFillColor(colors.HexColor("#68736D"))
    canvas.setFont(FONT_NAME, 9)
    canvas.drawString(48, 48, "このPDFはPolicyGOS NextのE2E試験用fixtureです。")
    canvas.save()


if __name__ == "__main__":
    create_fixture()
