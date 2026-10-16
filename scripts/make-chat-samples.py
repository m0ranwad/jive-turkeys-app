"""Makes the sample chat photos the preview shows (public/chat-samples/).

    python3 scripts/make-chat-samples.py

Needs Pillow and the DejaVu fonts (both come with most Linux setups). The
pictures are made up: a league standings board that matches the sample games
in src/api/demo.js, and a short "GOOOAL!" GIF.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "chat-samples"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

ZINC_950 = (9, 9, 11)
ZINC_800 = (39, 39, 42)
ZINC_500 = (113, 113, 122)
ZINC_100 = (244, 244, 245)
LIME_400 = (163, 230, 53)
LIME_100 = (236, 252, 203)
WHITE = (255, 255, 255)


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def standings():
    """A screenshot-like league table: 2nd place, as in the sample games (2 W, 1 L, 1 T)."""
    w, h = 1200, 980
    img = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 180], fill=ZINC_950)
    d.text((60, 48), "COED B · FALL SESSION 2", font=font(30, True), fill=LIME_400)
    d.text((60, 92), "Standings", font=font(56, True), fill=WHITE)

    cols = [(60, "#"), (130, "TEAM"), (700, "GP"), (800, "W"), (890, "L"), (980, "T"), (1070, "PTS")]
    y = 220
    for x, label in cols:
        d.text((x, y), label, font=font(26, True), fill=ZINC_500)
    rows = [
        ("1", "Goal Diggers", 4, 3, 0, 1, 10),
        ("2", "Jive Turkeys", 4, 2, 1, 1, 7),
        ("3", "Net Ninjas", 4, 2, 2, 0, 6),
        ("4", "The Hat Tricks", 4, 1, 1, 2, 5),
        ("5", "FC Lightning", 4, 1, 2, 1, 4),
        ("6", "Grass Kickers", 4, 1, 3, 0, 3),
        ("7", "Ball Busters", 4, 0, 3, 1, 1),
    ]
    y = 280
    for row in rows:
        ours = row[1] == "Jive Turkeys"
        if ours:
            d.rounded_rectangle([36, y - 18, w - 36, y + 72], radius=22, fill=LIME_100, outline=LIME_400, width=4)
        else:
            d.line([60, y + 80, w - 60, y + 80], fill=ZINC_100, width=3)
        for (x, _), value in zip(cols, row):
            d.text((x, y), str(value), font=font(38, ours or x == 1070), fill=ZINC_950)
        y += 98
    img.save(OUT / "standings.jpg", quality=82, optimize=True)


def goal_gif():
    """A ball flies into the net, then GOOOAL! flashes."""
    w, h = 360, 270
    frames = []
    net_x = 220

    def frame(ball_x, ball_y, text=None, text_color=LIME_400):
        img = Image.new("RGB", (w, h), ZINC_950)
        d = ImageDraw.Draw(img)
        # The goal: a net, then the posts in front of it.
        for x in range(net_x + 18, w - 20, 18):
            d.line([x, 80, x, 230], fill=ZINC_800, width=2)
        for y in range(98, 230, 18):
            d.line([net_x, y, w - 20, y], fill=ZINC_800, width=2)
        d.rectangle([net_x, 80, w - 20, 230], outline=WHITE, width=6)
        d.line([0, 236, w, 236], fill=LIME_400, width=4)
        # The ball.
        r = 22
        d.ellipse([ball_x - r, ball_y - r, ball_x + r, ball_y + r], fill=WHITE, outline=ZINC_950, width=2)
        d.regular_polygon((ball_x, ball_y, 8), 5, fill=ZINC_950)
        if text:
            f = font(58, True)
            box = d.textbbox((0, 0), text, font=f)
            d.text(((w - (box[2] - box[0])) // 2, 8), text, font=f, fill=text_color, stroke_width=3, stroke_fill=ZINC_950)
        return img

    path = [(36 + i * 26, 206 - int(110 * (1 - ((i - 5) / 5) ** 2))) for i in range(11)]
    frames += [frame(x, y) for x, y in path]
    for i in range(6):
        frames.append(frame(300, 200, "GOOOAL!", LIME_400 if i % 2 == 0 else WHITE))
    frames[0].save(
        OUT / "goal.gif",
        save_all=True,
        append_images=frames[1:],
        duration=[70] * len(path) + [220] * 6,
        loop=0,
        optimize=True,
    )


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    standings()
    goal_gif()
    for f in sorted(OUT.iterdir()):
        with Image.open(f) as img:
            print(f"{f.name}: {img.width}x{img.height}, {f.stat().st_size // 1024} KB")
