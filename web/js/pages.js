// Static content for the Hardware and Compatibility pages. Guitars only (drums and other instruments
// are out of scope for now). Status is honest: "Experimental" = implemented but not yet verified on
// that console / part, "Planned" = not implemented yet.

export const STATUS = {
  ok: { label: 'Supported', cls: 'ok' },
  plug: { label: 'Plug & play', cls: 'ok' },
  noauth: { label: 'No auth needed', cls: 'ok' },
  legacy: { label: 'Legacy mode', cls: 'ok' },
  setup: { label: 'Setup required', cls: 'warn' },
  exp: { label: 'Experimental', cls: 'warn' },
  planned: { label: 'Planned', cls: 'plan' },
  no: { label: 'Not supported', cls: 'no' },
};

export const COMPAT = [
  { group: 'pc', console: 'PC (Windows)', game: 'Clone Hero, YARG, Fortnite Festival, RPCS3 / PCSX2 / Dolphin',
    mode: 'XInput (Guitar Hero or Rock Band type), HID, PS3 modes', how: 'Direct USB', status: 'plug',
    notes: 'For Fortnite Festival with XInput, turn on "Star power also presses D-pad left" on the Modes page, or use keyboard mode.' },
  { group: 'pc', console: 'macOS / Linux', game: 'Clone Hero, YARG, emulators',
    mode: 'HID gamepad (or PS3 modes)', how: 'Direct USB', status: 'plug',
    notes: 'macOS has no XInput driver, so XInput mode only works for configuring there.' },
  { group: 'xbox', console: 'Xbox 360', game: 'Guitar Hero, Rock Band, and every other game',
    mode: 'XInput (Guitar Hero or Rock Band type)', how: 'Direct USB', status: 'exp',
    notes: 'The console\'s security check (XSM3) is answered by the firmware, using the same library Santroller ships. Not yet confirmed on a real 360 with YAGCC.' },
  { group: 'xbox', console: 'Xbox One / Series X|S', game: 'Fortnite Festival (Pro Lead / Pro Bass)',
    mode: 'Keyboard (Fortnite Festival bindings)', how: 'Direct USB', status: 'noauth',
    notes: 'Keyboards don\'t need authentication. Assign keyboard mode to a fret on the Modes page.' },
  { group: 'xbox', console: 'Xbox One / Series X|S', game: 'Rock Band 4 and other games',
    mode: 'Xbox One / Series guitar', how: 'Wired Xbox One / Series controller on the guitar\'s USB host port', status: 'exp',
    notes: 'Shows up as a Rock Band 4 Stratocaster; the console\'s security check is passed to the controller. Not yet tested on a console.' },
  { group: 'xbox', console: 'Original Xbox', game: 'All original Xbox games',
    mode: 'Original Xbox (XID)', how: 'USB-to-Xbox-port adapter', status: 'exp', notes: 'There are no guitar games on the original Xbox; frets map to A/B/X/Y/Black.' },
  { group: 'ps', console: 'PlayStation 3', game: 'Rock Band series', mode: 'PS3 Rock Band', how: 'Direct USB', status: 'plug', notes: 'Hold red while plugging in.' },
  { group: 'ps', console: 'PlayStation 3', game: 'Guitar Hero series', mode: 'PS3 Guitar Hero', how: 'Direct USB', status: 'plug', notes: 'Hold blue while plugging in.' },
  { group: 'ps', console: 'PlayStation 2', game: 'Rock Band 1 & 2, GH World Tour, GH5, Band Hero', mode: 'PS3 Rock Band or PS3 Guitar Hero', how: 'Direct USB', status: 'ok', notes: 'These games read USB guitars.' },
  { group: 'ps', console: 'PlayStation 2', game: 'Guitar Hero 1 & 2, Guitar Hero III / Aerosmith (older games)', mode: 'PS3 Guitar Hero + PADEMU', how: 'USB, game launched from Open PS2 Loader with PADEMU on', status: 'setup',
    notes: 'PADEMU (DualShock3/4 USB mode) turns the PS3 guitar into a PS2 controller. A wired PS2 controller-port output is planned.' },
  { group: 'ps', console: 'PlayStation 4 / 5', game: 'Rock Band 4', mode: 'PS3 Rock Band', how: 'Direct USB', status: 'legacy', notes: 'Rock Band 4 accepts PS3 Rock Band guitars as legacy instruments, so no authentication is needed.' },
  { group: 'ps', console: 'PlayStation 4 / 5', game: 'Fortnite Festival (Pro Lead / Pro Bass)', mode: 'Keyboard (Fortnite Festival bindings)', how: 'Direct USB', status: 'noauth', notes: 'Assign keyboard mode to a fret on the Modes page.' },
  { group: 'ps', console: 'PlayStation 4 / 5', game: 'Rock Band 4 (native PS4 guitar)', mode: 'PS4 / PS5 guitar', how: 'DualShock 4 or PS4 auth dongle on the guitar\'s USB host port', status: 'exp',
    notes: 'Shows up as a PS4 Rock Band 4 guitar; the console\'s security check is passed to the controller. Not yet tested on a console. PS5 needs a PS4 controller, not a DualSense.' },
  { group: 'nin', console: 'Wii / Wii U', game: 'Rock Band 1, 2, 3, The Beatles: Rock Band', mode: 'Wii Rock Band', how: 'Direct USB', status: 'plug', notes: 'Set "Hold at plug-in" for a fret to Wii Rock Band on the Modes page.' },
  { group: 'nin', console: 'Wii / Wii U', game: 'Guitar Hero, Band Hero', mode: 'Wii Remote emulation', how: 'Bluetooth (genuine Pico W, or a USB Bluetooth dongle)', status: 'planned',
    notes: 'Clone "Pico W" boards with an ESP8285 have no Bluetooth.' },
  { group: 'nin', console: 'Nintendo Switch', game: 'Fortnite Festival and every other game', mode: 'Nintendo Switch (HORIPAD)', how: 'Direct USB', status: 'plug', notes: 'Hold orange while plugging in. Green A, red B, yellow Y, blue X, orange L, tilt R, star minus, strum on the D-pad, whammy on the right stick.' },
];

