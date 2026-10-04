# OmniStore Games — License Gate Records

Every game entering the OmniStore catalog passes an individual license gate.
Any game or asset with an unclear license, or whose assets we cannot legally
redistribute, is **DO NOT INCLUDE**. Licenses below were verified against the
upstream repository itself (GitHub license endpoint + LICENSE file content),
not merely against the existence of a repository.

> Base portal reused under MIT: **attogram/games** — https://github.com/attogram/games
> (vendored reference copy of its games list + LICENSE in `games/_vendor/`).
> Yandex Games is a UX/IA reference only; no Yandex branding, content, assets
> or inventory are used anywhere.

---

## Gate record format

```ini
GAME_NAME=
SOURCE_URL=
REPOSITORY=
LICENSE=
LICENSE_CONFIRMED=
COMMERCIAL_USE_ALLOWED=
REDISTRIBUTION_ALLOWED=
ATTRIBUTION_REQUIRED=
ASSET_LICENSE_CONFIRMED=
STATUS=
```

---

## Rejected during candidate audit (portal-level, research phase)

```ini
GAME_NAME=gfiles (BinBashBanana/gfiles)
REPOSITORY=https://github.com/BinBashBanana/gfiles
LICENSE=NONE
LICENSE_CONFIRMED=FAIL
COMMERCIAL_USE_ALLOWED=FAIL
REDISTRIBUTION_ALLOWED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=DO_NOT_INCLUDE
NOTES=Contains Flash games and ROM-based content (WebRetro): double legal risk.

GAME_NAME=uzayzone (dvrmuzy/uzayzone)
REPOSITORY=https://github.com/dvrmuzy/uzayzone
LICENSE=NONE
LICENSE_CONFIRMED=FAIL
COMMERCIAL_USE_ALLOWED=FAIL
REDISTRIBUTION_ALLOWED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=DO_NOT_INCLUDE

GAME_NAME=ReactGamePortal (Sayandeep1013/ReactGamePortal)
REPOSITORY=https://github.com/Sayandeep1013/ReactGamePortal
LICENSE=NONE
LICENSE_CONFIRMED=FAIL
COMMERCIAL_USE_ALLOWED=FAIL
REDISTRIBUTION_ALLOWED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=DO_NOT_INCLUDE

GAME_NAME=hextris-lite (attogram/hextris-lite)
REPOSITORY=https://github.com/attogram/hextris-lite
LICENSE=GPL-3.0
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=FAIL
REDISTRIBUTION_ALLOWED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=REFERENCE_ONLY
NOTES=Copyleft: never copied into OmniStore distribution.

GAME_NAME=clumsy-bird (ellisonleao/clumsy-bird)
REPOSITORY=https://github.com/ellisonleao/clumsy-bird
LICENSE=GPL-3.0
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=FAIL
REDISTRIBUTION_ALLOWED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=REFERENCE_ONLY
NOTES=Copyleft: never copied into OmniStore distribution.

GAME_NAME=HTML5-Asteroids SOUND ASSETS (39459__THE_bizniss__laser.wav, 51467__smcameron__missile_explosion.wav)
REPOSITORY=https://github.com/dmcinnes/HTML5-Asteroids
LICENSE=UNCLEAR (freesound.org files, no license documentation in repo)
LICENSE_CONFIRMED=FAIL
ASSET_LICENSE_CONFIRMED=FAIL
STATUS=DO_NOT_INCLUDE
NOTES=Files physically excluded from our build; game.js call sites patched to silent stubs.
```

---

## INCLUDED GAMES (all gates PASS)

### 1. 2048

```ini
GAME_NAME=2048 (2048-lite)
SOURCE_URL=https://github.com/attogram/2048-lite
REPOSITORY=https://github.com/attogram/2048-lite
LICENSE=MIT (LICENSE.txt: "The MIT License (MIT), Copyright (c) 2014 Gabriele Cirulli")
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (copyright + permission notice retained: LICENSE.txt shipped in games/2048/)
ASSET_LICENSE_CONFIRMED=PASS (all assets under the repo MIT license; no third-party assets)
STATUS=INCLUDED
ATTRIBUTION_LINE=© 2014 Gabriele Cirulli — MIT License (2048-lite packaging © Attogram Project)
```

