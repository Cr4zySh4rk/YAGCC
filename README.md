<p align="center"><img src="assets/brand/yagcc-logo.png" alt="YAGCC — Yet Another Guitar Controller Configurator" width="420"></p>

# YAGCC — Yet Another Guitar Controller Configurator

A browser-based configurator **and** matching firmware for DIY guitar controllers on the Raspberry Pi Pico family.
Flash the board, plug it in, and the web app walks you through mapping every button — no matter which pins you wired them to.

**Web app:** https://cr4zysh4rk.github.io/YAGCC/ (GitHub Pages) · also deployable on Vercel (see below)

> Requires a Chromium-based browser (Chrome, Edge, Brave, …) for WebUSB. Downloading firmware works in any browser.

## Demo

<p align="center">
  <a href="https://cr4zysh4rk.github.io/YAGCC/demo/yagcc-demo.mp4"><img src="assets/demo/demo-preview.gif" alt="Guided setup: each fret is pressed twice and YAGCC assigns its pin" width="800"></a>
</p>

**[▶ Watch the full walkthrough (5 min, with voice-over and subtitles)](https://cr4zysh4rk.github.io/YAGCC/demo/yagcc-demo.mp4)**: flashing, guided setup, whammy calibration, LED mapping, tuning, lights, modes and the compatibility tables. No real guitar was used; a simulated controller feeds the configurator the same data the firmware sends.

## How it works

1. **Flash** – download the *flash nuke* (wipes the old firmware and settings) and the YAGCC firmware for your board, or let the page write them straight to the `RPI-RP2` drive.
2. **Plug in** – the page detects the controller and jumps to guided setup.
3. **Guided setup** – for every control YAGCC asks you to press it twice within a second, watches which GPIO changed, and assigns it:
   green → red → yellow → blue → orange → strum up → strum down → star power → plus.
4. **Whammy** – move the bar through two full sweeps; YAGCC finds the analog pin, calibrates min/max, detects direction and shows a live meter. Live readings of GP26–28 are shown, with a manual *Use pin* / *Capture rest* / *Capture full* fallback.
5. **RGB** – say whether you wired 5 RGB LEDs, give the data pin, and teach YAGCC which LED sits under which fret by pressing the frets.
6. **Add-ons** – Bluetooth toggle (Pico W / Pico 2 W only) and an optional tilt switch (a plain digital switch such as a mercury ball switch; tilt up twice within 5 s to register it as a star-power shortcut).
7. **Tune** – debounce time (presets or slider), combined-strum debounce, whammy smoothing, dead-zone and direction, all live.
8. **Lights** – optional RGB LEDs under the frets (WS2812, SK6812 RGBW or APA102; colours, reactive effects, brightness, LED order, star power glow).
9. **Modes** – choose what the controller pretends to be, the XInput guitar type and the Fortnite Festival key bindings.
10. **Hardware / Compatibility** – reference pages listing supported boards and parts, and what works with which game and console.

## USB modes

| Hold at plug-in (default) | Mode | What it is | Best for |
|---|---|---|---|
| Green | **XInput** | Xbox 360 guitar (Guitar Hero or Rock Band type, selectable). Answers Xbox 360 security (XSM3) | Windows / Clone Hero / YARG / Fortnite Festival (PC), Xbox 360 *(experimental)* |
| Red | **PS3 Rock Band** | Rock Band guitar `12BA:0200` (Santroller report layout: tilt → R1, star power → select) | Rock Band on PS3 / RPCS3, YARG |
| Yellow | **HID gamepad** | Generic gamepad (16 buttons, hat, 4 axes) | macOS, Linux, Android, emulators |
| Blue | **PS3 Guitar Hero** | RedOctane `12BA:0100` with the PS3 guitar handshake | Guitar Hero on PS3 / RPCS3, Clone Hero |
| Orange | **Nintendo Switch** | HORI Pokkén pad `0F0D:0092`: green A, red B, yellow Y, blue X, orange L, tilt R, star − , plus +, strum on the D-pad, whammy on the right stick | Fortnite Festival on Switch, other Switch games |
| *(assign on Modes tab)* | **Fortnite Festival (keyboard)** | USB keyboard with the Fortnite Festival *Pro guitar* default keys (frets 1–5, strum Right Shift / Right Ctrl, star power PageDown, plus Esc) | Fortnite Festival on **PS4, PS5, Xbox One/Series and PC**: consoles accept a keyboard with no authentication |
| *(assign on Modes tab)* | **Wii Rock Band** | Harmonix Wii guitar `1BAD:0004` | Rock Band on Wii / Dolphin |
| *(assign on Modes tab)* | **OG Xbox** | Original Xbox controller (XID) | Guitar Hero II / III on original Xbox *(experimental)* |
| *(assign on Modes tab)* | **PS4 / PS5 guitar** | Rock Band 4 PS4 guitar (`1532:0401`); console authentication is passed through to a controller on the USB host port | Rock Band 4 on PS4 / PS5 *(experimental, untested on a console)* |
| *(assign on Modes tab)* | **Xbox One / Series guitar** | Rock Band 4 Stratocaster over GIP (`0738:02EA`); authentication passed through to a controller on the USB host port | Rock Band 4 on Xbox One / Series *(experimental, untested on a console)* |
| Plus | **Setup mode** | XInput + web config for this boot only, nothing saved | |
| Star + Plus | **Bootloader** | Jumps to UF2 mode so you can reflash without touching BOOTSEL | |
| Star | **Bluetooth pairing** | Pico W / Pico 2 W: forget the old host and pair a new one (the USB mode is the default one) | |

The mode picked by holding a fret is remembered (like GP2040-CE), and every fret → mode assignment can be changed on the **Modes** tab.

**Fortnite Festival.** On a Switch, hold **orange** while plugging in (Switch mode). On PS4, PS5, Xbox and PC, assign keyboard mode to a fret on the Modes tab and hold that fret while plugging in; in Fortnite turn on *Pro* input for guitar and choose the keyboard layout that matches the bindings shown on the Modes tab (Pro guitar is the default; a Lead-lane preset — D F J K L, arrows, Space — is one click away, and every key is rebindable). On PC you can also use XInput mode with *Star power → D-pad left* switched on.

**XInput options.** The guitar can report as a *Guitar Hero* (subtype 7) or *Rock Band* (subtype 6) guitar. Whammy sits on right stick X and tilt on right stick Y, both resting at the bottom like real guitars. When a game sends star power / overdrive state over the rumble channel, the fret LEDs can glow cyan (*Star power glow* on the Lights tab).

**Configuring in other modes:** XInput, HID and keyboard modes keep the WebUSB config channel (browsers grant permission per mode, so press *Connect* once after switching). PS3, Wii, Switch and OG Xbox modes have to look exactly like the real device, so they have no config channel: the Setup page finds PS3/Wii guitars over WebHID (*Find it*) and restarts them in setup mode with one click; for the others hold *Plus* while plugging in. **macOS** has no XInput driver, so use HID mode for games on a Mac.

**Console authentication (USB host port) — experimental.** PS4, PS5 and Xbox One / Series only accept licensed controllers. Like GP2040-CE, YAGCC can run a second, software USB port (Pico-PIO-USB on PIO1) and pass the console's security check through to a licensed controller plugged into it:

* Pick the port's pins on the **Modes** tab (*Console authentication*): D+ on any free GPIO, D− on the next one.
* Wire a USB-A socket: **D+** (green) and **D−** (white) to those pins, **VBUS** (red) to the board's VBUS / 5 V pin, **GND** (black) to GND.
* **PS4 / PS5 mode:** plug in a wired DualShock 4 or a USB PS4 authentication dongle. The console sends its challenge to the guitar, which forwards it to the controller and returns the signed answer. PS5 needs a PS4 controller, not a DualSense.
* **Xbox One / Series mode:** plug in a wired Xbox One / Series controller (Microsoft, PowerA, …) or a Mayflash / MagicBoots adapter. The guitar announces itself as a Rock Band 4 Stratocaster and relays the GIP security exchange; inputs are sent once the console accepts it.
* With the host port on, the firmware runs the system clock at 120 MHz (needed for USB timing) and those two pins can't be used for buttons.

This is ported from GP2040-CE's PS4 and Xbox One drivers but **has not yet been tested on a real console**; reports are welcome.

**Backup and restore.** The **Tune** tab can download all settings (wiring, tuning, lights, modes) as a JSON file and restore any of those sections later, onto the same guitar or another one. Files are checked before anything is written, and pins that would clash on the target are skipped.

**Live 3D guitar.** The Setup, Tune and Lights pages show a 3D Les Paul (blue-purple front plate, black trim) that copies the real guitar as you play it: frets press in and light up in their LED colours, the strum bar rocks up and down, the whammy bar dips as far as you push it, Star power and Plus light up, and the guitar lifts its neck when the tilt sensor fires. Drag to turn it, double-click to reset. It loads only when a page with the guitar is opened. If the browser has no hardware graphics acceleration, the flat drawing is shown instead (add `?2d` to the address to force it).

**Firmware updates.** When a guitar connects, the configurator compares its firmware version with the latest one on the site. If the guitar is older, a banner offers the update: it opens the Flash page with your board already picked, and the guitar can restart itself into update mode (no BOOTSEL button needed), so you only drop the new file on the drive that appears. Settings are kept.

See the **Compatibility** page in the web app for a game-by-game / console-by-console table with honest status labels (Supported, Experimental, Planned).

## Wiring

* Buttons: any of **GP0–GP22**, switched to **GND** (internal pull-ups are enabled).
* Whammy potentiometer: wiper to **GP26, GP27 or GP28** (ADC0–2), one end to **3V3(OUT) (pin 36)**, the other to GND/AGND. Don't power it from ADC_VREF (pin 35): on many clone boards that pin isn't fed, and the bar then barely moves the reading.
* Tilt switch: any of GP0–GP22 to GND (a mercury ball switch is fine).
* LED data line (WS2812 / SK6812): any free GP0–GP22. APA102 / DotStar also needs a clock pin (any free GP0–GP22).

## RGB lighting

* Five individually addressable LEDs under the frets. Supported chips:
  * **WS2812 / WS2812B / NeoPixel** (one data pin, PIO-driven) with selectable colour order (GRB, RGB, BRG, …)
  * **SK6812 RGBW** (one data pin; the shared white part of a colour moves to the white LED)
  * **APA102 / SK9822 / DotStar** (data + clock pins)
* **Brightness 0–255** – full range; five LEDs at full white draw up to ~300 mA from USB.
* Per-fret **colours** with presets (gamma-corrected on the LEDs, so the red and orange you pick on screen come out red and orange, not pink and peach), and an **LED order wizard**: each LED lights white in turn and you press the fret above it.
* **Effects**: static, dim on press, off on press, brighten on press, flash & fade, breathing, rainbow (speed adjustable).
* **Mode indicator**: after plug-in the fret LED that selects the running mode (green = XInput, red = PS3 Rock Band, yellow = HID, blue = PS3 Guitar Hero, orange = Switch by default) flashes for one second.
* **Star power glow**: in XInput mode, games that report star power (Clone Hero, YARG, Guitar Hero via the rumble channel) make the idle frets pulse cyan.
* **Charging / no-host sweep**: if the guitar has USB power but no host (over USB or Bluetooth) talks to it for 3 s (a phone charger or power bank, for example when the Pico's USB port also feeds a TP4056 battery charger), a soft light runs slowly from the orange fret to the green one and repeats. Held frets still light up, and normal lighting returns as soon as a PC or console connects. On the Pico and Pico 2 (and the Pico W / Pico 2 W while Bluetooth is on) the firmware also checks the USB power pin, so running from the battery alone doesn't trigger it; on other boards it's based on the missing host only.
* The LEDs work in every USB mode, including the PS3 modes where the web config is unavailable (set them up beforehand).

## Debounce

YAGCC uses a *lockout + glitch filter* engine, designed after reading how Santroller and GP2040-CE do it:

* **GP2040-CE** debounces with a per-pin lockout: the first edge is taken immediately, then changes are ignored for the delay (default 5 ms) before the input re-syncs to the raw level.
* **Santroller** lets presses through instantly and holds *releases* for the debounce time, with an optional press-delay mode and a combined strum debounce.
* **YAGCC** takes the best of both: a 0.2 ms press / 1 ms release glitch filter (so EMI spikes and contact flutter never register), then a per-input lockout (default 5 ms) after every accepted edge, then re-sync. Strum up/down additionally share a lockout so a bouncing strum switch can't fire both directions. A mercury tilt switch gets at least a 20 ms lockout.

The only knob is the lockout time (presets from Off to 20 ms, or a slider up to 25 ms). Inputs are sampled at up to 10 kHz.

## Boards

| Build | Board |
|---|---|
| `pico_clone` | Generic RP2040 "Pico-compatible" clones, including boards with an ESP8285 (Wi-Fi only) instead of a real Pico W radio. Uses the generic flash boot stage, slower flash clock and longer crystal start-up, like Santroller's `pico_w_compat`. **If unsure, use this one.** |
| `pico` / `pico_w` | Official Raspberry Pi Pico / Pico W |
| `pico2` / `pico2_w` | Official Pico 2 / Pico 2 W (RP2350) |
| `waveshare_rp2040_zero` | Waveshare RP2040-Zero (tiny, fits inside most guitar necks) |
| `waveshare_rp2040_one` | Waveshare RP2040-One |
| `sparkfun_promicro` | SparkFun Pro Micro RP2040 (Pro Micro footprint, drop-in for old Arduino builds) |
| `adafruit_kb2040` | Adafruit KB2040 (Pro Micro footprint) |

The **Hardware** page in the web app describes each board, the LED types, whammy pots, tilt sensors and wiring, and warns about fake "Pico W" boards. Arduino (ATmega32U4 / 328P) and other microcontrollers are not supported: YAGCC is RP2040/RP2350 only.

**Bluetooth (experimental, untested on hardware)** needs the CYW43 radio of a genuine Pico W / Pico 2 W; the ESP8285 on clone boards is Wi-Fi only, so the toggle is disabled there. Over Bluetooth LE (HID over GATT, BTstack) the guitar presents **the same device as over USB in the running mode**: the same HID report descriptor, the same report bytes and the same vendor / product ids (PS3 Guitar Hero, PS3 / Wii Rock Band, Switch, keyboard, HID gamepad, PS4). XInput, original Xbox and Xbox One aren't HID devices over USB, so over Bluetooth they use the generic gamepad. Each mode is its own Bluetooth device ("YAGCC PS3 GH", "YAGCC Switch", …) with its own address, so a host never mixes up two modes' layouts. Whether a console accepts it is up to the console: most only take their own wireless controllers.

* **Pair a new device** (like PS + Create on a PlayStation controller): hold **Star power** while plugging in or switching on. The guitar forgets its previous host, turns Bluetooth on, becomes discoverable for two minutes and the frets double-blink blue. Holding **Star power + Plus** for 5 s while it is running does the same. When a host connects, all frets light blue for a second.
* **Switch modes over Bluetooth**: hold **Star power + a fret for 3 s** to switch to the mode that fret selects at plug-in (the shortcuts on the Modes tab). The guitar saves the mode and restarts into it within a second or two, then stays discoverable for a minute so an already paired host can add that mode (pair each mode once; after that it reconnects by itself).
* Otherwise it only lets hosts it is paired with reconnect, and it doesn't advertise as discoverable.
* **USB turns Bluetooth off**: as soon as a PC or console talks to the guitar over USB, it drops any Bluetooth connection and stops advertising, so a cable and a wireless link never both feed a game. Unplug it (or use a charger) and Bluetooth comes back within a couple of seconds and the paired host reconnects. For the first 1.5 s after power-on it waits to see whether a USB host shows up.
* Reconnection: after the link is encrypted the guitar requests a 3 s link timeout (and a 7.5–15 ms connection interval), so after a power cycle the host notices quickly and reconnects. It stays off in the PS4 / Xbox One modes only when the USB host port is set up, since both need the same hardware.
* Pairing uses **LE Secure Connections** with the keys stored in flash (the two sectors below the settings sector), like BTstack's own HID examples; every mode keeps its own list of paired hosts.
* **Bluetooth log**: the Setup page's Bluetooth step can show (and copy) the last 48 Bluetooth events since the guitar was switched on: advertising, connections, encryption, pairing results and disconnect reasons. After a problem, plug the guitar in without switching it off and read the log.

## Scope and roadmap

YAGCC is guitar-only for now (drums and other instruments are out of scope). Experimental and untested on consoles: PS4 / PS5 and Xbox One / Series guitar modes with authentication passthrough. Experimental and untested on hardware: Bluetooth LE gamepad output on Pico W / Pico 2 W. Planned, not yet implemented: wireless receivers, peripheral (wired neck) support over I²C.

## Repository layout

```
firmware/   pico-sdk + TinyUSB firmware (XInput, PS3 GH/RB, HID, keyboard, Switch, Wii RB, OG Xbox + WebUSB config),
            PS4 / Xbox One modes with auth passthrough (src/host), LED drivers, flash nuke,
            lib/xsm3 (Xbox 360 security, LGPL-2.1), lib/pico_pio_usb (USB host port, MIT)
web/        static web app (no build step) – deployed as-is; models/guitar.glb + vendor/three-yagcc.js for the 3D view
tools/      model/build_glb.py rebuilds the 3D guitar from the Sketchfab download
tests/      unit tests for pin and whammy detection
.github/    CI: builds all firmware variants and deploys the site to GitHub Pages
assets/     logo and demo media
vercel.json Vercel configuration (serves web/)
```

### Build the firmware locally

```bash
git clone --depth 1 -b 2.1.1 https://github.com/raspberrypi/pico-sdk
git -C pico-sdk submodule update --init --depth 1 lib/tinyusb
cmake -S firmware -B build -G Ninja -DPICO_BOARD=pico_clone -DPICO_SDK_PATH=$PWD/pico-sdk
cmake --build build        # build/yacc.uf2 (published as yagcc-<board>.uf2) and build/nuke/yacc_nuke.uf2
```

### Bluetooth test firmware

`-DYACC_BT_LOG_FLASH=ON` (Pico W / Pico 2 W) builds firmware that also keeps the Bluetooth event log in 16 KB of flash, so it survives power cycles until **Clear** is pressed on the Setup page's Bluetooth step; the log is grouped by power-on. It is meant for chasing connection problems and is not published on the Flash page.

```bash
cmake -S firmware -B build-btlog -G Ninja -DPICO_BOARD=pico_w -DYACC_BT_LOG_FLASH=ON -DPICO_SDK_PATH=$PWD/pico-sdk
cmake --build build-btlog
```

### Tests

```bash
node tests/detect.test.mjs
node tests/firmware_version.test.mjs   # web/firmware.json must match firmware/CMakeLists.txt
```

When you bump `YACC_VERSION_MINOR`, update `web/firmware.json` too: the configurator compares a connected guitar's version with it and offers an update when the guitar is older.

### Run the site locally

```bash
python3 -m http.server -d web 8000   # then open http://localhost:8000 in Chrome
```

## Deploying

* **GitHub Pages** – automatic: every push to `main` builds the firmware for all boards and publishes `web/` plus fresh UF2s. Asset URLs are cache-busted per deploy, and the deploy step retries once on transient GitHub errors.
* **Vercel** – import the repository at <https://vercel.com/new>. `vercel.json` already points the output directory at `web/` and needs no build step. The UF2 files committed in `web/downloads/` are served directly.

## Protocol (for hackers)

Configuration travels over WebUSB vendor control transfers on interface 1 (WinUSB via MS OS 2.0 descriptors):
`0x30` info · `0x31` live status (GPIO levels, ADCs, debounced press counters) · `0x32/0x33` get/set config (96 bytes, version 4, CRC32, byte 73 = USB host port D+ pin; older 64-byte v3 configs are migrated on boot) · `0x34` save · `0x35` defaults · `0x36` reboot/bootloader · `0x37` set mode · `0x38` light one LED (wizard).
In the PS3 and Wii modes the configurator sends HID feature report `YAGCC!` to restart the controller once in setup mode.
See `firmware/src/config.h`, `firmware/src/usb_common.h` and `web/js/protocol.js`.

## Credits & license

Inspired by and compatible in spirit with [Santroller](https://github.com/Santroller/Santroller) and [GP2040-CE](https://github.com/OpenStickCommunity/GP2040-CE); USB identities and handshakes were studied from Santroller. Xbox 360 security uses **libxsm3** (from Santroller, LGPL-2.1, `firmware/lib/xsm3`). The 3D guitar is based on ["Guitar Hero Controller"](https://sketchfab.com/3d-models/guitar-hero-controller-bcac8f9f95a44008ad90f470326e5fca) by [CamSear16](https://sketchfab.com/CamSear16), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); it was split into moving parts, given a blue-purple front plate with black trim, and brand marks were removed (see `tools/model/README.md`). It is rendered with **three.js** (MIT). The PS4 and Xbox One authentication passthrough is adapted from **GP2040-CE** (MIT; `firmware/src/host`, including its `xgip_protocol` and XInput host driver), and the Rock Band 4 guitar identities and report layouts follow Santroller. The USB host port uses **Pico-PIO-USB** 0.6.1 by sekigon-gonnoc (MIT, `firmware/lib/pico_pio_usb`). YAGCC is licensed under **GPL-3.0** (see `LICENSE`).