export const COMPAT_GROUPS = [
  { id: 'all', name: 'All' }, { id: 'pc', name: 'PC / Mac / Linux' }, { id: 'ps', name: 'PlayStation' },
  { id: 'xbox', name: 'Xbox' }, { id: 'nin', name: 'Nintendo' },
];

export const HW_GROUPS = [
  { id: 'all', name: 'All' }, { id: 'mcu', name: 'Microcontrollers' }, { id: 'input', name: 'Buttons & sensors' },
  { id: 'neck', name: 'Necks & adapters' }, { id: 'led', name: 'LEDs' }, { id: 'usb', name: 'USB host & wireless' },
  { id: 'power', name: 'Power' },
];

export const HARDWARE = [
  // microcontrollers
  { group: 'mcu', name: 'Raspberry Pi Pico (RP2040)', bus: 'Microcontroller', status: 'ok', tag: 'Recommended',
    points: ['GP0–GP22 for buttons, GP26–28 for the whammy', 'Up to 1000 Hz USB polling, 10 kHz input scanning', 'Firmware: yagcc-pico.uf2'] },
  { group: 'mcu', name: 'Raspberry Pi Pico 2 (RP2350)', bus: 'Microcontroller', status: 'ok',
    points: ['Same pinout as the Pico', 'Firmware: yagcc-pico2.uf2'] },
  { group: 'mcu', name: 'Raspberry Pi Pico W / Pico 2 W', bus: 'Microcontroller', status: 'ok',
    points: ['Works exactly like a Pico over USB', 'Bluetooth LE output in every mode (tested on Pico W with Windows): hold Star power at power-on to pair', 'Wii Remote emulation is planned'] },
  { group: 'mcu', name: '"Pico W" clones with an ESP8285 / ESP8266', bus: 'Microcontroller', status: 'ok',
    points: ['Use the pico_clone firmware (safer flash settings)', 'The ESP8285 is Wi-Fi only: no Bluetooth features', 'Power the whammy from 3V3(OUT), not ADC_VREF'] },
  { group: 'mcu', name: 'Waveshare RP2040-Zero / RP2040-One', bus: 'Microcontroller', status: 'ok', tag: 'Compact',
    points: ['Small enough for a guitar body or neck', 'Onboard RGB LED on GP16 — keep that pin free'] },
  { group: 'mcu', name: 'SparkFun Pro Micro RP2040 / Adafruit KB2040', bus: 'Microcontroller', status: 'ok', tag: 'Pro Micro footprint',
    points: ['Drop-in replacement for old ATmega32U4 Pro Micro builds', 'Onboard RGB LED on GP25 (Pro Micro) / GP17 (KB2040)'] },
  { group: 'mcu', name: 'ATmega32U4 / ATmega16U2 (Pro Micro, Leonardo, Uno)', bus: 'Microcontroller', status: 'no',
    points: ['8-bit AVR boards don\'t have the flash, RAM or PIO YAGCC needs', 'Swap in a Pro Micro RP2040 — same footprint'] },
  // inputs
  { group: 'input', name: 'Mechanical, arcade & original fret / strum switches', bus: 'Digital GPIO', status: 'ok',
    points: ['Wire each switch between a GPIO and GND (internal pull-ups)', 'Any pin works — the guided setup finds it', 'Lockout + glitch-filter debounce, 0–25 ms'] },
  { group: 'input', name: 'Whammy potentiometer or Hall sensor', bus: 'ADC (GP26–28)', status: 'ok',
    points: ['Wiper to GP26/27/28, ends to 3V3(OUT) and GND', 'Two-sweep auto calibration, or capture rest / full by hand', 'Smoothing, dead zone and invert'] },
  { group: 'input', name: 'Tilt switch (ball or mercury)', bus: 'Digital GPIO', status: 'ok',
    points: ['Registered by tilting up twice', 'At least 20 ms lockout so a rolling ball can\'t chatter'] },
  { group: 'input', name: 'I2C accelerometers (ADXL345, LIS3DH, MPU6050)', bus: 'I2C', status: 'planned',
    points: ['Analog tilt with an adjustable threshold'] },
  { group: 'input', name: 'MPR121 capacitive touch (World Tour slider)', bus: 'I2C', status: 'planned', points: ['Touch slider as tap frets'] },
  { group: 'input', name: 'CD4051 / CD4067 multiplexers, key matrices, ADS1115', bus: 'GPIO / I2C', status: 'planned', points: ['More inputs from fewer pins'] },
  // necks & adapters
  { group: 'neck', name: 'Guitar Hero 5 / Band Hero detachable neck', bus: 'I2C', status: 'planned', points: ['Frets and touch slider through the original connector'] },
  { group: 'neck', name: 'CRKD neck board', bus: 'UART', status: 'planned', points: ['Frets and solo frets'] },
  { group: 'neck', name: 'Crazy Guitar clone neck', bus: 'I2C', status: 'planned', points: ['5 frets + 5 solo frets'] },
  { group: 'neck', name: 'Wii guitars (USB adapter)', bus: 'Wii extension I2C', status: 'planned', points: ['Plug a Wii guitar in as-is'] },
  { group: 'neck', name: 'PS2 guitars (USB adapter)', bus: 'PS2 controller bus', status: 'planned', points: ['Plug a PS2 Guitar Hero guitar in as-is'] },
  // LEDs
  { group: 'led', name: 'WS2812B / NeoPixel', bus: '1 GPIO (PIO)', status: 'ok',
    points: ['5 LEDs, one per fret, any order (LED order wizard)', 'Colours, presets, 7 effects, brightness 0–255', 'Selectable colour order (GRB, RGB, …)'] },
  { group: 'led', name: 'SK6812 RGBW', bus: '1 GPIO (PIO)', status: 'exp', points: ['White channel used for the shared white part of each colour'] },
  { group: 'led', name: 'APA102 / DotStar', bus: 'Data + clock GPIO', status: 'exp', points: ['No timing issues on long wires'] },
  { group: 'led', name: 'Star power / overdrive lighting from games', bus: 'XInput rumble channel', status: 'exp',
    points: ['Idle frets pulse when the game says star power is active', 'For games that send Santroller-style commands, such as YARG'] },
  { group: 'led', name: 'Mode indicator', bus: 'Fret LEDs', status: 'ok', points: ['The fret that selects the running mode flashes for a second after plug-in'] },
  { group: 'led', name: 'STP16 constant-current drivers, single-colour LEDs, DMX', bus: 'SPI / GPIO', status: 'planned', points: [] },
  // usb host & wireless
  { group: 'usb', name: 'USB host port for console authentication', bus: '2 neighbouring GPIO (PIO USB)', status: 'exp',
    points: ['A USB-A socket wired to D+ / D−, 5 V and GND', 'Passes PS4 / PS5 and Xbox One / Series security checks to a licensed controller', 'Wireless instrument dongles are planned'] },
  { group: 'usb', name: 'Bluetooth LE output', bus: 'CYW43 (genuine Pico W / Pico 2 W)', status: 'ok',
    points: ['Each mode keeps its own identity and report layout over Bluetooth', 'Reconnects by itself after a power cycle', 'A USB host switches Bluetooth off; pairings are kept', 'Tested on Pico W with Windows'] },
  { group: 'usb', name: 'Wii Remote emulation', bus: 'CYW43 (Pico W) or USB dongle', status: 'planned', points: [] },
  // power
  { group: 'power', name: 'LiPo battery, fuel gauge and sleep', bus: 'I2C / ADC', status: 'planned', points: ['Only useful together with wireless output'] },
];

