// YAGCC firmware: guitar controller with three USB personalities (XInput, PS3 GH, HID)
// and a WebUSB configuration channel used by the YAGCC web app.
#include <string.h>
#include "pico/stdlib.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"
#include "hardware/structs/watchdog.h"
#include "hardware/clocks.h"
#include "tusb.h"

#include "usb_common.h"
#include "config.h"
#include "input.h"
#include "bt.h"
#include "rgb.h"
#include "host/usb_host.h"
#include "host/xbone.h"

// ---------------------------------------------------------------- state shared with USB callbacks
static yacc_config_t cfg_rx;
static uint8_t tx_buf[64];
static volatile bool save_pending;
static volatile bool save_ok = true;
static volatile int reboot_mode = -1;     // -1 none, 0 normal, 1 BOOTSEL
static volatile uint64_t reboot_at;
static volatile bool setup_reboot;

// Asked over HID (PS3 mode has no WebUSB interface): restart once in setup mode (XInput + web config)
#define SETUP_MAGIC 0x59414743u   // "YAGC"
#define MODESWITCH_MAGIC 0x594D4F44u   // "YMOD": rebooted by a Bluetooth mode change, skip the plug-in shortcuts
void usb_request_setup_reboot(void) {
    setup_reboot = true;
    reboot_at = time_us_64() + 150000;
}

#define STATUS_LEN (4 + 2 * NUM_ADC_CH + NUM_DIGITAL_PINS + 1)

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
    return (uint16_t)(p - tx_buf);
}

static bool g_setup_session;
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
    *p++ = g_setup_session ? 1 : 0;     // flags: 1 = setup session (the saved mode returns on the next plug-in)
    return (uint16_t)(p - tx_buf);
}

static bool reply(uint8_t rhport, tusb_control_request_t const *req, const void *data, uint16_t len) {
    if (len > req->wLength) len = req->wLength;
    return tud_control_xfer(rhport, req, (void *)data, len);
}

bool usb_vendor_request(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req) {
    if (req->bmRequestType_bit.type != TUSB_REQ_TYPE_VENDOR) return false;

    // OUT data stage finished: apply what we received
    if (stage == CONTROL_STAGE_ACK) {
        if (req->bRequest == VREQ_SETCFG && config_validate(&cfg_rx)) {
            g_cfg = cfg_rx;
            // an older configurator leaves the host port byte at zero: keep the port off
            if (g_cfg.cfg_rev < 4) { g_cfg.host_dp_pin = PIN_NONE; g_cfg.cfg_rev = 4; }
        }
        return true;
    }
    if (stage != CONTROL_STAGE_SETUP) return true;

    switch (req->bRequest) {
        case VREQ_WEBUSB:
            if (req->wIndex == 2) {
                uint16_t n;
                const uint8_t *d = yacc_webusb_url_desc(&n);
                return reply(rhport, req, d, n);
            }
            return false;
        case VREQ_MS_OS:
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
            if (req->wLength != sizeof(cfg_rx)) return false;
            return tud_control_xfer(rhport, req, &cfg_rx, sizeof(cfg_rx));
        case VREQ_SAVE:
            save_pending = true;
            return tud_control_status(rhport, req);
        case VREQ_DEFAULTS:
            config_defaults(&g_cfg);
            return tud_control_status(rhport, req);
        case VREQ_SETMODE:
            if (req->wValue < NUM_MODES) g_cfg.usb_mode = (uint8_t)req->wValue;
            return tud_control_status(rhport, req);
        case VREQ_LEDTEST:
            rgb_test_led(req->wValue < NUM_LEDS ? (int)req->wValue : -1);
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
    s->tilt = (g_cfg.flags & CFG_FLAG_TILT_ENABLED) && g_cfg.tilt_pin != PIN_NONE && input_tilt();
    if (s->tilt) s->star = true;
    s->whammy = input_whammy();
}

// ---------------------------------------------------------------- game feedback (rumble channel)
// Santroller's convention, which YARG uses: right motor byte = command, left = parameter.
static volatile bool g_star_power_active;
static volatile uint8_t g_star_power_fill;
void usb_game_feedback(uint8_t command, uint8_t param) {
    switch (command) {
        case 0x09: g_star_power_active = param != 0; break;   // star power / overdrive active
        case 0x08: g_star_power_fill = param; break;          // star power meter
        case 0xFF: g_star_power_active = false; break;        // all off
        default: break;
    }
    rgb_set_star_power(g_star_power_active);
}

// whammy 0..32767 -> full signed range with the rest position at -32768 (what XInput guitars report)
static inline int16_t xi_axis(int16_t v) { return (int16_t)((int32_t)v * 2 - 32767); }

// ---- Xbox 360 guitar, 20 byte report. Guitar Hero (subtype 7) and Rock Band (subtype 6) share
// the layout Santroller uses: whammy on right stick X, tilt on right stick Y.
static uint16_t build_xinput(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->green)  b |= 0x1000;   // A
    if (s->red)    b |= 0x2000;   // B
    if (s->blue)   b |= 0x4000;   // X
    if (s->yellow) b |= 0x8000;   // Y
    if (s->orange) b |= 0x0100;   // left shoulder
    if (s->strum_up)   b |= 0x0001;
    if (s->strum_down) b |= 0x0002;
    if (s->plus) b |= 0x0010;     // start
    if (s->star) b |= 0x0020;     // back
    // Fortnite Festival on PC reads overdrive from D-pad left
    if (s->star && (g_cfg.flags & CFG_FLAG_STAR_DPAD_LEFT)) b |= 0x0004;
    memset(out, 0, XINPUT_REPORT_LEN);
    out[1] = XINPUT_REPORT_LEN;
    out[2] = (uint8_t)b;
    out[3] = (uint8_t)(b >> 8);
    int16_t whammy = xi_axis(s->whammy);
    out[10] = (uint8_t)whammy;
    out[11] = (uint8_t)((uint16_t)whammy >> 8);
    int16_t tilt = s->star ? 32767 : -32768;   // games read star power from the tilt axis too
    out[12] = (uint8_t)tilt;
    out[13] = (uint8_t)((uint16_t)tilt >> 8);
    return XINPUT_REPORT_LEN;
}

