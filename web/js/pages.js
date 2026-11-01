import { t, localized } from './i18n.js?v=dev';
// Static content for the Hardware and Compatibility pages. Guitars only (drums and other instruments
// are out of scope for now). Status is honest: "Experimental" = implemented but not yet verified on
// that console / part, "Planned" = not implemented yet.

export const STATUS = localized(() => ({
  ok: { label: t('status.supported.label'), cls: 'ok' },
  plug: { label: t('status.plug_play.label'), cls: 'ok' },
  noauth: { label: t('status.no_auth_needed.label'), cls: 'ok' },
  legacy: { label: t('status.legacy_mode.label'), cls: 'ok' },
  setup: { label: t('status.setup_required.label'), cls: 'warn' },
  exp: { label: t('status.experimental.label'), cls: 'warn' },
  planned: { label: t('status.planned.label'), cls: 'plan' },
  no: { label: t('status.not_supported.label'), cls: 'no' },
}));

export const COMPAT = localized(() => ([
  { group: 'pc', console: t('compat.any_console_whatever_plugged.console'), game: t('compat.any_console_whatever_plugged.game'), mode: t('compat.any_console_whatever_plugged.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'plug',
    notes: t('compat.any_console_whatever_plugged.notes') },
  { group: 'pc', console: t('compat.pc_windows_clone_hero.console'), game: t('compat.pc_windows_clone_hero.game'),
    mode: t('compat.pc_windows_clone_hero.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'plug',
    notes: t('compat.pc_windows_clone_hero.notes') },
  { group: 'pc', console: 'macOS / Linux', game: t('compat.macos_linux_clone_hero.game'),
    mode: t('compat.macos_linux_clone_hero.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'plug',
    notes: t('compat.macos_linux_clone_hero.notes') },
  { group: 'xbox', console: 'Xbox 360', game: t('compat.xbox_360_guitar_hero.game'),
    mode: t('compat.xbox_360_guitar_hero.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'exp',
    notes: t('compat.xbox_360_guitar_hero.notes') },
  { group: 'xbox', console: 'Xbox One / Series X|S', game: t('compat.xbox_one_fortnite_festival.game'),
    mode: t('compat.xbox_one_fortnite_festival.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'noauth',
    notes: t('compat.xbox_one_fortnite_festival.notes') },
  { group: 'xbox', console: 'Xbox One / Series X|S', game: t('compat.xbox_one_rock_band.game'),
    mode: t('compat.xbox_one_rock_band.mode'), how: t('compat.xbox_one_rock_band.how'), status: 'exp',
    notes: t('compat.xbox_one_rock_band.notes') },
  { group: 'xbox', console: 'Original Xbox', game: t('compat.original_xbox_all_original.game'),
    mode: 'Original Xbox (XID)', how: t('compat.original_xbox_all_original.how'), status: 'exp', notes: t('compat.original_xbox_all_original.notes') },
  { group: 'ps', console: 'PlayStation 3', game: t('compat.playstation_3_rock_band.game'), mode: 'PS3 Rock Band', how: t('compat.any_console_whatever_plugged.how'), status: 'plug', notes: t('compat.playstation_3_rock_band.notes') },
  { group: 'ps', console: 'PlayStation 3', game: t('compat.playstation_3_guitar_hero.game'), mode: 'PS3 Guitar Hero', how: t('compat.any_console_whatever_plugged.how'), status: 'plug', notes: t('compat.playstation_3_guitar_hero.notes') },
  { group: 'ps', console: 'PlayStation 2', game: t('compat.playstation_2_rock_band.game'), mode: t('compat.playstation_2_rock_band.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'ok', notes: t('compat.playstation_2_rock_band.notes') },
  { group: 'ps', console: 'PlayStation 2', game: t('compat.playstation_2_guitar_hero.game'), mode: t('compat.playstation_2_guitar_hero.mode'), how: t('compat.playstation_2_guitar_hero.how'), status: 'exp',
    notes: t('compat.playstation_2_guitar_hero.notes') },
  { group: 'ps', console: t('compat.playstation_2_guitar_hero_2.console'), game: t('compat.playstation_2_guitar_hero_2.game'), mode: 'PS3 Guitar Hero + PADEMU', how: t('compat.playstation_2_guitar_hero_2.how'), status: 'setup',
    notes: t('compat.playstation_2_guitar_hero_2.notes') },
  { group: 'ps', console: 'PlayStation 4 / 5', game: 'Rock Band 4', mode: 'PS3 Rock Band', how: t('compat.any_console_whatever_plugged.how'), status: 'legacy', notes: t('compat.playstation_4_rock_band.notes') },
  { group: 'ps', console: 'PlayStation 4 / 5', game: t('compat.xbox_one_fortnite_festival.game'), mode: t('compat.xbox_one_fortnite_festival.mode'), how: t('compat.any_console_whatever_plugged.how'), status: 'noauth', notes: t('compat.playstation_4_fortnite_festival.notes') },
  { group: 'ps', console: 'PlayStation 4 / 5', game: t('compat.playstation_4_rock_band_2.game'), mode: t('compat.playstation_4_rock_band_2.mode'), how: t('compat.playstation_4_rock_band_2.how'), status: 'exp',
    notes: t('compat.playstation_4_rock_band_2.notes') },
  { group: 'ps', console: 'PlayStation 5', game: t('compat.playstation_5_ps5_games.game'), mode: t('compat.playstation_5_ps5_games.mode'), how: t('compat.playstation_5_ps5_games.how'), status: 'exp',
    notes: t('compat.playstation_5_ps5_games.notes') },
  { group: 'ps', console: t('compat.playstation_4_rock_band_3.console'), game: t('compat.playstation_4_rock_band_3.game'), mode: t('compat.playstation_4_rock_band_2.mode'), how: t('compat.playstation_4_rock_band_3.how'), status: 'setup',
    notes: t('compat.playstation_4_rock_band_3.notes') },
  { group: 'nin', console: 'Wii / Wii U', game: t('compat.wii_wii_rock_band.game'), mode: 'Wii Rock Band', how: t('compat.any_console_whatever_plugged.how'), status: 'plug', notes: t('compat.wii_wii_rock_band.notes') },
  { group: 'nin', console: 'Wii / Wii U', game: 'Guitar Hero, Band Hero', mode: t('compat.wii_wii_guitar_hero.mode'), how: t('compat.wii_wii_guitar_hero.how'), status: 'exp',
    notes: t('compat.wii_wii_guitar_hero.notes') },
  { group: 'nin', console: 'Wii / Wii U', game: t('compat.wii_wii_guitar_hero_2.game'), mode: t('compat.wii_wii_guitar_hero_2.mode'), how: t('compat.wii_wii_guitar_hero_2.how'), status: 'exp',
    notes: t('compat.wii_wii_guitar_hero_2.notes') },
  { group: 'nin', console: 'Nintendo Switch', game: t('compat.nintendo_switch_fortnite_festival.game'), mode: 'Nintendo Switch (HORIPAD)', how: t('compat.any_console_whatever_plugged.how'), status: 'plug', notes: t('compat.nintendo_switch_fortnite_festival.notes') },
]));

export const COMPAT_GROUPS = localized(() => ([
  { id: 'all', name: t('compat.group.all.name') }, { id: 'pc', name: t('compat.group.pc.name') }, { id: 'ps', name: 'PlayStation' },
  { id: 'xbox', name: 'Xbox' }, { id: 'nin', name: 'Nintendo' },
]));

export const HW_GROUPS = localized(() => ([
  { id: 'all', name: t('compat.group.all.name') }, { id: 'mcu', name: t('hardware.group.mcu.name') }, { id: 'input', name: t('hardware.group.input.name') },
  { id: 'neck', name: t('hardware.group.neck.name') }, { id: 'led', name: t('hardware.group.led.name') }, { id: 'usb', name: t('hardware.group.usb.name') },
  { id: 'power', name: t('hardware.group.power.name') },
]));

export const HARDWARE = localized(() => ([
  // microcontrollers
  { group: 'mcu', name: 'Raspberry Pi Pico (RP2040)', bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok', tag: t('hardware.raspberry_pi_pico_rp2040.tag'),
    points: [t('hardware.raspberry_pi_pico_rp2040.points.0'), t('hardware.raspberry_pi_pico_rp2040.points.1'), t('hardware.firmware_file', { file: 'yagcc-pico.uf2' })] },
  { group: 'mcu', name: 'Raspberry Pi Pico 2 (RP2350)', bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok',
    points: [t('hardware.raspberry_pi_pico_2.points.0'), t('hardware.firmware_file', { file: 'yagcc-pico2.uf2' })] },
  { group: 'mcu', name: 'Raspberry Pi Pico W / Pico 2 W', bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok',
    points: [t('hardware.raspberry_pi_pico_w.points.0'), t('hardware.raspberry_pi_pico_w.points.1'), t('hardware.raspberry_pi_pico_w.points.2')] },
  { group: 'mcu', name: t('hardware.pico_w_clones_with.name'), bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok',
    points: [t('hardware.pico_w_clones_with.points.0'), t('hardware.pico_w_clones_with.points.1'), t('hardware.pico_w_clones_with.points.2')] },
  { group: 'mcu', name: t('hardware.waveshare_rp2040_zero_rp2040.name'), bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok', tag: t('hardware.waveshare_rp2040_zero_rp2040.tag'),
    points: [t('hardware.waveshare_rp2040_zero_rp2040.points.0'), t('hardware.waveshare_rp2040_zero_rp2040.points.1')] },
  { group: 'mcu', name: t('hardware.sparkfun_pro_micro_rp2040.name'), bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'ok', tag: t('hardware.sparkfun_pro_micro_rp2040.tag'),
    points: [t('hardware.sparkfun_pro_micro_rp2040.points.0'), t('hardware.sparkfun_pro_micro_rp2040.points.1')] },
  { group: 'mcu', name: t('hardware.atmega32u4_atmega16u2_pro_micro.name'), bus: t('hardware.raspberry_pi_pico_rp2040.bus'), status: 'no',
    points: [t('hardware.atmega32u4_atmega16u2_pro_micro.points.0'), t('hardware.atmega32u4_atmega16u2_pro_micro.points.1')] },
  // inputs
  { group: 'input', name: t('hardware.mechanical_arcade_original_fret.name'), bus: t('hardware.mechanical_arcade_original_fret.bus'), status: 'ok',
    points: [t('hardware.mechanical_arcade_original_fret.points.0'), t('hardware.mechanical_arcade_original_fret.points.1'), t('hardware.mechanical_arcade_original_fret.points.2')] },
  { group: 'input', name: t('hardware.whammy_potentiometer_or_hall.name'), bus: 'ADC (GP26–28)', status: 'ok',
    points: [t('hardware.whammy_potentiometer_or_hall.points.0'), t('hardware.whammy_potentiometer_or_hall.points.1'), t('hardware.whammy_potentiometer_or_hall.points.2')] },
  { group: 'input', name: t('hardware.tilt_switch_ball_or.name'), bus: t('hardware.mechanical_arcade_original_fret.bus'), status: 'ok',
    points: [t('hardware.tilt_switch_ball_or.points.0'), t('hardware.tilt_switch_ball_or.points.1')] },
  { group: 'input', name: t('hardware.analog_tilt_sensors.name'), bus: 'ADC (GP26–28)', status: 'ok',
    points: [t('hardware.analog_tilt_sensors.points.0'), t('hardware.analog_tilt_sensors.points.1')] },
  { group: 'input', name: t('hardware.i2c_accelerometers_lis3dh_sc7a20.name'), bus: 'I2C', status: 'ok',
    points: [t('hardware.i2c_accelerometers_lis3dh_sc7a20.points.0'), t('hardware.i2c_accelerometers_lis3dh_sc7a20.points.1'), t('hardware.i2c_accelerometers_lis3dh_sc7a20.points.2'), t('hardware.i2c_accelerometers_lis3dh_sc7a20.points.3'), t('hardware.i2c_accelerometers_lis3dh_sc7a20.points.4')] },
  { group: 'input', name: t('hardware.mpr121_capacitive_touch_world.name'), bus: 'I2C', status: 'planned', points: [t('hardware.mpr121_capacitive_touch_world.points.0')] },
  { group: 'input', name: t('hardware.cd4051_cd4067_multiplexers_key.name'), bus: 'GPIO / I2C', status: 'planned', points: [t('hardware.cd4051_cd4067_multiplexers_key.points.0')] },
  // necks & adapters
  { group: 'neck', name: t('hardware.guitar_hero_5_band.name'), bus: 'I2C', status: 'planned', points: [t('hardware.guitar_hero_5_band.points.0')] },
  { group: 'neck', name: t('hardware.crkd_neck_board.name'), bus: t('hardware.crkd_neck_board.bus'), status: 'planned', points: [t('hardware.crkd_neck_board.points.0')] },
  { group: 'neck', name: t('hardware.crazy_guitar_clone_neck.name'), bus: 'I2C', status: 'planned', points: [t('hardware.crazy_guitar_clone_neck.points.0')] },
  { group: 'neck', name: t('hardware.wii_guitars_usb_adapter.name'), bus: t('hardware.wii_guitars_usb_adapter.bus'), status: 'planned', points: [t('hardware.wii_guitars_usb_adapter.points.0')] },
  { group: 'neck', name: t('hardware.ps2_guitars_usb_adapter.name'), bus: t('hardware.ps2_guitars_usb_adapter.bus'), status: 'planned', points: [t('hardware.ps2_guitars_usb_adapter.points.0')] },
  // LEDs
  { group: 'led', name: t('common.strum_bar_leds'), bus: t('hardware.strum_bar_leds.bus'), status: 'ok',
    points: [t('hardware.strum_bar_leds.points.0'), t('hardware.strum_bar_leds.points.1'), t('hardware.strum_bar_leds.points.2')] },
  { group: 'led', name: 'WS2812B / NeoPixel', bus: '1 GPIO (PIO)', status: 'ok',
    points: [t('hardware.ws2812b_neopixel.points.0'), t('hardware.ws2812b_neopixel.points.1'), t('hardware.ws2812b_neopixel.points.2')] },
  { group: 'led', name: 'SK6812 RGBW', bus: '1 GPIO (PIO)', status: 'exp', points: [t('hardware.sk6812_rgbw.points.0')] },
  { group: 'led', name: 'APA102 / SK9822 / DotStar', bus: t('hardware.apa102_sk9822_dotstar.bus'), status: 'exp', points: [t('hardware.apa102_sk9822_dotstar.points.0'), t('hardware.apa102_sk9822_dotstar.points.1'), t('hardware.apa102_sk9822_dotstar.points.2')] },
  { group: 'led', name: t('hardware.star_power_overdrive_lighting.name'), bus: t('hardware.star_power_overdrive_lighting.bus'), status: 'exp',
    points: [t('hardware.star_power_overdrive_lighting.points.0'), t('hardware.star_power_overdrive_lighting.points.1')] },
  { group: 'led', name: t('hardware.mode_indicator.name'), bus: t('common.fret_leds'), status: 'ok', points: [t('hardware.mode_indicator.points.0')] },
  { group: 'led', name: t('hardware.stp16_constant_current_drivers.name'), bus: t('hardware.stp16_constant_current_drivers.bus'), status: 'planned', points: [] },
  // usb host & wireless
  { group: 'usb', name: t('hardware.usb_host_port_console.name'), bus: t('hardware.usb_host_port_console.bus'), status: 'exp',
    points: [t('hardware.usb_host_port_console.points.0'), t('hardware.usb_host_port_console.points.1'), t('hardware.usb_host_port_console.points.2')] },
  { group: 'usb', name: t('hardware.bluetooth_le_output.name'), bus: t('hardware.bluetooth_le_output.bus'), status: 'ok',
    points: [t('hardware.bluetooth_le_output.points.0'), t('hardware.bluetooth_le_output.points.1'), t('hardware.bluetooth_le_output.points.2'), t('hardware.bluetooth_le_output.points.3')] },
  { group: 'usb', name: t('compat.wii_wii_guitar_hero.mode'), bus: t('hardware.wii_remote_emulation.bus'), status: 'planned', points: [] },
  // power
  { group: 'power', name: t('hardware.lipo_battery_fuel_gauge.name'), bus: 'I2C / ADC', status: 'planned', points: [t('hardware.lipo_battery_fuel_gauge.points.0')] },
]));

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
      <div class="compat-head" role="row">${t('pages.console_game_mode_connection_status')}</div>
      ${rows.map((r) => `<div class="compat-row" role="row">
        <div><div class="console">${r.console}</div><h3>${r.game}</h3>${r.notes ? `<p class="notes">${r.notes}</p>` : ''}</div>
        <div>${t('pages.mode', { mode: r.mode })}</div>
        <div>${t('pages.connection', { how: r.how })}</div>
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