### 2. Chess

```ini
GAME_NAME=Chess (attogram/chess)
SOURCE_URL=https://github.com/attogram/chess
REPOSITORY=https://github.com/attogram/chess
LICENSE=MIT (LICENSE: "MIT License, Copyright (c) 2019 Attogram Project")
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (LICENSE shipped in games/chess/)
ASSET_LICENSE_CONFIRMED=PASS (piece images ship inside the MIT repository)
STATUS=INCLUDED
ATTRIBUTION_LINE=© 2019 Attogram Project — MIT License
```

### 3. HexGL

```ini
GAME_NAME=HexGL (HexGL-lite)
SOURCE_URL=https://github.com/attogram/HexGL-lite
REPOSITORY=https://github.com/attogram/HexGL-lite
LICENSE=MIT (LICENSE: "The MIT License (MIT), Copyright (c) 2015 Thibaut Despoulain")
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (LICENSE shipped in games/hexgl/)
ASSET_LICENSE_CONFIRMED=PASS (code under MIT; audio under CC-BY-3.0 boost/wind/destroyed + Public Domain crash/bg — licensing shipped in games/hexgl/audio/LICENSE; distribution-only artifacts package.zip/textures.full/replays/CoffeeScript sources excluded)
STATUS=INCLUDED
ATTRIBUTION_LINE=© 2015 Thibaut Despoulain — MIT License (HexGL-lite packaging © Attogram Project); sounds per games/hexgl/audio/LICENSE
```

### 4. Fire 'n Ice

```ini
GAME_NAME=Fire 'n Ice
SOURCE_URL=https://github.com/eugenioenko/fire-n-ice
REPOSITORY=https://github.com/eugenioenko/fire-n-ice
LICENSE=MIT (LICENSE: "MIT License, Copyright (c) 2019 Eugene Enko")
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (LICENSE + README.MD shipped in games/fire-n-ice/)
ASSET_LICENSE_CONFIRMED=PASS (we ship the project's own complete docs/ web build; fonts load from Google Fonts at runtime under the OFL; source map removed)
STATUS=INCLUDED
ATTRIBUTION_LINE=© 2017 Eugene Yakhnenko — MIT License
```

### 5. Tower Blocks

```ini
GAME_NAME=Tower Blocks (tower_game)
SOURCE_URL=https://github.com/iamkun/tower_game
REPOSITORY=https://github.com/iamkun/tower_game
LICENSE=MIT (LICENSE: "MIT License, Copyright (c) 2018 BMQB, Inc")
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (LICENSE shipped in games/tower-blocks/)
ASSET_LICENSE_CONFIRMED=PASS (assets under repo MIT; upstream Google Tag Manager script removed; package-lock.json excluded)
STATUS=INCLUDED
ATTRIBUTION_LINE=© 2018 BMQB, Inc — MIT License
```

### 6. Asteroids

```ini
GAME_NAME=Asteroids (HTML5-Asteroids)
SOURCE_URL=https://github.com/dmcinnes/HTML5-Asteroids
REPOSITORY=https://github.com/dmcinnes/HTML5-Asteroids
LICENSE=MIT (LICENSE: "Copyright (c) 2010 Doug McInnes" + MIT permission grant)
LICENSE_CONFIRMED=PASS
COMMERCIAL_USE_ALLOWED=PASS
REDISTRIBUTION_ALLOWED=PASS
ATTRIBUTION_REQUIRED=PASS (LICENSE shipped in games/asteroids/)
ASSET_LICENSE_CONFIRMED=PASS for shipped assets (vector-battle typeface ships in repo; the two .wav SFX are DO_NOT_INCLUDE and were removed + call sites patched to silent stubs)
STATUS=INCLUDED (code + verified assets only)
ATTRIBUTION_LINE=© 2010 Doug McInnes — MIT License
```

---

## Attribution page

Public attribution is rendered at `/games/licenses.html` (generated from this
registry's `attribution` fields) and linked from the Online Games portal.
