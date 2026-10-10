# The Jive Turkey: icon concepts

A new logo and app icon for the team: a turkey with a big Afro, round 70s shades and an Afro pick. His
tail fans out like a 70s rainbow, in the site's greens on black. These are the first concepts, saved so
they aren't lost. None of them is on the site yet (it still uses `public/logo.jpg` and the icons made
from it).

![The four concepts](concepts.png)

| | Design | What it is |
|---|---|---|
| 1A | [Strut](1a-strut.svg) | The whole bird, in a striped 70s jersey |
| 1B | [Strut, dark Afro](1b-strut-dark-afro.svg) | Same, with a deeper green Afro |
| 2A | [Superfly](2a-superfly.svg) | Close-up, with a big pointed 70s collar and a medallion |
| 2B | [Superfly, dark Afro](2b-superfly-dark-afro.svg) | Same, with a deeper green Afro |

## Soccer versions

The same turkey on the team, with the black-and-white ball style that first appeared at the 1970 World
Cup. All are shown with the dark Afro; the lime one works too.

![The soccer versions](soccer-concepts.png)

| | Design | What it is |
|---|---|---|
| 1 | [Striker](s1-strut-ball.svg) | Strut, with the ball at his feet |
| 2 | [Keepy-uppy](s2-superfly-keepy.svg) | Superfly, balancing the ball on his Afro |
| 3 | [70s Kit](s3-superfly-kit.svg) | Superfly in a striped 70s soccer jersey, with a soccer-ball medallion |
| 4 | [All In](s4-superfly-kit-keepy.svg) | The striped jersey and the ball on his Afro |

## Editing

The SVGs are drawn by [draw.py](draw.py), which uses only the Python standard library:

```bash
python3 docs/design/jive-turkey/draw.py
```

It rewrites the four SVGs next to it. `soccer.py` builds on it and draws the soccer versions the same way. Change the shapes or colors there rather than editing the SVGs by
hand. The colors are the site's: `#3EC63A` green, `#8FD33E` lime, `#C9E64A` yellow-green and `#1E7A2A`
dark green, on black.
