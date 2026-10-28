// YAGCC firmware: guitar controller with three USB personalities (XInput, PS3 GH, HID)
// and a WebUSB configuration channel used by the YAGCC web app.
#include <string.h>
#include "pico/stdlib.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"
#include "hardware/structs/watchdog.h"
#include "hardware/clocks.h"
#include "tusb.h"
#include "device/dcd.h"
#include "hardware/structs/usb.h"

#include "usb_common.h"
#include "config.h"
#include "ext_config.h"
#include "padmap.h"
#include "reports.h"
#include "input.h"
#include "bt.h"
#include "rgb.h"
#include "accel.h"
#include "rumble.h"
#include "ps2_out.h"
#include "wii_out.h"
#include "auto_detect.h"
#include "host/ps5_auth.h"
#include "host/usb_host.h"
#include "host/xbone.h"

// ---------------------------------------------------------------- state shared with USB callbacks
static yacc_config_t cfg_rx;
static uint16_t cfg_rx_len;
static uint8_t tx_buf[96];            // status report v2 is 96 bytes
static ext_config_t ext_rx;
static gpad_t g_gpad;                 // the generic pad the running mode packed last (status report)
static uint8_t g_gpad_row = 0xFF;     // its map row, 0xFF = none
static int16_t g_stick[2];
static uint8_t g_ext_flags;
static volatile bool save_pending;
static volatile bool save_ok = true;
static volatile int reboot_mode = -1;     // -1 none, 0 normal, 1 BOOTSEL
static volatile uint64_t reboot_at;
static volatile bool setup_reboot;

// Asked over HID (PS3 mode has no WebUSB interface): restart once in setup mode (XInput + web config)
#define SETUP_MAGIC 0x59414743u   // "YAGC"
#define MODESWITCH_MAGIC 0x594D4F44u   // "YMOD": rebooted by a Bluetooth mode change, skip the plug-in shortcuts
#define AUTO_MAGIC 0x59415554u         // "YAUT": Auto mode found the host; scratch[1] = mode | host << 8
void usb_request_setup_reboot(void) {
    setup_reboot = true;
    reboot_at = time_us_64() + 150000;
}

#define STATUS_V1_LEN (4 + 2 * NUM_ADC_CH + NUM_DIGITAL_PINS + 1 + 1 + 12 + 1 + 1 + 6)
#define STATUS_LEN 96
_Static_assert(STATUS_V1_LEN == 55, "status v1 bytes 0..54 are fixed; v2 appends at 55");
_Static_assert(STATUS_LEN <= sizeof(tx_buf), "status report must fit tx_buf");

static uint16_t build_status(void) {
    uint8_t *p = tx_buf;
    uint32_t m = input_gpio_mask();
    memcpy(p, &m, 4); p += 4;
    for (int c = 0; c < NUM_ADC_CH; c++) {
        uint16_t v = input_adc(c);
        memcpy(p, &v, 2); p += 2;
    }
    memcpy(p, input_press_counts(), NUM_DIGITAL_PINS); p += NUM_DIGITAL_PINS;
    *p++ = (bt_state() & 0x03) | (save_ok ? 0x04 : 0) | (save_pending ? 0x08 : 0);
    // firmware 0.29+: accelerometer found (ACCEL_*) and its readings (12-bit like the analog inputs), for calibration
    *p++ = accel_type();
    for (int i = 0; i < 6; i++) {    // X, Y, Z, then the LIS3DH aux ADC inputs 1..3 (0xFFFF = none)
        int32_t r = i < 3 ? accel_raw12(i) : accel_adc12(i - 3);
        uint16_t v = r < 0 ? 0xFFFF : (uint16_t)r;
        memcpy(p, &v, 2); p += 2;
    }
    // Status layout (bytes): 0..3 GPIO mask, then 2 per ADC channel, NUM_DIGITAL_PINS press counts, flags, accel type,
    // 6 x 16 bit accel / aux ADC readings, ports byte (below), then [0.36+] accel 2 type, 3 x 16 bit accel 2 X/Y/Z.
    // 55 bytes with the current pin counts; tx_buf is 64 and the host asks for 64.
    // firmware 0.31+: 1 = a PS2 is polling the controller port, 2 = a Wii Remote reads the extension port,
    // 4 = a Wii is connected to the Wii Remote emulation
    *p++ = (ps2_out_active() ? 1 : 0) | (wii_out_active() ? 2 : 0) | (bt_wiimote() && bt_state() == BT_STATE_CONNECTED ? 4 : 0);
    // firmware 0.36+: the second accelerometer's type (ACCEL_*) and its X, Y, Z (12-bit, 0xFFFF = none)
    *p++ = accel_type_n(1);
    for (int i = 0; i < 3; i++) {
        int32_t r = accel_raw12_n(1, i);
        uint16_t v = r < 0 ? 0xFFFF : (uint16_t)r;
        memcpy(p, &v, 2); p += 2;
    }
    // firmware 0.42 (status v2, bytes 55..95; the configurator asks for 96 when minor >= 42)
    *p++ = g_gpad_row;                                            // 55 map row of the running mode, 0xFF none
    uint32_t btn = g_gpad.btn;
    memcpy(p, &btn, 4); p += 4;                                   // 56 generic buttons, bit n-1 = output n
    const int16_t ax[6] = {g_gpad.lx, g_gpad.ly, g_gpad.rx, g_gpad.ry, g_gpad.lt, g_gpad.rt};
    memcpy(p, ax, sizeof(ax)); p += sizeof(ax);                   // 60 LX LY RX RY LT RT
    memcpy(p, g_stick, 4); p += 4;                                // 72 stick X, Y
    *p++ = g_ext_flags;                                           // 76 bit0 stick fitted, bit1 D-pad wired
    memset(p, 0, (size_t)(tx_buf + STATUS_LEN - p)); p = tx_buf + STATUS_LEN;   // 77..95 reserved
    return (uint16_t)(p - tx_buf);
}