// ---- PS3 Guitar Hero guitar, 27 byte report (layout matches the descriptor)
static uint16_t build_ps3(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS3_REPORT_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->yellow) b0 |= 0x01;
    if (s->green)  b0 |= 0x02;
    if (s->red)    b0 |= 0x04;
    if (s->blue)   b0 |= 0x08;
    if (s->orange) b0 |= 0x10;
    if (s->star) b1 |= 0x01;      // select
    if (s->plus) b1 |= 0x02;      // start
    out[0] = b0;
    out[1] = b1;
    // hat: 0 = up, 4 = down, 8 = neutral
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80;                // left stick x
    out[4] = 0x80;                // left stick y
    out[5] = (uint8_t)(s->whammy >> 7);   // whammy
    out[6] = 0x80;                // touch slider idle
    // out[7..18] pressure bytes stay 0
    // accelerometer words centred (tilt, z, y, unused)
    for (int i = 0; i < 4; i++) {
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return PS3_REPORT_LEN;
}

// ---- PS3 Rock Band guitar, 27 byte report (Santroller's PS3RockBandGuitar_Data_t layout)
// byte 0: blue, green, red, yellow, orange, tilt(R1), solo(L2), -   byte 1: select, start
// byte 2: hat (strum), 3/4: sticks, 5: whammy (0 = rest), 6: pickup selector, accel words centred.
static uint16_t build_ps3_rb(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS3_REPORT_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->blue)   b0 |= 0x01;
    if (s->green)  b0 |= 0x02;
    if (s->red)    b0 |= 0x04;
    if (s->yellow) b0 |= 0x08;
    if (s->orange) b0 |= 0x10;
    if (s->tilt)   b0 |= 0x20;    // Rock Band reads tilt as R1
    // overdrive: the star button is select; with no separate tilt reading it also tilts (star = select)
    if (s->star) b1 |= 0x01;      // select
    if (s->plus) b1 |= 0x02;      // start
    out[0] = b0;
    out[1] = b1;
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80;
    out[4] = 0x80;
    out[5] = (uint8_t)(s->whammy >> 7);
    out[6] = 0x00;                // pickup selector position
    for (int i = 0; i < 4; i++) {
        out[19 + 2 * i] = 0x00;
        out[20 + 2 * i] = 0x02;   // 0x0200
    }
    return PS3_REPORT_LEN;
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

// ---- Nintendo Switch (HORIPAD layout), 8 byte report
static uint16_t build_switch(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->yellow) b |= 1u << 0;   // Y
    if (s->red)    b |= 1u << 1;   // B
    if (s->green)  b |= 1u << 2;   // A
    if (s->blue)   b |= 1u << 3;   // X
    if (s->orange) b |= 1u << 4;   // L
    if (s->tilt)   b |= 1u << 5;   // R
    if (s->star)   b |= 1u << 8;   // minus
    if (s->plus)   b |= 1u << 9;   // plus
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[2] = hat;
    out[3] = 0x80; out[4] = 0x80;
    out[5] = (uint8_t)(s->whammy >> 7);   // right stick X = whammy
    out[6] = 0x80;
    out[7] = 0x00;
    return SWITCH_REPORT_LEN;
}