function badge(st) {
  const s = STATUS[st];
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function chips(groups, active, attr) {
  return `<div class="seg filters" role="group">${groups.map((g) => `<button class="${g.id === active ? 'on' : ''}" ${attr}="${g.id}" aria-pressed="${g.id === active}">${g.name}</button>`).join('')}</div>`;
}

export function renderCompat(root, filter = 'all') {
  const rows = COMPAT.filter((r) => filter === 'all' || r.group === filter);
  root.innerHTML = `${chips(COMPAT_GROUPS, filter, 'data-cg')}
    <div class="compat" role="table">
      <div class="compat-head" role="row"><span>Console and game</span><span>Mode</span><span>Connection</span><span>Status</span></div>
      ${rows.map((r) => `<div class="compat-row" role="row">
        <div><div class="console">${r.console}</div><h3>${r.game}</h3>${r.notes ? `<p class="notes">${r.notes}</p>` : ''}</div>
        <div><span class="lbl">Mode</span>${r.mode}</div>
        <div><span class="lbl">Connection</span>${r.how}</div>
        <div>${badge(r.status)}</div></div>`).join('')}</div>`;
  root.querySelectorAll('[data-cg]').forEach((b) => { b.onclick = () => renderCompat(root, b.dataset.cg); });
}

export function renderHardware(root, filter = 'all') {
  const items = HARDWARE.filter((h) => filter === 'all' || h.group === filter);
  root.innerHTML = `${chips(HW_GROUPS, filter, 'data-hg')}
    <div class="hw-grid">${items.map((h) => `<div class="hw">
      <div class="meta"><span>${h.bus}</span>${badge(h.status)}</div>
      <h3>${h.name}</h3>${h.tag ? `<span class="tag">${h.tag}</span>` : ''}
      ${h.points.length ? `<ul>${h.points.map((p) => `<li>${p}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`;
  root.querySelectorAll('[data-hg]').forEach((b) => { b.onclick = () => renderHardware(root, b.dataset.hg); });
}