static bool g_setup_session;
static bool g_xinput_fallback;    // XInput mode, but this host has no XInput driver (macOS): running as the HID gamepad
static uint8_t g_auto_host;       // HOST_* Auto mode found (this boot runs the mode picked for it), 0 = not from Auto
static bool g_bt_pair_at_boot;
static bool g_bt_mode_switched;   // this boot follows a Star + fret mode change over Bluetooth   // Star power held at power-on: pair a new Bluetooth host   // this boot is a one-off setup session (XInput + web config), not the saved mode

static uint16_t build_info(void) {
    uint8_t *p = tx_buf;
    memcpy(p, "YACC", 4); p += 4;   // wire-protocol magic (unchanged by the YAGCC rename)
    *p++ = YACC_VERSION_MAJOR;
    *p++ = YACC_VERSION_MINOR;
    *p++ = YACC_BOARD_ID;
    *p++ = (bt_supported() ? 1 : 0) | 2;   // capability bits: 1 = bluetooth, 2 = RGB
    *p++ = NUM_DIGITAL_PINS;
    *p++ = NUM_ADC_CH;
    *p++ = NUM_FUNCS;
    *p++ = g_usb_mode;                  // mode this boot is running in
    *p++ = (g_setup_session ? 1 : 0) | (g_xinput_fallback ? 2 : 0) | (g_auto_host ? 4 : 0);   // flags: 1 = setup session, 2 = XInput running as HID (host has no XInput driver), 4 = picked by Auto mode
    *p++ = g_auto_host;                 // firmware 0.30+: the host Auto mode found (HOST_*)
    return (uint16_t)(p - tx_buf);
}

static bool reply(uint8_t rhport, tusb_control_request_t const *req, const void *data, uint16_t len) {
    if (len > req->wLength) len = req->wLength;
    return tud_control_xfer(rhport, req, (void *)data, len);
}

bool usb_vendor_request(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req) {
    if (req->bmRequestType_bit.type != TUSB_REQ_TYPE_VENDOR) return false;

    // ext config page received: validate while the control transfer can still be stalled, then apply live
    if (stage == CONTROL_STAGE_DATA) {
        if (req->bRequest == VREQ_SETEXT) {
            if (!ext_validate(&ext_rx, &g_cfg)) return false;
            g_ext = ext_rx;
        }
        return true;
    }
    // OUT data stage finished: apply what we received
    if (stage == CONTROL_STAGE_ACK) {
        if (req->bRequest == VREQ_SETCFG && cfg_rx_len < sizeof(yacc_config_t)) {
            // an older configurator sends an older layout: keep this guitar's settings it doesn't know about
            yacc_config_t up;
            if (config_from_old((const uint8_t *)&cfg_rx, cfg_rx_len, &up)) {
                memcpy((uint8_t *)&up + cfg_rx_len - 4, (const uint8_t *)&g_cfg + cfg_rx_len - 4,
                       sizeof(up) - cfg_rx_len);   // every field past its layout, up to the crc
                // an older configurator that changed the effect or speed still gets what it asked for
                if (up.rgb_effect != g_cfg.rgb_effect || up.rgb_speed != g_cfg.rgb_speed) led_zones_from_efx(&up);
                config_seal(&up);
                cfg_rx = up;
            }
        }
        if (req->bRequest == VREQ_SETCFG && config_validate(&cfg_rx)) {
            g_cfg = cfg_rx;
            // an older configurator leaves the host port byte at zero: keep the port off
            if (g_cfg.cfg_rev < 4) { g_cfg.host_dp_pin = PIN_NONE; g_cfg.cfg_rev = 4; }
        }
        return true;
    }
    if (stage != CONTROL_STAGE_SETUP) return true;

    if (req->bRequest >= VREQ_INFO && req->bRequest <= 0x3F) g_config_seen = true;   // the configurator, not just Chrome reading the WebUSB URL
    switch (req->bRequest) {
        case VREQ_WEBUSB:
            if (req->wIndex == 2) {
                uint16_t n;
                const uint8_t *d = yacc_webusb_url_desc(&n);
                return reply(rhport, req, d, n);
            }
            return false;
        case VREQ_MS_OS:
            g_host_windows = true;                    // only Windows reads the MS OS 2.0 descriptor set
            if (g_usb_mode == MODE_AUTO) auto_mark_ms_os();
            if (req->wIndex == 7) {
                uint16_t n;
                const uint8_t *d = yacc_ms_os_desc(&n);
                return reply(rhport, req, d, n);
            }
            return false;
        case VREQ_INFO:
            return reply(rhport, req, tx_buf, build_info());
        case VREQ_STATUS:
            return reply(rhport, req, tx_buf, build_status());
        case VREQ_GETCFG:
            config_seal(&g_cfg);
            return reply(rhport, req, &g_cfg, sizeof(g_cfg));
        case VREQ_SETCFG:
            if (req->wLength != sizeof(cfg_rx) && req->wLength != YACC_CFG_V6_SIZE && req->wLength != YACC_CFG_V5_SIZE &&
                req->wLength != YACC_CFG_V4_SIZE) return false;
            cfg_rx_len = req->wLength;
            memset(&cfg_rx, 0, sizeof(cfg_rx));
            return tud_control_xfer(rhport, req, &cfg_rx, cfg_rx_len);
        case VREQ_GETEXT:
            ext_seal(&g_ext);
            return reply(rhport, req, &g_ext, sizeof(g_ext));
        case VREQ_SETEXT:
            if (req->wLength != sizeof(ext_rx)) return false;
            return tud_control_xfer(rhport, req, &ext_rx, sizeof(ext_rx));
        case VREQ_SAVE:
            save_pending = true;
            return tud_control_status(rhport, req);
        case VREQ_DEFAULTS:
            config_defaults(&g_cfg);
            ext_defaults(&g_ext);
            return tud_control_status(rhport, req);
        case VREQ_SETMODE:
            if (req->wValue < NUM_MODES) g_cfg.usb_mode = (uint8_t)req->wValue;
            return tud_control_status(rhport, req);
        case VREQ_RUMBLE:
            rumble_test(req->wValue);
            return tud_control_status(rhport, req);
        case VREQ_LEDTEST:
            rgb_test_led(req->wValue < MAX_LEDS ? (int)req->wValue : -1);
            return tud_control_status(rhport, req);
        case VREQ_LEDPREVIEW:
            rgb_preview(req->wValue, req->wIndex != 0);
            return tud_control_status(rhport, req);
        case VREQ_BTLOGFL: {
            uint16_t n;
            const uint8_t *p = bt_log_flash(&n);
            if (!n) return false;                         // normal builds: stall
            if (req->bmRequestType_bit.direction == TUSB_DIR_OUT) { bt_log_flash_clear(); return tud_control_status(rhport, req); }
            return reply(rhport, req, p, n);
        }
        case VREQ_BTLOG: {
            static uint8_t logbuf[48 * 8];
            return reply(rhport, req, logbuf, bt_log_read(logbuf, sizeof(logbuf)));
        }
        case VREQ_REBOOT:
            reboot_mode = req->wValue ? 1 : 0;
            reboot_at = time_us_64() + 150000;
            return tud_control_status(rhport, req);
        default:
            return false;
    }
}

