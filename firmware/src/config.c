#include "config.h"

#include <string.h>
#include <stddef.h>
#include "pico/stdlib.h"
#include "pico/flash.h"
#include "hardware/flash.h"
#include "hardware/sync.h"

yacc_config_t g_cfg;

#define CFG_REV 4

#define CFG_OFFSET (PICO_FLASH_SIZE_BYTES - FLASH_SECTOR_SIZE)

static uint32_t crc32(const uint8_t *d, size_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
        c ^= d[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (-(int32_t)(c & 1)));
    }
    return ~c;
}

void config_seal(yacc_config_t *c) {
    c->magic = YACC_CFG_MAGIC;
    c->version = YACC_CFG_VERSION;
    c->crc = crc32((const uint8_t *)c, offsetof(yacc_config_t, crc));
}

bool config_validate(const yacc_config_t *c) {
    if (c->magic != YACC_CFG_MAGIC || c->version != YACC_CFG_VERSION) return false;
    if (c->crc != crc32((const uint8_t *)c, offsetof(yacc_config_t, crc))) return false;
    for (int i = 0; i < NUM_FUNCS; i++)
        if (c->pins[i] != PIN_NONE && c->pins[i] >= NUM_DIGITAL_PINS) return false;
    if (c->whammy_ch != PIN_NONE && c->whammy_ch >= NUM_ADC_CH) return false;
    if (c->tilt_pin != PIN_NONE && c->tilt_pin >= NUM_DIGITAL_PINS) return false;
    if (c->usb_mode >= NUM_MODES) return false;
    if (c->debounce_mode > DEB_BOTH) return false;
    if (c->debounce_100us > 5000) return false;      // 500 ms max
    if (c->whammy_smooth > 6 || c->whammy_deadzone > 30) return false;
    for (int i = 0; i < NUM_FRETS; i++)
        if (c->boot_modes[i] != MODE_NONE && c->boot_modes[i] >= NUM_MODES) return false;
    if (c->rgb_pin != PIN_NONE && c->rgb_pin >= NUM_DIGITAL_PINS) return false;
    if (c->rgb_effect >= NUM_EFX) return false;
    if (c->rgb_speed < 1 || c->rgb_speed > 10) return false;
    if (c->xinput_type > XI_ROCK_BAND || c->led_type >= NUM_LED_TYPES || c->led_order >= NUM_ORDERS) return false;
    if (c->led_clk_pin != PIN_NONE && c->led_clk_pin >= NUM_DIGITAL_PINS) return false;
    if (c->host_dp_pin != PIN_NONE && c->host_dp_pin + 1 >= NUM_DIGITAL_PINS) return false;
    for (int i = 0; i < NUM_FRETS; i++) if (c->led_map[i] >= MAX_LEDS) return false;
    if (c->no_fret_leds > 1 || c->strum_leds > MAX_STRUM_LEDS) return false;
    for (int i = 0; i < c->strum_leds; i++) if (strum_led_pos(c, i) >= MAX_LEDS) return false;
    for (int i = 0; i < NUM_ATILT; i++) {
        const atilt_cfg_t *a = &c->atilt[i];
        if (a->ch != PIN_NONE && a->ch >= NUM_ATILT_SRC) return false;
        if (a->target > ATILT_STAR || a->invert > 1 || a->threshold < 1 || a->threshold > 99) return false;
        if (a->min > 4095 || a->max > 4095) return false;
    }
    if ((c->accel_sda != PIN_NONE && c->accel_sda >= NUM_DIGITAL_PINS) || (c->accel_scl != PIN_NONE && c->accel_scl >= NUM_DIGITAL_PINS)) return false;
    if (c->accel_gate > 100 || c->accel_median > 9 || c->accel_lowpass > 100) return false;
    if (c->xinput_opts > 7) return false;
    const uint8_t ext[7] = {c->ps2_att, c->ps2_cmd, c->ps2_dat, c->ps2_clk, c->ps2_ack, c->wii_sda, c->wii_scl};
    for (int i = 0; i < 7; i++) if (ext[i] != PIN_NONE && ext[i] >= NUM_DIGITAL_PINS) return false;
    if ((c->rumble_pin != PIN_NONE && c->rumble_pin >= NUM_DIGITAL_PINS) || c->rumble_flags > 7 ||
        c->rumble_strength < 10 || c->rumble_strength > 100) return false;
    if (c->fret_leds < 1 || c->fret_leds > 2) return false;
    for (int i = 0; i < NUM_FRETS; i++) if (c->led_map2[i] >= MAX_LEDS) return false;
    const led_zone_t *z = &c->zone_frets;
    for (int i = 0; i < 2; i++, z++)
        if (z->idle >= NUM_IDLE || z->idle_level > 100 || z->press >= NUM_PRESS || z->speed < 1 || z->speed > 10 ||
            z->fade < 1 || z->fade > 10 || z->zflags > 3) return false;
    if (c->star_anim >= NUM_STAR || c->star_zones > 3 || c->whammy_fx >= NUM_WFX || c->whammy_zones > 3 ||
        c->led_flags > 3 || c->sleep_min > 30 || c->star_speed < 1 || c->star_speed > 10) return false;
    return true;
}

