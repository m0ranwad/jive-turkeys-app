"""The original Jive Turkeys turkey (traced from public/logo.jpg), now with an Afro, round 70s shades
and an Afro pick, on 70s and soccer backgrounds.

    python3 docs/design/jive-turkey/classic.py [output folder]

  c1-just-the-fro     plain black background
  c2-sunburst         70s rays behind him
  c3-retro-sun        a striped 70s sunset behind him
  c4-pitch            mowed-grass stripes, the center circle, and a ball at his feet
  c5-in-goal          standing in front of the goal and net
  c6-just-the-ball    c1 with a ball at his feet
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from soccer import ball as _ball  # noqa: E402
from draw import MAIN, LIME, YEL  # noqa: E402

# The turkey's shapes: (color, centre, outline). "main" is green, "lime" is the lighter green.
TURKEY = [
    ('main', (458, 251), 'M481 330 404 231 399 204 504 217Z'),
    ('main', (332, 274), 'M350 352 270 263 375 208 376 213Z'),
    ('main', (552, 294), 'M541 362 528 272 522 229 525 226 594 294Z'),
    ('main', (695, 555), 'M687 818 502 818 546 778 508 712 652 598 668 513 662 502 722 459 686 314 717 266 778 268 804 301 824 316 836 339 802 338 818 383 818 395 806 406 791 404 784 388 789 346 760 368 810 480 810 571 707 696 639 696 606 732 628 783 660 784 686 813ZM600 784 568 724 558 740 578 783Z'),
    ('main', (262, 347), 'M198 390 191 388 192 385 253 276 342 373Z'),
    ('main', (505, 574), 'M377 792 374 771 376 596 462 474 574 374 652 487 634 587Z'),
    ('main', (232, 476), 'M199 564 192 490 188 410 312 453Z'),
    ('main', (276, 602), 'M278 670 206 585 213 580 327 546 330 550 310 633Z'),
    ('lime', (389, 336), 'M438 450 350 352 376 208Z'),
    ('lime', (514, 343), 'M481 430 523 230 540 363 502 412Z'),
    ('lime', (447, 333), 'M457 440 405 230 480 328Z'),
    ('lime', (323, 413), 'M432 474 192 390 342 374Z'),
    ('lime', (653, 440), 'M662 502 575 374 661 408 722 458Z'),
    ('lime', (313, 504), 'M203 564 200 563 311 454 424 493Z'),
    ('lime', (348, 567), 'M311 632 330 550 328 546 402 522Z'),
]

COLOR = {'main': MAIN, 'lime': LIME}
BODY_AT, WING_AT, SHOULDER_AT = (695, 555), (505, 574), (653, 440)
P = lambda d, fill, extra='': f'<path fill="{fill}" fill-rule="evenodd" d="{d}"{extra}/>'


def turkey():
    tail = [t for t in TURKEY if t[1] not in (BODY_AT, WING_AT, SHOULDER_AT)]
    rest = [t for t in TURKEY if t[1] in (WING_AT, SHOULDER_AT)]
    body = [t for t in TURKEY if t[1] == BODY_AT][0]
    s = ''.join(P(d, COLOR[c]) for c, _, d in tail + rest)
    # A black edge on the body so the head stands out against the Afro.
    return s + P(body[2], MAIN, ' stroke="#000" stroke-width="14" paint-order="stroke"')


def afro(cx=722, cy=236, R=124, n=22, rb=19, fill=LIME, seed=3):
    rnd = random.Random(seed)
    blobs = [(cx, cy, R - rb * 0.6)]
    for i in range(n):
        a = -math.pi / 2 + 2 * math.pi * i / n
        r = rb * (0.85 + 0.3 * rnd.random())
        blobs.append((cx + (R - r) * math.cos(a), cy + (R - r) * math.sin(a), r))
    return ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}"/>' for x, y, r in blobs)


def shades(x=792, y=298, r=27):
    return (f'<path d="M{x - r} {y - 8} L{x - 92} {y - 30}" stroke="#000" stroke-width="12" stroke-linecap="round"/>'
            f'<circle cx="{x}" cy="{y}" r="{r + 7}" fill="#000"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="#111" stroke="{YEL}" stroke-width="6"/>'
            f'<path d="M{x - 14} {y - 5} a 15 15 0 0 1 12 -12" stroke="#fff" stroke-opacity=".85" stroke-width="5" fill="none" stroke-linecap="round"/>')


def pick(x=668, y=176, angle=-30):
    teeth = ''.join(f'<rect x="{-27 + i * 15}" y="0" width="8" height="70" rx="4" fill="#000"/>' for i in range(4))
    return (f'<g transform="translate({x} {y}) rotate({angle})">{teeth}'
            f'<rect x="-34" y="-16" width="68" height="22" rx="6" fill="#000"/>'
            f'<rect x="-27" y="-100" width="54" height="92" rx="20" fill="#000"/>'
            f'<rect x="-18" y="-91" width="36" height="74" rx="13" fill="{YEL}"/></g>')


def dude():
    return afro() + turkey() + pick() + shades()


def sunburst(cx=512, cy=540, n=18, fill='#0f2c16'):
    s = ''
    for i in range(n):
        a0 = 2 * math.pi * i / n - math.pi / 2
        a1 = a0 + math.pi / n
        R = 900
        s += f'<path d="M{cx} {cy} L{cx + R * math.cos(a0):.0f} {cy + R * math.sin(a0):.0f} L{cx + R * math.cos(a1):.0f} {cy + R * math.sin(a1):.0f}Z" fill="{fill}"/>'
    return s


def sunset(cx=512, cy=512, r=410):
    """A 70s striped sun: solid on top, with gaps that widen toward the bottom."""
    clip = f'<clipPath id="sun"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>'
    grad = ('<linearGradient id="sung" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#26662e"/><stop offset="1" stop-color="#0e2a14"/></linearGradient>')
    gaps = ''
    y = cy + 20
    for i, g in enumerate((8, 12, 17, 23, 30)):
        gaps += f'<rect x="0" y="{y:.0f}" width="1024" height="{g}" fill="#000"/>'
        y += g + 44 - i * 3
    return f'<defs>{clip}{grad}</defs><g clip-path="url(#sun)"><rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" fill="url(#sung)"/>{gaps}</g>'


def pitch():
    """Mowed-grass stripes with the halfway line and centre circle, in deep greens."""
    s = ''.join(f'<rect x="{i * 128}" y="0" width="128" height="1024" fill="{"#0f2c16" if i % 2 else "#143a1c"}"/>' for i in range(8))
    line = '#2d7a35'
    s += f'<line x1="512" y1="0" x2="512" y2="1024" stroke="{line}" stroke-width="14"/>'
    s += f'<circle cx="512" cy="512" r="300" fill="none" stroke="{line}" stroke-width="14"/>'
    return s + f'<circle cx="512" cy="512" r="22" fill="{line}"/>'


def goal():
    """Goalposts and a net behind him."""
    s = '<clipPath id="net"><rect x="96" y="150" width="832" height="900"/></clipPath><g clip-path="url(#net)">'
    for k in range(-12, 14):
        x = k * 80
        s += f'<line x1="{x}" y1="150" x2="{x + 900}" y2="1050" stroke="#1c4f24" stroke-width="7"/>'
        s += f'<line x1="{x + 900}" y1="150" x2="{x}" y2="1050" stroke="#1c4f24" stroke-width="7"/>'
    s += '</g>'
    frame = 'M96 1024 L96 150 L928 150 L928 1024'
    s += f'<path d="{frame}" fill="none" stroke="#000" stroke-width="58" stroke-linejoin="round"/>'
    return s + f'<path d="{frame}" fill="none" stroke="{YEL}" stroke-width="34" stroke-linejoin="round"/>'


def build(background='', dy=40, inset=1.0, with_ball=False):
    move = f'translate({512 * (1 - inset):.1f} {512 * (1 - inset):.1f}) scale({inset})'
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#000"/>'
         f'<g transform="{move}">{background}</g><g transform="{move} translate(0 {dy})">{dude()}</g>')
    if with_ball:
        s += ball(800, 812, 78)
    return s + '</svg>'


def ball(cx, cy, r):
    # soccer.ball, with this file's clip id so it can sit beside other balls
    return _ball(cx, cy, r, rot=12).replace(f'ball{int(cx)}{int(cy)}', 'feetball')


CONCEPTS = {
    'c1-just-the-fro': build(),
    'c2-sunburst': build(sunburst()),
    'c3-retro-sun': build(sunset(), dy=30, inset=0.98),
    'c4-pitch': build(pitch(), with_ball=True),
    'c5-in-goal': build(goal(), dy=50),
    'c6-just-the-ball': build(with_ball=True),
}

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    for name, text in CONCEPTS.items():
        with open(os.path.join(out, f'{name}.svg'), 'w') as fh:
            fh.write(text + '\n')
    print(' '.join(CONCEPTS))