// ---------------------------------------------------------------- controller state
typedef struct {
    bool green, red, yellow, blue, orange;
    bool strum_up, strum_down;
    bool star, plus;
    bool tilt;          // tilt switch alone (also folded into `star` for most modes)
    int16_t whammy;     // 0..32767
} pad_t;

// ---------------------------------------------------------------- USB suspend / remote wakeup
// The host suspends the bus when it sleeps. A press on a fret / strum / star / plus then wakes it up (Santroller
// does the same). Only a press while suspended acts, so nothing is sent while the host is awake. Reports,
// LEDs and Bluetooth are untouched: the main loop keeps running, the endpoints are just not ready.
static volatile bool g_usb_suspended;
void tud_suspend_cb(bool remote_wakeup_en) { (void)remote_wakeup_en; g_usb_suspended = true; }
void tud_resume_cb(void) { g_usb_suspended = false; }

// Buttons that wake the host, as a bitmask (the whammy bar and tilt swing don't: they would wake it by accident)
static uint8_t wake_buttons(const pad_t *s) {
    return (uint8_t)((s->green ? 1 : 0) | (s->red ? 2 : 0) | (s->yellow ? 4 : 0) | (s->blue ? 8 : 0) |
                     (s->orange ? 16 : 0) | (s->strum_up ? 32 : 0) | (s->strum_down ? 64 : 0) |
                     (s->star ? 128 : 0));
}

// A new press since the last call (a held button does not repeat)
static bool wake_pressed(uint8_t now, uint8_t *prev, bool plus, bool *prev_plus) {
    bool pressed = (now & (uint8_t)~*prev) != 0 || (plus && !*prev_plus);
    *prev = now; *prev_plus = plus;
    return pressed;
}

static void wake_task(const pad_t *s) {
    static uint8_t prev; static bool prev_plus;
    bool pressed = wake_pressed(wake_buttons(s), &prev, s->plus, &prev_plus);
    // The Xbox 360 suspends the bus without ever sending SET_FEATURE(DEVICE_REMOTE_WAKEUP) and without TinyUSB
    // reporting the suspend (the bus is idle before the first configuration), but still powers on when a wired pad
    // signals resume (Santroller xinput_device.cpp / usb_descriptors.cpp). So for a wired XInput pad that is not on
    // Windows, read the SIE and resume regardless of the host's setting. Only once the host has configured us.
    static bool configured;
    if (tud_mounted()) configured = true;
    bool is360 = g_usb_mode == MODE_XINPUT && !g_xinput_wireless && !g_host_windows;
    bool sie = configured && is360 && (usb_hw->sie_status & USB_SIE_STATUS_SUSPENDED_BITS);
    static uint64_t last_try;
    uint64_t t = time_us_64();
    if (!pressed || !(g_usb_suspended || sie) || t - last_try < 50000) return;
    last_try = t;
    if (configured && is360) dcd_remote_wakeup(0);      // regardless of the host's setting
    else tud_remote_wakeup();      // fails harmlessly when the host didn't enable remote wakeup before suspending
}

// Everything the mapping layer reads, straight from the physical inputs (not the remapped outputs)
static void read_sources(padsrc_t *r) {
    memset(r, 0, sizeof(*r));
    for (int f = 0; f < NUM_FUNCS; f++) if (input_func_phys(f)) r->dig |= 1u << f;
    if (input_tilt_switch()) r->dig |= 1u << SRC_TILT_SW;
    for (int k = 0; k < 6; k++) if (input_ext(k)) r->dig |= 1u << (SRC_DPAD_UP + k);
    if (input_ext(6)) r->dig |= 1u << SRC_STICK_CLICK;
    r->whammy = input_whammy();
    for (int i = 0; i < NUM_ATILT; i++) {
        int32_t v = input_atilt(i);
        r->sens[i] = (int16_t)(v < 0 ? 0 : v);
        r->sens_whammy[i] = (int16_t)input_tilt_whammy(i);
        r->sens_thr[i] = g_cfg.atilt[i].threshold;
    }
    bool st = input_stick(&r->stick[0], &r->stick[1]);
    for (int i = 0; i < 1 + NUM_ATILT; i++) r->tilt_fn[i] = (int8_t)input_tilt_fn(i);
    g_stick[0] = r->stick[0]; g_stick[1] = r->stick[1];
    g_ext_flags = (uint8_t)((st ? 1 : 0) | ((g_ext.pin_ext[0] != PIN_NONE || g_ext.pin_ext[1] != PIN_NONE ||
                                             g_ext.pin_ext[2] != PIN_NONE || g_ext.pin_ext[3] != PIN_NONE) ? 2 : 0));
}