// ---- original Xbox ("Duke"), 20 byte report
static uint16_t build_ogxbox(const pad_t *s, uint8_t *out) {
    memset(out, 0, OGXBOX_REPORT_LEN);
    out[1] = OGXBOX_REPORT_LEN;
    uint8_t d = 0;
    if (s->strum_up)   d |= 0x01;
    if (s->strum_down) d |= 0x02;
    if (s->plus)       d |= 0x10;   // start
    if (s->star)       d |= 0x20;   // back
    out[2] = d;
    out[4] = s->green ? 0xFF : 0;   // A
    out[5] = s->red ? 0xFF : 0;     // B
    out[6] = s->blue ? 0xFF : 0;    // X
    out[7] = s->yellow ? 0xFF : 0;  // Y
    out[8] = s->orange ? 0xFF : 0;  // black
    out[9] = s->tilt ? 0xFF : 0;    // white
    int16_t whammy = xi_axis(s->whammy);
    out[16] = (uint8_t)whammy; out[17] = (uint8_t)((uint16_t)whammy >> 8);   // right stick X
    return OGXBOX_REPORT_LEN;
}

// ---- generic HID gamepad, 7 byte report
static uint16_t build_hid(const pad_t *s, uint8_t *out) {
    uint16_t b = 0;
    if (s->green)  b |= 1u << 0;
    if (s->red)    b |= 1u << 1;
    if (s->yellow) b |= 1u << 2;
    if (s->blue)   b |= 1u << 3;
    if (s->orange) b |= 1u << 4;
    if (s->star)   b |= 1u << 5;
    if (s->plus)   b |= 1u << 6;
    if (s->strum_up)   b |= 1u << 7;
    if (s->strum_down) b |= 1u << 8;
    uint8_t hat = 0x08;           // neutral (8 = null state)
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    out[0] = (uint8_t)b;
    out[1] = (uint8_t)(b >> 8);
    out[2] = hat;
    out[3] = 0x80;
    out[4] = 0x80;
    out[5] = (uint8_t)(s->whammy >> 7);
    out[6] = s->star ? 0xFF : 0x00;
    return HID_REPORT_LEN;
}

// ---- PS4 Rock Band 4-style guitar, 64 byte DualShock 4 report (report id 1).
// Layout as Santroller's PS4RockBandGuitar_Data_t / GP2040-CE's PS4Report guitar union.
static uint16_t build_ps4(const pad_t *s, uint8_t *out) {
    memset(out, 0, PS4_GUITAR_REPORT_LEN);
    out[0] = 0x01;
    out[1] = out[2] = out[3] = out[4] = 0x80;          // sticks centred
    uint8_t hat = 0x08;
    if (s->strum_up && !s->strum_down) hat = 0x00;
    else if (s->strum_down && !s->strum_up) hat = 0x04;
    uint8_t b5 = hat;
    if (s->blue)   b5 |= 0x10;                          // square
    if (s->green)  b5 |= 0x20;                          // cross
    if (s->red)    b5 |= 0x40;                          // circle
    if (s->yellow) b5 |= 0x80;                          // triangle
    uint8_t b6 = 0;
    if (s->orange) b6 |= 0x01;                          // L1
    if (s->star)   b6 |= 0x10;                          // share = overdrive
    if (s->plus)   b6 |= 0x20;                          // options
    out[5] = b5;
    out[6] = b6;
    out[30] = 0x1B;                                     // cable connected, battery full (as a wired DS4)
    out[43] = 0x00;                                     // pickup selector notch
    out[44] = (uint8_t)(s->whammy >> 7);               // whammy, 0 = rest
    out[45] = s->tilt ? 0xFF : 0x00;                    // tilt
    out[46] = (uint8_t)((s->green ? 0x01 : 0) | (s->red ? 0x02 : 0) | (s->yellow ? 0x04 : 0) |
                        (s->blue ? 0x08 : 0) | (s->orange ? 0x10 : 0));
    return PS4_GUITAR_REPORT_LEN;
}

