"""The Jive Turkey plays soccer: the concepts in draw.py, with a 1970-style black-and-white ball.

    python3 docs/design/jive-turkey/soccer.py [output folder]

  s1-strut-ball            Strut, with the ball at his feet
  s2-superfly-keepy        Superfly, balancing the ball on his Afro
  s3-superfly-kit          Superfly in a striped 70s soccer jersey, with a soccer-ball medallion
  s4-superfly-kit-keepy    the striped jersey and the ball on his Afro
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from draw import *  # noqa: E402,F403

WHITE = '#F4F4F5'

def ball(cx, cy, r, base=WHITE, ink='#000', rot=0):
    """A 1970-style black-and-white ball: a black pentagon in the middle, five more around it, joined by seams."""
    cid = f'ball{int(cx)}{int(cy)}'
    c = (cx, cy)
    poly = lambda pts: 'M' + ' L'.join(f(p) for p in pts) + 'Z'
    p, q = r * 0.30, r * 0.58          # middle pentagon size; where the seams from it end
    w = max(3, r * 0.05)
    s = f'<circle cx="{cx}" cy="{cy}" r="{r + OUT}" fill="#000"/>'
    s += f'<clipPath id="{cid}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath><g clip-path="url(#{cid})">'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{base}"/>'
    s += f'<path d="{poly([pt(c, p, rot + 72 * k) for k in range(5)])}" fill="{ink}"/>'
    outer = []
    for k in range(5):
        a = rot + 72 * k
        s += f'<path d="M{f(pt(c, p, a))} L{f(pt(c, q, a))}" stroke="{ink}" stroke-width="{w:.1f}"/>'
        e = pt(c, q + p * 0.95, a)     # outer pentagon, pointing in at the seam's end
        pent = [pt(e, p * 0.95, a + 180 + 72 * j) for j in range(5)]
        outer.append(pent)
        s += f'<path d="{poly(pent)}" fill="{ink}"/>'
    for k in range(5):
        # the far sides of the hexagons: from each outer pentagon to the next
        a_side, b_side = outer[k][4], outer[(k + 1) % 5][1]
        mid = pt(c, r * 1.15, rot + 72 * k + 36)
        s += f'<path d="M{f(a_side)} L{f(mid)} M{f(b_side)} L{f(mid)}" stroke="{ink}" stroke-width="{w:.1f}"/>'
    return s + '</g>'

def strut_ball(afro_fill=DARK):
    base = strut(afro_fill)
    return base.replace('</svg>', ball(668, 888, 100, rot=10) + '</svg>')

def superfly_keepy(afro_fill=DARK, kit=False):
    inner = superfly_kit(afro_fill, medal_ball=False) if kit else superfly(afro_fill)
    inner = inner.split('<rect width="1024" height="1024" fill="#000"/>', 1)[1].rsplit('</svg>', 1)[0]
    # drop the pick (the ball sits where it was) and shrink him to make room above
    inner = re.sub(r'<g transform="translate\(640 172\) rotate\(28\)">.*?</g>', '', inner)
    s = 0.84
    g = f'<g transform="translate({512 * (1 - s):.1f} {1024 * (1 - s):.1f}) scale({s})">{inner}</g>'
    return svg(g + ball(512, 178, 92, rot=0))

SHIRT = 'M150 1024 C160 870 255 775 410 748 L614 748 C769 775 864 870 874 1024 Z'

def superfly_kit(afro_fill=DARK, stripe='#2E9E36', pin=None, medal_ball=True):
    """Superfly in a 70s soccer jersey: vertical stripes, the big collar, and a ball for a medallion."""
    out = superfly(afro_fill)
    stripes = f'<clipPath id="shirt"><path d="{SHIRT}"/></clipPath><g clip-path="url(#shirt)">'
    for x in range(-40, 1100, 120):
        stripes += f'<rect x="{x}" y="700" width="60" height="400" fill="{stripe}"/>'
        if pin:
            stripes += f'<rect x="{x + 56}" y="700" width="8" height="400" fill="{pin}"/>'
    stripes += '</g>'
    shirt_tag = f'<path d="{SHIRT}" fill="{DARK}" {ST}/>'
    assert shirt_tag in out
    out = out.replace(shirt_tag, shirt_tag + stripes)
    if not medal_ball:
        return out
    # medallion -> a small ball on the chain
    out = re.sub(r'<circle cx="512" cy="838" r="30"[^>]*/><circle cx="512" cy="838" r="13"[^>]*/>', '', out)
    return out.replace('</svg>', ball(512, 846, 44) + '</svg>')

CONCEPTS = {
    's1-strut-ball': strut_ball(),
    's2-superfly-keepy': superfly_keepy(),
    's3-superfly-kit': superfly_kit(),
    's4-superfly-kit-keepy': superfly_keepy(kit=True),
}

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    for name, text in CONCEPTS.items():
        with open(os.path.join(out, f'{name}.svg'), 'w') as fh:
            fh.write(text + '\n')
    print(' '.join(CONCEPTS))