static const uint8_t *map_row(uint8_t mode) {
    return (mode < EXT_MAP_ROWS && mode != MODE_KEYBOARD && mode != MODE_AUTO) ? g_ext.map[mode] : NULL;   // keyboard / Auto: no map
}

static void read_pad(pad_t *s) {
    s->green  = input_func(F_GREEN);
    s->red    = input_func(F_RED);
    s->yellow = input_func(F_YELLOW);
    s->blue   = input_func(F_BLUE);
    s->orange = input_func(F_ORANGE);
    s->strum_up   = input_func(F_STRUM_UP);
    s->strum_down = input_func(F_STRUM_DOWN);
    s->plus = input_func(F_PLUS);
    s->star = input_func(F_STAR);
    s->tilt = input_tilt_star();     // tilt switch / sensors acting as star power (others press their own button in input_func)
    s->whammy = input_whammy();
    // analog tilt sensors / accelerometer axes set to whammy: the larger wins, so the bar and a tilt-whammy can be used together
    for (int i = 0; i < NUM_ATILT; i++) {
        int32_t v = input_atilt(i);
        if (v < 0 || g_cfg.atilt[i].target != ATILT_WHAMMY) continue;
        if (v < (32767 * (int32_t)g_cfg.whammy_deadzone) / 100) v = 0;
        if (v > s->whammy) s->whammy = (int16_t)v;
    }
    if (s->tilt) s->star = true;
    rgb_set_whammy((uint16_t)s->whammy);
    rgb_set_player_star(s->star);
}

// ---------------------------------------------------------------- game feedback (rumble channel)
// Santroller's convention, which YARG uses: right motor byte = command, left = parameter.
static volatile bool g_star_power_active;
static volatile uint8_t g_star_power_fill;
void usb_game_feedback(uint8_t command, uint8_t param) {
    switch (command) {
        case 0x09:                                             // star power / overdrive active
            if (param && !g_star_power_active) rumble_event(RUMBLE_EV_STAR);
            g_star_power_active = param != 0;
            break;
        case 0x0C: rumble_event(RUMBLE_EV_MISS); break;        // a missed note
        case 0x08: g_star_power_fill = param; break;          // star power meter
        case 0xFF: g_star_power_active = false; break;        // all off
        default: break;
    }
    rgb_set_star_power(g_star_power_active);
}


// ---- USB keyboard, 8 byte boot report (Fortnite Festival keyboard bindings by default)
static uint16_t build_keyboard(const pad_t *s, uint8_t *out) {
    memset(out, 0, KEYBOARD_REPORT_LEN);
    const bool on[NUM_KEYS] = {s->green, s->red, s->yellow, s->blue, s->orange, s->strum_up, s->strum_down,
                               s->star && !s->tilt, s->plus, s->tilt, s->whammy > 16384};
    int n = 0;
    for (int k = 0; k < NUM_KEYS; k++) {
        uint8_t code = g_cfg.keys[k];
        if (!on[k] || code == 0) continue;
        if (code >= 0xE0 && code <= 0xE7) { out[0] |= (uint8_t)(1u << (code - 0xE0)); continue; }
        bool dup = false;
        for (int i = 0; i < n; i++) if (out[2 + i] == code) dup = true;
        if (!dup && n < 6) out[2 + n++] = code;
    }
    return KEYBOARD_REPORT_LEN;
}

// ---- PS2 Guitar Hero guitar on the controller port (Santroller's PS2GuitarHeroGuitar_Data_t, active high;
// the PSX layer puts it on the wire). The frets are the shoulder / face buttons like a real GH guitar, strum on
// the D-pad (with the guitar's D-pad left identifier held), whammy on the left stick, star power on select.
static void build_ps2(const pad_t *s, uint8_t *out) {
    static const uint8_t dpad[16] = {0x80, 0x23, 0xaa, 0x20, 0x58, 0x1c, 0x4b, 0x1a, 0xec, 0x23, 0xa1, 0x20, 0x55, 0x1b, 0x49, 0x1a};
    uint8_t b0 = 0x80;                                  // D-pad left: "this is a guitar"
    if (s->star)       b0 |= 0x01;                      // select
    if (s->plus)       b0 |= 0x08;                      // start
    if (s->strum_up)   b0 |= 0x10;
    if (s->strum_down) b0 |= 0x40;
    uint8_t b1 = 0;
    if (s->tilt)   b1 |= 0x01;                          // L2
    if (s->green)  b1 |= 0x02;                          // R2
    if (s->yellow) b1 |= 0x10;                          // triangle
    if (s->red)    b1 |= 0x20;                          // circle
    if (s->blue)   b1 |= 0x40;                          // cross
    if (s->orange) b1 |= 0x80;                          // square
    out[0] = b0;
    out[1] = b1;
    out[2] = dpad[(s->strum_up ? 1 : 0) | (s->strum_down ? 2 : 0)];   // the guitar's D-pad lives on the right stick
    out[3] = 0;
    out[4] = 0;                                         // touch slider
    out[5] = (uint8_t)(0x7F - (s->whammy >> 8));        // whammy, 0x7F = rest
}

