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
    for (int i = 0; i < c->strum_leds; i++) if (c->strum_map[i] >= MAX_LEDS) return false;
    return true;
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
    c->usb_mode = MODE_XINPUT;
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
    config_seal(c);
}

void config_load(void) {
    const yacc_config_t *flash = (const yacc_config_t *)(XIP_BASE + CFG_OFFSET);
    yacc_config_t tmp;
    memcpy(&tmp, flash, sizeof(tmp));
    if (!config_validate(&tmp) && tmp.magic == YACC_CFG_MAGIC && tmp.version == 3 &&
        *(const uint32_t *)((const uint8_t *)flash + 60) == crc32((const uint8_t *)flash, 60)) {
        // v3 (64 bytes) -> v4: keep everything, new fields get their defaults
        yacc_config_t def;
        config_defaults(&def);
        memcpy(&tmp, flash, 58);           // up to and including cfg_rev
        memcpy((uint8_t *)&tmp + 58, (uint8_t *)&def + 58, sizeof(tmp) - 58);
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
    }
}

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
    memset(job.page, 0xFF, sizeof(job.page));
    config_seal(&g_cfg);
    memcpy(job.page, &g_cfg, sizeof(g_cfg));
    return flash_safe_execute(flash_write_cb, &job, 500) == PICO_OK;
}