static void atilt_defaults(yacc_config_t *c) {
    for (int i = 0; i < NUM_ATILT; i++) {
        atilt_cfg_t *a = &c->atilt[i];
        a->ch = PIN_NONE;
        a->target = i ? ATILT_STAR : ATILT_WHAMMY;
        a->invert = 0;
        a->threshold = 50;
        a->min = 0;
        a->max = 4095;
    }
    c->accel_sda = c->accel_scl = PIN_NONE;
    c->accel_gate = 0;               // off: on a guitar a strum hit is short, the median and low pass cover it
    c->accel_median = 3;             // takes single sample spikes out
    c->accel_lowpass = 20;           // 20 Hz: smooth, still well under a frame of latency
    c->xinput_opts = 0;              // (0.30) every field past the v4 layout starts here, so v4 upgrades get it too
    c->rumble_pin = PIN_NONE;
    c->rumble_flags = RUMBLE_FLAG_GAME | RUMBLE_FLAG_STAR;
    c->rumble_strength = 80;
    c->ps2_att = c->ps2_cmd = c->ps2_dat = c->ps2_clk = c->ps2_ack = PIN_NONE;
    c->wii_sda = c->wii_scl = PIN_NONE;
}

// old rgb_effect / rgb_speed -> both zones: idle, idle_level, press (all with ZF_SAME, speed = fade = rgb_speed)
void led_zones_from_efx(yacc_config_t *c) {
    static const uint8_t tab[NUM_EFX][3] = {
        {IDLE_SOLID, 100, PRESS_NONE}, {IDLE_SOLID, 100, PRESS_DIM}, {IDLE_SOLID, 100, PRESS_OFF},
        {IDLE_SOLID, 25, PRESS_COLOR}, {IDLE_SOLID, 11, PRESS_FLASH_FADE}, {IDLE_BREATHE, 100, PRESS_COLOR},
        {IDLE_RAINBOW, 60, PRESS_COLOR}};
    uint8_t e = c->rgb_effect < NUM_EFX ? c->rgb_effect : EFX_BRIGHT;
    led_zone_t z = {tab[e][0], tab[e][1], tab[e][2], c->rgb_speed, c->rgb_speed, ZF_SAME, {0, 0}};
    c->zone_frets = c->zone_strum = z;
}

static void v6_defaults(yacc_config_t *c) {
    c->fret_leds = 1;
    for (int i = 0; i < NUM_FRETS; i++) c->led_map2[i] = (uint8_t)(NUM_FRETS + i);
    c->tilt_invert = 0;
    memset(c->reserved3, 0, sizeof(c->reserved3));
}

// LED engine v2 fields (config version 7); colors[] and rgb_effect/rgb_speed must be set already
static void v7_defaults(yacc_config_t *c) {
    memcpy(c->fret_press, c->colors, sizeof(c->colors));
    memcpy(c->fret2_color, c->colors, sizeof(c->colors));
    memset(c->strum_led_color, 255, sizeof(c->strum_led_color));
    static const uint8_t tail[] = {0, 200, 255,  255, 60, 200,  0x40, 0xE0, 0xFF,  STAR_PULSE, 3, WFX_NONE, 3, 0, 0, 5};
    memcpy(c->strum_up_color, tail, sizeof(tail));     // strum_up/down, star_color, star_anim .. star_speed
    memset(c->reserved4, 0, sizeof(c->reserved4));
    led_zones_from_efx(c);
}