// ---- Wii Guitar Hero guitar extension, data format 3 (Santroller's WiiGuitarDataFormat3_t). Buttons are
// active low; strum on the D-pad, star power on minus, whammy 5 bits with 0 at rest
static void build_wii_ext(const pad_t *s, uint8_t *out) {
    uint8_t lo = 0, hi = 0;
    if (s->plus)       lo |= 0x04;                      // plus
    if (s->star)       lo |= 0x10;                      // minus = star power
    if (s->strum_down) lo |= 0x40;
    if (s->strum_up)   hi |= 0x01;
    if (s->yellow)     hi |= 0x08;
    if (s->green)      hi |= 0x10;
    if (s->blue)       hi |= 0x20;
    if (s->red)        hi |= 0x40;
    if (s->orange)     hi |= 0x80;
    out[0] = 32;                                        // stick centred (6 bits)
    out[1] = 32;
    out[2] = 0x0F;                                      // touch bar: not touched
    out[3] = (uint8_t)(s->whammy >> 10);                // 0..31
    out[4] = (uint8_t)~lo;
    out[5] = (uint8_t)~hi;
}

_Static_assert(RPT_XINPUT_LEN == XINPUT_REPORT_LEN && RPT_PS3_LEN == PS3_REPORT_LEN && RPT_HID_LEN == HID_REPORT_LEN &&
               RPT_SWITCH_LEN == SWITCH_REPORT_LEN && RPT_OGXBOX_LEN == OGXBOX_REPORT_LEN && RPT_PS4_LEN == PS4_GUITAR_REPORT_LEN &&
               RPT_PS5_LEN == PS5_REPORT_LEN && RPT_XBONE_LEN == XBONE_GUITAR_PAYLOAD_LEN, "report lengths");

static bool needs_host(uint8_t mode) { return mode == MODE_PS4 || mode == MODE_PS5 || mode == MODE_XBONE; }

// Auto mode: the mode to run for the host it found
static uint8_t auto_mode_for(uint8_t host) {
    bool rb = g_cfg.xinput_type == XI_ROCK_BAND, port = g_cfg.host_dp_pin != PIN_NONE;
    switch (host) {
        case HOST_WINDOWS:
        case HOST_XBOX360: return MODE_XINPUT;
        case HOST_XBOXONE: return port ? MODE_XBONE : MODE_KEYBOARD;   // no auth controller: Fortnite Festival keys
        case HOST_PS4:     return port ? MODE_PS4 : MODE_PS3_RB;       // Rock Band 4 takes the PS3 Rock Band guitar
        case HOST_PS3:
        case HOST_PS2:     return rb ? MODE_PS3_RB : MODE_PS3_GH;
        case HOST_SWITCH:  return MODE_SWITCH;
        case HOST_WII:     return MODE_WII_RB;
        case HOST_OGXBOX:  return MODE_OGXBOX;
    }
    return MODE_NONE;
}

// ---------------------------------------------------------------- boot-time mode selection
static void settle_inputs(void) {
    // Pull-ups need a moment, then the detection debounce needs a few ms of stable readings.
    sleep_ms(10);
    uint32_t start = time_us_32();
    while ((uint32_t)(time_us_32() - start) < 20000) input_poll();
}

static bool boot_pressed(int f) {
    uint8_t p = g_cfg.pins[f];
    return p != PIN_NONE && input_pressed(p);
}

static uint8_t pick_mode(void) {
    // the configurator asked for setup mode from PS3 mode: honour it for this boot only
    if (watchdog_caused_reboot() && watchdog_hw->scratch[0] == SETUP_MAGIC) {
        watchdog_hw->scratch[0] = 0;
        g_setup_session = true;
        return MODE_XINPUT;
    }
    if (watchdog_caused_reboot() && watchdog_hw->scratch[0] == AUTO_MAGIC) {
        uint32_t v = watchdog_hw->scratch[1];
        watchdog_hw->scratch[0] = watchdog_hw->scratch[1] = 0;
        uint8_t m = (uint8_t)(v & 0xFF), h = (uint8_t)((v >> 8) & 0xFF);
        if (m < NUM_MODES && m != MODE_AUTO && h && h < NUM_HOSTS) { g_auto_host = h; return m; }
    }
    if (watchdog_caused_reboot() && watchdog_hw->scratch[0] == MODESWITCH_MAGIC) {
        watchdog_hw->scratch[0] = 0;          // frets may still be held from the shortcut: use the saved mode
        g_bt_mode_switched = true;
        return g_cfg.usb_mode < NUM_MODES ? g_cfg.usb_mode : MODE_XINPUT;
    }
    watchdog_hw->scratch[0] = 0;
    // star power + plus at plug-in -> straight to the UF2 bootloader
    if (boot_pressed(F_STAR) && boot_pressed(F_PLUS)) {
        reset_usb_boot(0, 0);
    }
    // star power alone -> Bluetooth pairing (forget the old host), like PS + Create on a PlayStation pad
    if (boot_pressed(F_STAR) && !boot_pressed(F_PLUS)) g_bt_pair_at_boot = true;
    // plus alone -> setup mode for this boot (XInput + web config), nothing is saved
    if (boot_pressed(F_PLUS)) { g_setup_session = true; return MODE_XINPUT; }

    uint8_t mode = g_cfg.usb_mode < NUM_MODES ? g_cfg.usb_mode : MODE_XINPUT;
    for (int i = 0; i < NUM_FRETS; i++) {
        uint8_t m = g_cfg.boot_modes[i];
        if (m != MODE_NONE && m < NUM_MODES && boot_pressed(i)) {
            mode = m;
            if (m != g_cfg.usb_mode) {      // remember it, like picking a mode on any other pad
                g_cfg.usb_mode = m;
                config_save_auto();
            }
            break;
        }
    }
    return mode;
}

