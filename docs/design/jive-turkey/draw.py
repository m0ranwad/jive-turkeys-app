"""The Jive Turkey: an Afro turkey in round 70s shades, his tail fanned out like a 70s rainbow.

Draws every icon concept as a 1024x1024 SVG, using only the Python standard library:

    python3 docs/design/jive-turkey/draw.py [output folder]

Two characters, each with a lime or a dark green Afro:
  1a-strut, 1b-strut-dark-afro          the whole bird, in a striped 70s jersey
  2a-superfly, 2b-superfly-dark-afro    close-up, with a big pointed collar and a medallion
"""
import math
import os
import random
import sys

# The site's greens on black.
MAIN, LIME, YEL, DARK = '#3EC63A', '#8FD33E', '#C9E64A', '#1E7A2A'
OUT = 14  # width of the black outlines (the gaps between shapes)
ST = f'stroke="#000" stroke-width="{OUT}" stroke-linejoin="round" paint-order="stroke"'


def pt(c, r, deg):
    """The point r away from c; deg 0 is straight up, positive is clockwise."""
    return (c[0] + r * math.sin(math.radians(deg)), c[1] - r * math.cos(math.radians(deg)))


def f(p):
    return f'{p[0]:.1f} {p[1]:.1f}'


def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#000"/>{body}</svg>'


def fan(c, L, n=9, span=172, gap=2.6):
    """The tail: n feathers with rounded tips, banded like a 70s rainbow."""
    bands = ((L + 80, YEL), (L * 0.80, LIME), (L * 0.62, MAIN), (L * 0.45, DARK))
    step = span / n
    feathers = ''
    for i in range(n):
        mid = -span / 2 + step * (i + 0.5)
        if abs(mid) < 25:
            continue  # hidden behind the Afro; their tips would only peek out as slivers
        p0, p1 = pt(c, L, mid - step / 2 + gap / 2), pt(c, L, mid + step / 2 - gap / 2)
        tip = math.dist(p0, p1) / 2
        feathers += f'<path d="M{f(c)} L{f(p0)} A {tip:.1f} {tip:.1f} 0 0 1 {f(p1)} Z"/>'
    rings = ''.join(f'<circle cx="{c[0]}" cy="{c[1]}" r="{r:.0f}" fill="{col}"/>' for r, col in bands)
    cid = f'fan{int(L)}'
    return f'<defs><clipPath id="{cid}">{feathers}</clipPath></defs><g clip-path="url(#{cid})">{rings}</g>'