// Every field keeps its offset from one version to the next; the ones a version didn't have get their defaults
bool config_from_old(const uint8_t *src, uint16_t len, yacc_config_t *dst) {
    uint32_t magic, crc;
    memcpy(&magic, src, 4);
    uint8_t ver = src[4];
    uint16_t body = ver == 4 ? YACC_CFG_V4_SIZE - 4 : ver == 5 ? YACC_CFG_V5_SIZE - 4 : ver == 6 ? YACC_CFG_V6_SIZE - 4 : 0;
    if (magic != YACC_CFG_MAGIC || !body || len < body + 4) return false;
    memcpy(&crc, src + body, 4);
    if (crc != crc32(src, body)) return false;
    memset(dst, 0, sizeof(*dst));
    memcpy(dst, src, body);
    if (ver == 4) atilt_defaults(dst);   // the v5 fields
    if (ver < 6) v6_defaults(dst);
    v7_defaults(dst);                    // includes the zones, derived from rgb_effect / rgb_speed
    config_seal(dst);
    return config_validate(dst);
}

// Keyboard presets (HID usage IDs). 0: Fortnite Festival lead, 1: Fortnite Festival Pro guitar
void config_keyboard_preset(yacc_config_t *c, int preset) {
    static const uint8_t lead[NUM_KEYS] = {0x07 /*D*/, 0x09 /*F*/, 0x0D /*J*/, 0x0E /*K*/, 0x0F /*L*/,
                                           0x52 /*Up*/, 0x51 /*Down*/, 0x2C /*Space*/, 0x29 /*Esc*/, 0x2C /*Space*/, 0};
    static const uint8_t pro[NUM_KEYS]  = {0x1E /*1*/, 0x1F /*2*/, 0x20 /*3*/, 0x21 /*4*/, 0x22 /*5*/,
                                           0xE5 /*RShift*/, 0xE4 /*RCtrl*/, 0x4E /*PgDn*/, 0x29 /*Esc*/, 0x4E /*PgDn*/, 0x38 /*'/'*/};
    memcpy(c->keys, preset == 1 ? pro : lead, NUM_KEYS);
}

void config_defaults(yacc_config_t *c) {
    memset(c, 0, sizeof(*c));
    memset(c->pins, PIN_NONE, sizeof(c->pins));
    c->whammy_ch = PIN_NONE;
    c->whammy_min = 0;
    c->whammy_max = 4095;
    c->tilt_pin = PIN_NONE;
    c->usb_mode = MODE_AUTO;           // a new guitar finds out what it is plugged into
    c->debounce_mode = DEB_RELEASE;   // legacy field, the engine no longer has modes
    c->debounce_100us = 50;           // 5 ms
    c->whammy_smooth = 2;
    c->whammy_deadzone = 3;
    c->boot_modes[F_GREEN]  = MODE_XINPUT;
    c->boot_modes[F_RED]    = MODE_PS3_RB;
    c->boot_modes[F_YELLOW] = MODE_HID;
    c->boot_modes[F_BLUE]   = MODE_PS3_GH;
    c->boot_modes[F_ORANGE] = MODE_SWITCH;
    c->flags |= CFG_FLAG_RGB_BOOTFLASH | CFG_FLAG_COMBINED_STRUM | CFG_FLAG_RGB_STARPOWER;
    c->cfg_rev = CFG_REV;
    c->rgb_pin = PIN_NONE;
    c->rgb_brightness = 40;
    c->rgb_effect = EFX_BRIGHT;
    c->rgb_speed = 5;
    static const uint8_t def_col[NUM_FRETS][3] = {
        {0x22, 0xC5, 0x5E}, {0xEF, 0x44, 0x44}, {0xFA, 0xCC, 0x15}, {0x3B, 0x82, 0xF6}, {0xFB, 0x92, 0x3C}};
    for (int i = 0; i < NUM_FRETS; i++) { c->led_map[i] = i; memcpy(c->colors[i], def_col[i], 3); }
    c->xinput_type = XI_GUITAR_HERO;
    c->led_type = LED_WS2812;
    c->led_order = ORDER_GRB;
    c->led_clk_pin = PIN_NONE;
    c->host_dp_pin = PIN_NONE;
    config_keyboard_preset(c, 1);          // Fortnite Festival Pro guitar keys
    atilt_defaults(c);
    v6_defaults(c);
    v7_defaults(c);
    config_seal(c);
}