// ---- Xbox One Rock Band 4-style guitar: 32 byte GIP input body (Santroller's XboxOneRockBandGuitar_Data_t)
static void build_xbone(const pad_t *s, uint8_t *out) {
    memset(out, 0, XBONE_GUITAR_PAYLOAD_LEN);
    uint8_t b0 = 0, b1 = 0;
    if (s->plus)   b0 |= 0x04;                          // menu
    if (s->star)   b0 |= 0x08;                          // view = overdrive
    if (s->green)  b0 |= 0x10;                          // A
    if (s->red)    b0 |= 0x20;                          // B
    if (s->blue)   b0 |= 0x40;                          // X
    if (s->yellow) b0 |= 0x80;                          // Y
    if (s->strum_up)   b1 |= 0x01;
    if (s->strum_down) b1 |= 0x02;
    if (s->orange) b1 |= 0x10;                          // LB
    out[0] = b0;
    out[1] = b1;
    out[2] = s->tilt ? 0xFF : 0x00;                     // tilt
    out[3] = (uint8_t)(s->whammy >> 7);                // whammy
    out[4] = 0x00;                                      // pickup selector
    out[5] = (uint8_t)((s->green ? 0x01 : 0) | (s->red ? 0x02 : 0) | (s->yellow ? 0x04 : 0) |
                       (s->blue ? 0x08 : 0) | (s->orange ? 0x10 : 0));
}

static bool needs_host(uint8_t mode) { return mode == MODE_PS4 || mode == MODE_XBONE; }

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
                config_save();
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
        config_save();
    }
    if (bt_ok) bt_init(g_cfg.flags & CFG_FLAG_BT_ENABLED, g_bt_pair_at_boot, g_bt_mode_switched);
    if (g_usb_mode == MODE_XBONE) xbone_init();
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

    while (true) {
        tud_task();
        if (needs_host(g_usb_mode)) usb_host_task();
        bt_task();
        input_poll();
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
        // Bluetooth carries the same HID report as USB in this mode. XInput, OG Xbox and Xbox One aren't HID
        // over USB, so they use the generic gamepad. Bluetooth is off while a USB host is connected.
        if (bt_running() && !tud_mounted()) {
            static uint8_t bt_last[64];
            static uint16_t bt_len;
            static bool bt_first = true;
            static uint8_t bt_counter;
            uint8_t b[64];
            uint16_t n;
            switch (g_usb_mode) {
                case MODE_PS3_GH:   n = build_ps3(&st, b); break;
                case MODE_PS3_RB:
                case MODE_WII_RB:   n = build_ps3_rb(&st, b); break;
                case MODE_KEYBOARD: n = build_keyboard(&st, b); break;
                case MODE_SWITCH:   n = build_switch(&st, b); break;
                case MODE_HID:      n = build_hid(&st, b); break;
                case MODE_PS4:      n = build_ps4(&st, b); break;
                default:            n = build_hid(&st, b); break;
            }
            const uint8_t *p = b;
            if (g_usb_mode == MODE_PS4) { p = &b[1]; n--; }      // report id travels separately over Bluetooth
            if (bt_first || n != bt_len || memcmp(p, bt_last, n) != 0) {
                bt_first = false;
                memcpy(bt_last, p, n); bt_len = n;
                if (g_usb_mode == MODE_PS4) {                   // 6 bit counter, like over USB
                    uint8_t c[64]; memcpy(c, p, n); c[6] = (uint8_t)(bt_counter << 2); bt_counter = (bt_counter + 1) & 0x3F;
                    bt_send_report(c, n);
                } else bt_send_report(p, n);
            }
        }
        if (g_usb_mode == MODE_XBONE) {                 // GIP has its own sequencing, acks and auth gate
            uint8_t body[XBONE_GUITAR_PAYLOAD_LEN];
            build_xbone(&st, body);
            xbone_task(body, false);
            continue;
        }
        uint8_t rpt[64];
        uint16_t len;
        switch (g_usb_mode) {
            case MODE_PS3_GH: len = build_ps3(&st, rpt); break;
            case MODE_PS3_RB:
            case MODE_WII_RB: len = build_ps3_rb(&st, rpt); break;
            case MODE_KEYBOARD: len = build_keyboard(&st, rpt); break;
            case MODE_SWITCH: len = build_switch(&st, rpt); break;
            case MODE_OGXBOX: len = build_ogxbox(&st, rpt); break;
            case MODE_HID:    len = build_hid(&st, rpt); break;
            case MODE_PS4:    len = build_ps4(&st, rpt); break;
            default:          len = build_xinput(&st, rpt); break;
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
                r[7] = (uint8_t)((ps4_counter << 2) | (ps4_first ? 0x01 : 0));
                ok = tud_hid_n_ready(0) && tud_hid_n_report(0, r[0], &r[1], (uint16_t)(last_len - 1));
                if (ok) { ps4_counter = (uint8_t)((ps4_counter + 1) & 0x3F); ps4_first = false; }
            } else {
                ok = tud_hid_n_ready(0) && tud_hid_n_report(0, 0, last_report, last_len);
            }
            if (ok) {
                dirty = false;
                last_sent = now;
            }
        }
    }
}