def afro(cx, cy, R, fill, n=30, seed=11):
    """A round Afro: a disc with a ring of slightly uneven bumps, outlined in black."""
    rb = R * 0.16
    rnd = random.Random(seed)
    blobs = [(cx, cy, R - rb * 0.7)]
    for i in range(n):
        a = 2 * math.pi * i / n
        r = rb * (0.85 + 0.3 * rnd.random())
        blobs.append((cx + (R - r) * math.sin(a), cy - (R - r) * math.cos(a), r))
    s = ''.join(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r + OUT:.1f}" ry="{r + OUT:.1f}" fill="#000"/>' for x, y, r in blobs)
    return s + ''.join(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{r:.1f}" ry="{r:.1f}" fill="{fill}"/>' for x, y, r in blobs)


def pick(x, y, angle):
    """An Afro pick: teeth sunk into the hair, handle sticking out."""
    teeth = ''.join(f'<rect x="{-27 + i * 15}" y="0" width="8" height="64" rx="4" fill="#000"/>' for i in range(4))
    return (f'<g transform="translate({x} {y}) rotate({angle})">{teeth}'
            f'<rect x="-34" y="-16" width="68" height="22" rx="6" fill="#000"/>'
            f'<rect x="-27" y="-100" width="54" height="92" rx="20" fill="#000"/>'
            f'<rect x="-18" y="-91" width="36" height="74" rx="13" fill="{YEL}"/></g>')


def lens(x, y, r):
    return (f'<circle cx="{x}" cy="{y}" r="{r + OUT * 0.6}" fill="#000"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="#0a0a0a" stroke="{YEL}" stroke-width="{max(6, r * 0.16):.0f}"/>'
            f'<path d="M{x - r * 0.55:.1f} {y - r * 0.1:.1f} A {r * 0.6:.1f} {r * 0.6:.1f} 0 0 1 {x - r * 0.05:.1f} {y - r * 0.58:.1f}" '
            f'stroke="#fff" stroke-opacity=".9" stroke-width="{max(5, r * 0.13):.0f}" fill="none" stroke-linecap="round"/>')


def head(cx, cy, r):
    return f'<circle cx="{cx}" cy="{cy}" r="{r + OUT}" fill="#000"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="{MAIN}"/>'


def face(cx, cy, s=1.0):
    """Round shades and a beak."""
    out = lens(cx - 56 * s, cy, 46 * s) + lens(cx + 56 * s, cy, 46 * s)
    out += f'<path d="M{cx - 14 * s:.1f} {cy - 8 * s:.1f} Q{cx} {cy - 20 * s:.1f} {cx + 14 * s:.1f} {cy - 8 * s:.1f}" stroke="{YEL}" stroke-width="{9 * s:.1f}" fill="none"/>'
    out += (f'<path d="M{cx - 32 * s:.1f} {cy + 40 * s:.1f} Q{cx} {cy + 30 * s:.1f} {cx + 32 * s:.1f} {cy + 40 * s:.1f} '
            f'Q{cx + 10 * s:.1f} {cy + 80 * s:.1f} {cx} {cy + 100 * s:.1f} Q{cx - 10 * s:.1f} {cy + 80 * s:.1f} {cx - 32 * s:.1f} {cy + 40 * s:.1f} Z" '
            f'fill="{YEL}" stroke="#000" stroke-width="{11 * s:.1f}" stroke-linejoin="round" paint-order="stroke"/>')
    return out


def strut(afro_fill=LIME):
    cx = 512
    s = fan((cx, 600), 410)
    leg = lambda x: f'M{x} 880 L{x} 930 M{x} 930 L{x - 34} 958 M{x} 930 L{x + 34} 958 M{x} 930 L{x} 966'
    for dx in (-62, 62):
        s += f'<path d="{leg(cx + dx)}" stroke="#000" stroke-width="30" stroke-linecap="round" fill="none"/>'
        s += f'<path d="{leg(cx + dx)}" stroke="{YEL}" stroke-width="16" stroke-linecap="round" fill="none"/>'
    body = (f'M{cx} 600 C{cx + 150} 600 {cx + 205} 690 {cx + 200} 760 C{cx + 195} 850 {cx + 110} 905 {cx} 905 '
            f'C{cx - 110} 905 {cx - 195} 850 {cx - 200} 760 C{cx - 205} 690 {cx - 150} 600 {cx} 600 Z')
    s += f'<path d="{body}" fill="{MAIN}" {ST}/><clipPath id="body"><path d="{body}"/></clipPath>'
    # 70s jersey stripes
    s += '<g clip-path="url(#body)">' + ''.join(
        f'<path d="M{cx - 260} {650 + i * 46} L{cx} {800 + i * 46} L{cx + 260} {650 + i * 46}" stroke="{col}" stroke-width="26" fill="none" stroke-linejoin="round"/>'
        for i, col in enumerate((YEL, LIME))) + '</g>'
    s += f'<path d="M{cx - 62} 540 C{cx - 62} 590 {cx - 75} 625 {cx - 95} 650 L{cx + 95} 650 C{cx + 75} 625 {cx + 62} 590 {cx + 62} 540 Z" fill="{MAIN}"/>'
    s += afro(cx, 318, 212, afro_fill, n=28) + pick(cx + 120, 165, 28)
    s += head(cx, 452, 116) + face(cx, 440)
    return svg(s)


def superfly(afro_fill=LIME):
    cx = 512
    s = fan((cx, 640), 392)
    # shirt with a big pointed 70s collar, open at the neck, and a medallion
    s += f'<path d="M150 1024 C160 870 255 775 410 748 L614 748 C769 775 864 870 874 1024 Z" fill="{DARK}" {ST}/>'
    s += f'<path d="M448 600 C452 660 446 710 438 760 L512 905 L586 760 C578 710 572 660 576 600 Z" fill="{MAIN}" {ST}/>'
    s += f'<path d="M444 712 L268 852 L388 866 L512 915 Z" fill="{YEL}" {ST}/>'
    s += f'<path d="M580 712 L756 852 L636 866 L512 915 Z" fill="{YEL}" {ST}/>'
    s += f'<path d="M470 770 Q512 852 554 770" stroke="{YEL}" stroke-width="8" fill="none"/>'
    s += f'<circle cx="512" cy="838" r="30" fill="{YEL}" stroke="#000" stroke-width="10" paint-order="stroke"/><circle cx="512" cy="838" r="13" fill="{DARK}"/>'
    s += afro(cx, 335, 222, afro_fill) + pick(cx + 128, 172, 28)
    s += head(cx, 478, 126) + face(cx, 466, 1.08)
    return svg(s)


CONCEPTS = {
    '1a-strut': strut(),
    '1b-strut-dark-afro': strut(DARK),
    '2a-superfly': superfly(),
    '2b-superfly-dark-afro': superfly(DARK),
}

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    for name, text in CONCEPTS.items():
        with open(os.path.join(out, f'{name}.svg'), 'w') as fh:
            fh.write(text + '\n')
    print(' '.join(CONCEPTS))