static bool g_cfg_preserve;
bool config_save_auto(void) { return g_cfg_preserve ? false : config_save(); }
void config_load(void) {
    const yacc_config_t *flash = (const yacc_config_t *)(XIP_BASE + CFG_OFFSET);
    yacc_config_t tmp;
    memcpy(&tmp, flash, sizeof(tmp));
    if (!config_validate(&tmp) && tmp.magic == YACC_CFG_MAGIC && (tmp.version >= 4 && tmp.version <= 6)) {
        // v4 (96 bytes, firmware up to 0.28) / v5 (128, 0.29-0.30) / v6 (160, 0.31-0.33) -> v7: the newer fields start off
        yacc_config_t up;
        if (config_from_old((const uint8_t *)flash, sizeof(yacc_config_t), &up)) tmp = up;
    }
    if (!config_validate(&tmp) && tmp.magic == YACC_CFG_MAGIC && tmp.version == 3 &&
        *(const uint32_t *)((const uint8_t *)flash + 60) == crc32((const uint8_t *)flash, 60)) {
        // v3 (64 bytes) -> v4: keep everything, new fields get their defaults
        yacc_config_t def;
        config_defaults(&def);
        memcpy(&tmp, flash, 58);           // up to and including cfg_rev
        memcpy((uint8_t *)&tmp + 58, (uint8_t *)&def + 58, sizeof(tmp) - 58);
        v7_defaults(&tmp);                 // the v7 tail follows this config's colours / effect
        config_seal(&tmp);
    }
    if (config_validate(&tmp)) {
        g_cfg = tmp;
        // rev 1: Rock Band mode was added on the red fret; give it to configs that left red unassigned
        if (g_cfg.cfg_rev < 1) {
            if (g_cfg.boot_modes[F_RED] == MODE_NONE) g_cfg.boot_modes[F_RED] = MODE_PS3_RB;
            g_cfg.cfg_rev = 1;
            config_seal(&g_cfg);
        }
        // rev 2: keyboard (Fortnite Festival) mode on the orange fret when it was free
        if (g_cfg.cfg_rev < 2) {
            if (g_cfg.boot_modes[F_ORANGE] == MODE_NONE) g_cfg.boot_modes[F_ORANGE] = MODE_KEYBOARD;
            g_cfg.cfg_rev = 2;
            config_seal(&g_cfg);
        }
        // rev 3: the orange fret's default moved from keyboard to Nintendo Switch mode
        if (g_cfg.cfg_rev < 3) {
            if (g_cfg.boot_modes[F_ORANGE] == MODE_KEYBOARD || g_cfg.boot_modes[F_ORANGE] == MODE_NONE)
                g_cfg.boot_modes[F_ORANGE] = MODE_SWITCH;
            g_cfg.cfg_rev = 3;
            config_seal(&g_cfg);
        }
        // rev 4: USB host port added in a byte that used to be reserved (zero): start with it off
        if (g_cfg.cfg_rev < 4) {
            g_cfg.host_dp_pin = PIN_NONE;
            g_cfg.cfg_rev = 4;
            config_seal(&g_cfg);
        }
    } else {
        config_defaults(&g_cfg);
        // something is stored there but it isn't readable (a newer layout, or damaged): keep it until the user saves
        uint32_t w = 0xFFFFFFFFu;
        for (int i = 0; i < 16; i++) w &= ((const uint32_t *)flash)[i];
        g_cfg_preserve = w != 0xFFFFFFFFu;
    }
}

_Static_assert(sizeof(yacc_config_t) <= FLASH_PAGE_SIZE, "config must fit one flash page");
typedef struct {
    uint8_t page[FLASH_PAGE_SIZE];
} write_job_t;

static void flash_write_cb(void *param) {
    write_job_t *job = (write_job_t *)param;
    flash_range_erase(CFG_OFFSET, FLASH_SECTOR_SIZE);
    flash_range_program(CFG_OFFSET, job->page, FLASH_PAGE_SIZE);
}

bool config_save(void) {
    static write_job_t job;
    g_cfg_preserve = false;
    memset(job.page, 0xFF, sizeof(job.page));
    config_seal(&g_cfg);
    memcpy(job.page, &g_cfg, sizeof(g_cfg));
    return flash_safe_execute(flash_write_cb, &job, 500) == PICO_OK;
}