int main(void) {
    // Pico-PIO-USB (the authentication host port) needs a system clock that is a multiple of 12 MHz
    set_sys_clock_khz(120000, true);
    config_load();
    input_init();
    settle_inputs();
    g_usb_mode = pick_mode();

    rgb_init();                       // first, so the LED state machine is claimed before the radio picks one
    // Bluetooth stays off in the modes that use the USB host port (both need PIO1 / DMA) and on boards without a radio
    bool bt_ok = bt_supported() && !(needs_host(g_usb_mode) && g_cfg.host_dp_pin != PIN_NONE);
    if (bt_ok && g_bt_pair_at_boot && !(g_cfg.flags & CFG_FLAG_BT_ENABLED)) {
        g_cfg.flags |= CFG_FLAG_BT_ENABLED;   // pairing turns Bluetooth on for good
        config_save_auto();
    }
    if (bt_ok) bt_init(g_cfg.flags & CFG_FLAG_BT_ENABLED, g_bt_pair_at_boot, g_bt_mode_switched);
    if (g_usb_mode == MODE_XBONE) xbone_init();
    // Windows found by Auto mode: XInput as a wireless receiver slot, which Steam handles (Santroller)
    g_xinput_wireless = g_usb_mode == MODE_XINPUT && g_auto_host == HOST_WINDOWS && (g_cfg.xinput_opts & XOPT_RECEIVER);
    tusb_init();
    if (needs_host(g_usb_mode) && g_cfg.host_dp_pin != PIN_NONE) usb_host_start(g_cfg.host_dp_pin);
    rgb_boot_indicator(g_usb_mode);
#ifdef PICO_VBUS_PIN
    gpio_init(PICO_VBUS_PIN); gpio_set_dir(PICO_VBUS_PIN, GPIO_IN);   // Pico / Pico 2: high while USB power is present
#endif
    uint64_t host_lost_at = 0;

    uint64_t last_sent = 0, hold_start = 0, switch_start = 0;
    int switch_fret = -1;
    bool hold_fired = false;
    uint8_t last_report[64] = {0};
    uint8_t ps4_counter = 0;
    bool ps4_first = true;
    uint16_t last_len = 0;
    bool dirty = true;

    // XInput on a host without an XInput driver (macOS has none): nothing reads the controller, so it would
    // never show up in games. If no driver has used it 10 s after the host configured it, and the host isn't
    // Windows (which reads the MS OS 2.0 descriptors, and may take a while to install the driver the first
    // time), re-enumerate as the HID gamepad, which every OS supports. Unplugging goes back to XInput, so the
    // next host gets XInput first. Not in a setup session.
    // Not when Auto mode already identified the host (Windows or an Xbox 360 are certain XInput hosts): Windows
    // reuses its cached driver and may not show any sign of it within the timeout, and falling back there left
    // the guitar as a plain gamepad.
    enum { XI_WATCH, XI_SWITCHING, XI_AS_HID, XI_RX_SWITCHING, XI_DONE } xi_state = (g_usb_mode == MODE_XINPUT && !g_setup_session && !g_auto_host) ? XI_WATCH : XI_DONE;
    uint64_t xi_t = 0, xi_mount_t = 0;
    bool xi_was_mounted = false;
    // a mode Auto picked lasts until the guitar is unplugged (matters for boards on a battery)
    bool auto_was_mounted = false;
    uint64_t auto_lost_at = 0;

    while (true) {
        tud_task();
        if (g_usb_mode == MODE_AUTO && !g_setup_session) {
            uint8_t host = auto_task(to_ms_since_boot(get_absolute_time()));
            uint8_t m = host ? auto_mode_for(host) : MODE_NONE;
            if (m != MODE_NONE) {
                tud_disconnect();
                sleep_ms(300);               // stay off the bus long enough for the host to see the device leave (hub status polling is ~256 ms)
                watchdog_hw->scratch[1] = (uint32_t)m | ((uint32_t)host << 8);
                watchdog_hw->scratch[0] = AUTO_MAGIC;
                watchdog_reboot(0, 0, 10);
                while (true) tight_loop_contents();
            }
        } else if (g_auto_host && g_usb_mode == MODE_PS4 && ps5_dongle_present()) {
            // Auto sent a PS4 / PS5 console here, and the auth controller is a P5General: this is a PS5
            tud_disconnect();
            sleep_ms(300);
            watchdog_hw->scratch[1] = (uint32_t)MODE_PS5 | ((uint32_t)g_auto_host << 8);
            watchdog_hw->scratch[0] = AUTO_MAGIC;
            watchdog_reboot(0, 0, 10);
            while (true) tight_loop_contents();
        } else if (g_auto_host) {
            uint64_t t = time_us_64();
            if (tud_mounted()) { auto_was_mounted = true; auto_lost_at = 0; }
            else if (auto_was_mounted) {
                if (!auto_lost_at) auto_lost_at = t;
                else if (t - auto_lost_at > 1500000) { watchdog_reboot(0, 0, 10); while (true) tight_loop_contents(); }   // back to Auto
            }
        }
        {
            uint64_t t = time_us_64();
            switch (xi_state) {
                case XI_WATCH:
                    if (tud_mounted()) { xi_was_mounted = true; if (!xi_mount_t) xi_mount_t = t ? t : 1; }
                    else xi_mount_t = 0;
                    if (!tud_mounted() && xi_was_mounted) {          // unplugged: forget what the last host was
                        xi_was_mounted = false;
                        g_xinput_driver_seen = g_host_windows = g_config_seen = false;
                        if (!g_auto_host) g_xinput_wireless = false;   // the next host may be a 360: wired again
                    }
                    // Windows (it read the Microsoft OS 2.0 descriptors): come back as a wireless receiver slot,
                    // which Steam's driver takes (a wired XInput pad sharing its device with the config interface
                    // makes it choke). A 360 never reads those descriptors, so it keeps the wired pad.
                    if (tud_mounted() && g_host_windows && !g_xinput_wireless && (g_cfg.xinput_opts & XOPT_RECEIVER) && xi_mount_t && t - xi_mount_t > 1500000) {   // after enumeration has finished, not in the middle of it
                        tud_disconnect();
                        g_xinput_wireless = true;
                        xi_state = XI_RX_SWITCHING; xi_t = t; xi_was_mounted = false;
                        break;
                    }
                    // (the configurator talking over WebUSB says nothing about whether games can see XInput: ignored)
                    if (!tud_mounted() || g_xinput_driver_seen || g_host_windows) { xi_t = 0; break; }
                    if (!xi_t) xi_t = t ? t : 1;
                    else if (t - xi_t > 10000000) {   // 10 s: Windows with a cached driver can be slow to show any sign of it
                        tud_disconnect();
                        g_usb_mode = MODE_HID;
                        g_xinput_fallback = true;
                        xi_state = XI_SWITCHING; xi_t = t; xi_was_mounted = false;
                    }
                    break;
                case XI_RX_SWITCHING:
                    if (t - xi_t > 300000) { tud_connect(); xi_state = XI_WATCH; xi_t = 0; }
                    break;
                case XI_SWITCHING:                      // long enough for the host to see the device leave
                    if (t - xi_t > 300000) { tud_connect(); xi_state = XI_AS_HID; xi_t = t; }
                    break;
                case XI_AS_HID:
                    if (tud_mounted()) { xi_was_mounted = true; xi_t = t; }
                    else if (xi_was_mounted && t - xi_t > 1000000) {   // unplugged: the next host gets XInput again
                        tud_disconnect();
                        g_usb_mode = MODE_XINPUT;
                        g_xinput_fallback = false;
                        g_xinput_driver_seen = g_host_windows = g_config_seen = false;
                        xi_state = XI_WATCH; xi_t = 0;
                        tud_connect();
                    }
                    break;
                default: break;
            }
        }
        if (needs_host(g_usb_mode)) usb_host_task();
        bt_task();
        input_poll();
        accel_task();
        if (!tud_mounted()) rumble_stop();
        rumble_task();
        uint64_t now = time_us_64();
        // USB power but no host talking to us for 3 s (a phone charger or power bank charging the battery through
        // the Pico's USB port): tell the LEDs to show the charging sweep. Back to normal the moment a host appears.
        {
            bool mounted = tud_mounted();
            if (mounted) host_lost_at = 0;
            else if (!host_lost_at) host_lost_at = now ? now : 1;
            bool vbus = true;
#ifdef PICO_VBUS_PIN
            vbus = gpio_get(PICO_VBUS_PIN);            // running from the battery alone: no sweep
#endif
            // Pico W / Pico 2 W: USB power is read through the radio chip. Each read is a transaction on the bus
            // Bluetooth also uses, so only every 50 ms (as Santroller does), not on every pass of the loop.
            static int vbus_cached = -1;
            static uint64_t vbus_at;
            if (vbus_cached < 0 || now - vbus_at > 50000) { vbus_cached = bt_vbus(); vbus_at = now; }
            if (vbus_cached >= 0) vbus = vbus_cached == 1;
            // A USB host (a PC or console enumerating the guitar, not just a charger) switches Bluetooth off:
            // the wireless host is dropped and the guitar stops advertising. Pairings stay saved; unplugging
            // brings Bluetooth back and the paired host reconnects.
            bt_set_usb_active(mounted);
            bool bt_host = bt_state() == BT_STATE_CONNECTED;   // a Bluetooth host counts too: no sweep
            rgb_set_charging(!mounted && !bt_host && vbus && host_lost_at && now - host_lost_at > 3000000);
        }
        rgb_task();

        if (setup_reboot && now >= reboot_at) {
            watchdog_hw->scratch[0] = SETUP_MAGIC;
            watchdog_reboot(0, 0, 10);
            while (true) tight_loop_contents();
        }
        if (reboot_mode >= 0 && now >= reboot_at) {
            if (reboot_mode == 1) reset_usb_boot(0, 0);
            else watchdog_reboot(0, 0, 10);
        }
        if (save_pending) {
            save_ok = config_save();
            save_pending = false;
        }

        // Hold star power + plus for 5 s -> Bluetooth pairing mode
        if (bt_ok && input_func(F_STAR) && input_func(F_PLUS)) {
            if (!hold_start) hold_start = now;
            else if (!hold_fired && now - hold_start >= 5000000) {
                hold_fired = true;
                if (!(g_cfg.flags & CFG_FLAG_BT_ENABLED)) { g_cfg.flags |= CFG_FLAG_BT_ENABLED; save_pending = true; }
                bt_start_pairing();
            }
        } else {
            hold_start = 0;
            hold_fired = false;
        }

        // Bluetooth: Star power + a fret for 3 s switches to the mode that fret selects at plug-in (the same
        // shortcuts as on the Modes tab). The guitar saves it and restarts itself straight into that mode.
        if (bt_ok && bt_running() && !tud_mounted() && input_func(F_STAR) && !input_func(F_PLUS)) {
            int held = -1;
            for (int f = 0; f < NUM_FRETS; f++) if (input_func(f)) { held = f; break; }
            uint8_t target = held >= 0 ? g_cfg.boot_modes[held] : MODE_NONE;
            bool usable = target < NUM_MODES && target != g_usb_mode && !(needs_host(target) && g_cfg.host_dp_pin != PIN_NONE);
            if (!usable) { switch_start = 0; switch_fret = -1; }
            else if (held != switch_fret) { switch_fret = held; switch_start = now; }
            else if (now - switch_start >= 3000000) {
                g_cfg.usb_mode = target;
                config_save();
                watchdog_hw->scratch[0] = MODESWITCH_MAGIC;
                watchdog_reboot(0, 0, 20);
                while (true) tight_loop_contents();
            }
        } else { switch_start = 0; switch_fret = -1; }

        pad_t st;
        read_pad(&st);
        padsrc_t src;
        gpad_t gp;                                          // what the running mode's map makes of the inputs
        read_sources(&src);
        padmap_build(&src, map_row(g_usb_mode), &gp);
        g_gpad = gp;
        g_gpad_row = map_row(g_usb_mode) ? g_usb_mode : 0xFF;
        wake_task(&st);
        uint8_t wii_ext[WII_EXT_REPORT_LEN];               // the Wii guitar extension: wired, or over Bluetooth
        build_wii_ext(&st, wii_ext);
        {   // PS2 controller port: answers only while a console polls it (needs PIO1, so not with the host port)
            uint8_t p2[PS2_REPORT_LEN];
            build_ps2(&st, p2);
            ps2_out_task(p2, !(needs_host(g_usb_mode) && g_cfg.host_dp_pin != PIN_NONE));
            wii_out_task(wii_ext);
        }
        if (bt_wiimote()) {
            static uint8_t last_ext[WII_EXT_REPORT_LEN];
            if (memcmp(last_ext, wii_ext, sizeof(last_ext)) != 0) { memcpy(last_ext, wii_ext, sizeof(last_ext)); bt_wii_report(wii_ext, sizeof(wii_ext)); }
        }
        // Bluetooth carries the same HID report as USB in this mode. XInput, OG Xbox and Xbox One aren't HID
        // over USB, so they use the generic gamepad. Bluetooth is off while a USB host is connected.
        if (bt_running() && !bt_wiimote() && !tud_mounted()) {
            static uint8_t bt_last[64];
            static uint16_t bt_len;
            static bool bt_first = true;
            static uint8_t bt_counter;
            uint8_t b[64];
            uint16_t n;
            gpad_t gb;                                      // Bluetooth follows the HID mode's map
            padmap_build(&src, g_ext.map[MODE_HID], &gb);
            switch (g_usb_mode) {
                case MODE_PS3_GH:   n = rpt_ps3(&gb, b); break;
                case MODE_PS3_RB:
                case MODE_WII_RB:   n = rpt_ps3_rb(&gb, b); break;
                case MODE_KEYBOARD: n = build_keyboard(&st, b); break;
                case MODE_SWITCH:   n = rpt_switch(&gb, b); break;
                case MODE_HID:      n = rpt_hid(&gb, b); break;
                case MODE_PS4:      n = rpt_ps4(&gb, b); break;
                default:            n = rpt_hid(&gb, b); break;
            }
            const uint8_t *p = b;
            if (g_usb_mode == MODE_PS4) { p = &b[1]; n--; }      // report id travels separately over Bluetooth
            if (bt_first || n != bt_len || memcmp(p, bt_last, n) != 0) {
                bt_first = false;
                memcpy(bt_last, p, n); bt_len = n;
                if (g_usb_mode == MODE_PS4) {                   // 6 bit counter, like over USB
                    uint8_t c[64]; memcpy(c, p, n); c[6] = (uint8_t)((c[6] & 0x03) | (bt_counter << 2)); bt_counter = (bt_counter + 1) & 0x3F;
                    bt_send_report(c, n);
                } else bt_send_report(p, n);
            }
        }
        if (g_usb_mode == MODE_XBONE) {                 // GIP has its own sequencing, acks and auth gate
            uint8_t body[XBONE_GUITAR_PAYLOAD_LEN];
            rpt_xbone(&gp, body);
            xbone_task(body, false);
            continue;
        }
        uint8_t rpt[64];
        uint16_t len;
        switch (g_usb_mode) {
            case MODE_PS3_GH: len = rpt_ps3(&gp, rpt); break;
            case MODE_PS3_RB:
            case MODE_WII_RB: len = rpt_ps3_rb(&gp, rpt); break;
            case MODE_KEYBOARD: len = build_keyboard(&st, rpt); break;
            case MODE_SWITCH: len = rpt_switch(&gp, rpt); break;
            case MODE_OGXBOX: len = rpt_ogxbox(&gp, rpt); break;
            case MODE_HID:
            case MODE_AUTO:   len = rpt_hid(&gp, rpt); break;
            case MODE_PS4:    len = rpt_ps4(&gp, rpt); break;
            case MODE_PS5:    len = rpt_ps5(&gp, rpt); break;
            default:          len = rpt_xinput(&gp, rpt); break;
        }
        if (g_usb_mode == MODE_PS5) {                   // every report is signed by the dongle: relay continuously
            static bool ps5_first = true;
            if (ps5_first) rpt[10] |= 0x01;             // the first one taps PS so the console wakes up
            if (tud_ready() && ps5_relay_report(rpt, len)) ps5_first = false;
            continue;
        }
        if (len != last_len || memcmp(rpt, last_report, len) != 0) {
            dirty = true;
            memcpy(last_report, rpt, len);
            last_len = len;
        }
        if ((dirty || now - last_sent >= 8000) && tud_ready()) {
            bool ok;
            if (g_usb_mode == MODE_XINPUT || g_usb_mode == MODE_OGXBOX) {
                ok = xinput_send(last_report, last_len);
            } else if (g_usb_mode == MODE_PS4) {
                // every report carries a 6 bit counter; the very first one also taps PS so the console wakes up
                uint8_t r[64];
                memcpy(r, last_report, last_len);
                r[7] = (uint8_t)((r[7] & 0x01) | (ps4_counter << 2) | (ps4_first ? 0x01 : 0));   // keeps the PS button the map put there
                ok = tud_hid_n_ready(0) && tud_hid_n_report(0, r[0], &r[1], (uint16_t)(last_len - 1));
                if (ok) { ps4_counter = (uint8_t)((ps4_counter + 1) & 0x3F); ps4_first = false; }
            } else {
                // Auto mode's descriptor numbers its reports (it carries the PS3 / PS4 feature reports): gamepad = 1
                ok = tud_hid_n_ready(0) && tud_hid_n_report(0, g_usb_mode == MODE_AUTO ? 1 : 0, last_report, last_len);
            }
            if (ok) {
                dirty = false;
                last_sent = now;
            }
        }
    }
}
